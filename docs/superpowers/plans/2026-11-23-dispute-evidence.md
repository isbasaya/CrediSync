# Dispute Evidence Uploads Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let consumers attach verified evidence to draft disputes on web and mobile, let staff retrieve it for lodging, and guarantee it is erased on every deletion path.

**Architecture:** A `dispute_evidence` table tracks each file through `pending`, `verified` and `deleting`. Clients upload directly to S3 with presigned URLs, and the dispute engine verifies the stored object. Deletion is two-phase, with a daily job retrying failures and applying retention.

**Tech Stack:** TypeScript, Express, Postgres with RLS, AWS SDK v3 (S3), MinIO locally, Next.js 14, Flutter, vitest, Playwright, Terraform.

**Spec:** `docs/superpowers/specs/2026-11-23-dispute-evidence-design.md`

## Global Constraints

- Allowed types: `application/pdf`, `image/jpeg`, `image/png`. Maximum 10 MB per file, 10 files per dispute.
- Upload links last 15 minutes. Download links last 5 minutes and force `Content-Disposition: attachment`.
- Retention: `EVIDENCE_RETENTION_MONTHS`, default `24`, from `ncr_escalated_at` if set, otherwise `resolved_at`.
- `pending` rows expire after 24 hours. Evidence on drafts untouched for 90 days is deleted.
- Never put file contents, display names or storage keys in logs, events, audit payloads or API responses. `displayName` in the owner's or staff API response is the one exception.
- SA IDs are never logged. All S3 use stays in `af-south-1` with KMS. `S3_ENDPOINT` is honoured only when `isLocalEnv()` is true.
- Never edit an applied migration. Add a new one with an `-- @rollback` section.
- Commit with the repository owner's git identity, passed per command because none is configured globally. End each message with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- Run integration tests with `TEST_DATABASE_ADMIN_URL=postgres://credisync:credisync_dev@localhost:55433/credisync`.

## Review Focus

- A double tap or network retry on "complete" must succeed once, with one letter version.
- An interrupted or expired upload leaves a `pending` row. The user can retry or remove it, and sending stays blocked with a clear message.
- A renamed executable with a `.pdf` name and declared PDF type must be rejected and erased.
- Filenames with paths, HTML, control characters, quotes or 500 characters must display safely and not break the download header.
- Completing or adding a file while the dispute is being sent must not change a sent dispute. It returns 409 and the file is queued for deletion.

---

### Task 1: Schema and storage primitives

**Files:**
- Create: `packages/migrations/migrations/20261123120000_dispute_evidence.sql`
- Create: `packages/storage/src/evidence-file.ts`, `packages/storage/src/memory-provider.ts`
- Create: `packages/storage/src/__tests__/evidence-file.test.ts`, `packages/storage/vitest.config.ts`
- Modify: `packages/storage/src/index.ts`, `packages/storage/package.json` (add `test`), `db/schema.sql`, `packages/types/src/dispute.ts`

**Interfaces:**
- Produces in `@credisync/storage`:
  - `sniffEvidenceType(bytes: Buffer): 'application/pdf' | 'image/jpeg' | 'image/png' | null`
  - `sanitizeDisplayName(raw: string): string`
  - `verifyEvidenceObject(key: string, declaredType: string): Promise<{ ok: true; size: number } | { ok: false; reason: 'missing' | 'too_large' | 'type_mismatch' }>`
  - `createEvidenceDownloadUrl(key: string, fileName: string): Promise<string>`
  - `deleteEvidenceObject(key: string): Promise<void>`
  - `class InMemoryStorageProvider implements StorageProvider` with `put(key: string, body: Buffer, contentType: string): void`, `has(key: string): boolean`, and `failDeletes: boolean`
  - `StorageProvider` gains `headObject(key): Promise<{ size: number } | null>` and `readObjectStart(key, bytes): Promise<Buffer>`. `presignDownload(key, expiresIn, fileName?)` gains the optional filename.
- Produces in `@credisync/types`: `DisputeEvidence { id: string; displayName: string; contentType: string; sizeBytes: number; status: 'pending' | 'verified' }`. `Dispute.supportingEvidence` is replaced by `evidence: DisputeEvidence[]`.

- [ ] **Step 1: Write failing tests**

```ts
it('identifies real files by signature', () => {
  expect(sniffEvidenceType(Buffer.from('%PDF-1.7'))).toBe('application/pdf');
  expect(sniffEvidenceType(Buffer.from([0xff, 0xd8, 0xff, 0xe0]))).toBe('image/jpeg');
  expect(sniffEvidenceType(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))).toBe('image/png');
  expect(sniffEvidenceType(Buffer.from('MZ\x90\x00'))).toBeNull();
});
it('sanitises hostile filenames', () => {
  expect(sanitizeDisplayName('../../etc/passwd.pdf')).toBe('passwd.pdf');
  expect(sanitizeDisplayName('C:\\x\\proof.pdf')).toBe('proof.pdf');
  expect(sanitizeDisplayName('a"\r\nb<script>.pdf')).toBe('ab script .pdf');
  expect(sanitizeDisplayName('x'.repeat(500) + '.pdf')).toHaveLength(120);
  expect(sanitizeDisplayName('x'.repeat(500) + '.pdf').endsWith('.pdf')).toBe(true);
  expect(sanitizeDisplayName('   ')).toBe('evidence');
});
it('rejects a missing, oversized or spoofed object', async () => {
  const p = new InMemoryStorageProvider();
  setStorageProvider(p);
  expect(await verifyEvidenceObject('none', 'application/pdf')).toEqual({ ok: false, reason: 'missing' });
  p.put('big', Buffer.concat([Buffer.from('%PDF'), Buffer.alloc(MAX_EVIDENCE_BYTES)]), 'application/pdf');
  expect(await verifyEvidenceObject('big', 'application/pdf')).toEqual({ ok: false, reason: 'too_large' });
  p.put('exe', Buffer.from('MZ\x90\x00'), 'application/pdf');
  expect(await verifyEvidenceObject('exe', 'application/pdf')).toEqual({ ok: false, reason: 'type_mismatch' });
  p.put('ok', Buffer.from('%PDF-1.7 body'), 'application/pdf');
  expect(await verifyEvidenceObject('ok', 'application/pdf')).toEqual({ ok: true, size: 13 });
});
```

- [ ] **Step 2: Run and confirm failure.** `npx vitest run --root packages/storage`. Expected: FAIL, missing exports.

- [ ] **Step 3: Implement storage.** Sanitising takes the basename after `/` or `\`, replaces `<`, `>` with spaces, strips quotes and control characters, trims, keeps the extension when truncating to 120, and falls back to `evidence`. In `S3StorageProvider`:
  - Accept optional `endpoint` and `publicEndpoint`. Use `forcePathStyle` and a separate presigning client on `publicEndpoint` when set, because browsers reach MinIO at `localhost:9000` and services at `minio:9000`.
  - Omit SSE fields when `endpoint` is set.
  - Pass `unhoistableHeaders` for both SSE headers to `getSignedUrl`, so the headers in `requiredHeaders` are the ones signed.
  - `readObjectStart` uses `Range: bytes=0-<n-1>`. Download presigning sets `ResponseContentDisposition` with RFC 6266 `filename*` encoding and `ResponseCacheControl: no-store`.
  - `current()` passes `S3_ENDPOINT` and `S3_PUBLIC_ENDPOINT` only when `isLocalEnv()`.

- [ ] **Step 4: Write the migration.** Create type `credisync.evidence_status AS ENUM ('pending','verified','deleting')` and table `dispute_evidence` with the spec's columns, `CHECK (size_bytes > 0)`, indexes on `(dispute_id)` and partial on `(status, created_at) WHERE status <> 'verified'`. Enable and force RLS with an owner-or-system policy as in `oauth_link_states`, and grant to `credisync_app`. On `disputes`, drop `supporting_evidence` and add `letter_has_evidence BOOLEAN NOT NULL DEFAULT FALSE`. Rollback reverses all of it. Mirror the result in `db/schema.sql`.

- [ ] **Step 5: Verify.** `npx vitest run --root packages/storage` and `npm test -w packages/migrations` with the test database URL. Expected: PASS.

- [ ] **Step 6: Commit** `feat(storage): evidence table, file verification and in-memory provider`.

---

### Task 2: Attach and verify evidence

**Files:**
- Create: `services/dispute-engine/src/evidence.ts`, `services/dispute-engine/src/__tests__/evidence.integration.test.ts`
- Modify: `services/dispute-engine/src/service.ts`, `app.ts`, `types.ts`, `__tests__/disputes.integration.test.ts` (remove the `evidenceKeys` test)
- Modify: `services/api-gateway/src/app.ts` and its test

**Interfaces:**
- Consumes: Task 1 storage functions.
- Produces in `evidence.ts`:
  - `requestEvidenceUpload(pool, userId, disputeId, input: { contentType: string; contentLength: number; fileName: string }): Promise<{ evidence: DisputeEvidence; uploadUrl: string; requiredHeaders: Record<string, string>; expiresIn: number }>`
  - `completeEvidenceUpload(pool, userId, disputeId, evidenceId): Promise<DisputeRecord>`
  - `listEvidence(client, disputeId): Promise<DisputeEvidence[]>`
  - `syncDraftLetter(client, row): Promise<Record<string, unknown>>`, which regenerates a draft's letter and bumps `letter_version` only when `letter_has_evidence` differs from whether a verified file exists.
- Routes: `POST /disputes/:id/evidence` and `POST /disputes/:id/evidence/:evidenceId/complete`, both forwarded by the gateway at `/api/...`. Remove `POST /disputes/evidence-uploads` and the `evidenceKeys` body field.

The scheduled job cannot import letter templates from this service, so letters are reconciled by `syncDraftLetter` in `getDispute`, `submitDispute`, completion and removal. A draft whose files the job removed therefore shows a correct letter on next open, and can never be sent with a stale one.

- [ ] **Step 1: Write failing integration tests**

```ts
it('adds evidence wording only after verification', async () => {
  const up = await upload(ALICE, draftId, pdfBytes);
  expect((await get(ALICE, draftId)).body.letterContent).not.toContain('Supporting evidence is attached');
  const done = await complete(ALICE, draftId, up.evidence.id);
  expect(done.status).toBe(200);
  expect(done.body.letterContent).toContain('Supporting evidence is attached');
  expect(JSON.stringify(done.body)).not.toContain('uploads/');
});
it('completing twice succeeds once', async () => {
  const before = (await get(ALICE, draftId)).body.letterVersion;
  const up = await upload(ALICE, draftId, pdfBytes);
  await Promise.all([complete(ALICE, draftId, up.evidence.id), complete(ALICE, draftId, up.evidence.id)]);
  expect((await get(ALICE, draftId)).body.letterVersion).toBeLessThanOrEqual(before + 1);
});
it('rejects and erases a spoofed file', async () => {
  const up = await upload(ALICE, draftId, Buffer.from('MZ\x90\x00'));
  const res = await complete(ALICE, draftId, up.evidence.id);
  expect(res.status).toBe(400);
  expect(res.body.error).toBe('invalid_evidence');
  expect(storage.has(keyOf(up.evidence.id))).toBe(false);
});
it('blocks sending with a pending upload', async () => {
  await upload(ALICE, otherDraft, pdfBytes, { complete: false });
  const res = await request(app).post(`/disputes/${otherDraft}/submit`).set(as(ALICE));
  expect(res.status).toBe(409);
  expect(res.body.error).toBe('evidence_pending');
});
it('enforces 10 files under concurrency', async () => {
  const results = await Promise.all(Array.from({ length: 15 }, () => requestUpload(ALICE, limitDraft)));
  expect(results.filter((r) => r.status === 201)).toHaveLength(10);
  expect(results.filter((r) => r.status === 409)).toHaveLength(5);
});
it('hides another user’s dispute', async () => {
  expect((await requestUpload(MALLORY, draftId)).status).toBe(404);
  expect((await complete(MALLORY, draftId, someEvidenceId)).status).toBe(404);
});
it('refuses to complete after the dispute was sent, and queues the file', async () => {
  const up = await upload(ALICE, racedDraft, pdfBytes, { complete: false });
  await forceStatus(racedDraft, 'submitted');
  expect((await complete(ALICE, racedDraft, up.evidence.id)).status).toBe(409);
  expect(await statusOf(up.evidence.id)).toBe('deleting');
});
```

- [ ] **Step 2: Run and confirm failure.** `npx vitest run --root services/dispute-engine evidence`. Expected: FAIL with 404 on the new routes.

- [ ] **Step 3: Implement.** Lock the dispute row `FOR UPDATE` in upload and completion. Verify the object outside the transaction, then re-lock and apply the result. Treat an already-`verified` row as success. `submitDispute` locks the dispute, rejects pending files with `409 evidence_pending`, and calls `syncDraftLetter` before transitioning. `toRecord` callers include `evidence`. `hasEvidence` uses the verified count everywhere, including `lodgingLetterPdf`.

- [ ] **Step 4: Verify.** `npx vitest run --root services/dispute-engine` and `npx vitest run --root services/api-gateway`. Expected: PASS.

- [ ] **Step 5: Commit** `feat(disputes): attach and verify evidence on drafts`.

---

### Task 3: Downloads and deletion

**Files:**
- Modify: `services/dispute-engine/src/evidence.ts`, `service.ts`, `app.ts`, `__tests__/evidence.integration.test.ts`, `services/api-gateway/src/app.ts`

**Interfaces:**
- Produces:
  - `evidenceDownloadUrl(pool, userId, disputeId, evidenceId): Promise<{ url: string; expiresIn: 300 }>`
  - `adminEvidenceDownloadUrl(pool, actorId, disputeId, evidenceId): Promise<{ url: string; expiresIn: 300 }>`
  - `removeEvidence(pool, userId, disputeId, evidenceId): Promise<DisputeRecord>`
  - `markEvidenceDeleting(client, where: { disputeId: string } | { evidenceId: string }): Promise<Array<{ id: string; storage_key: string }>>`
  - `eraseMarked(pool, rows): Promise<void>`, which never throws and leaves failed rows as `deleting`
- Routes: `GET /disputes/:id/evidence/:evidenceId/download-url`, `DELETE /disputes/:id/evidence/:evidenceId`, `GET /admin/disputes/:id/evidence/:evidenceId/download-url` (`requireOpsRole`), all forwarded by the gateway.

- [ ] **Step 1: Write failing tests**

```ts
it('removing evidence erases the file and updates the letter', ...);           // 200, object gone, row gone, wording gone
it('cannot remove evidence once sent', ...);                                   // 409 not_editable, object remains
it('a storage failure leaves the row deleting and the API succeeds', ...);     // failDeletes = true → 200, status 'deleting'
it('deleting a draft queues and erases its files', ...);                       // 204, objects gone
it('a failed erase after draft delete survives for retry', ...);               // row 'deleting', dispute_id NULL
it('consumer download is owner-only and audited as data_access', ...);         // Mallory 404, audit payload has no key or name
it('staff download requires an ops role, a sent dispute and is audited', ...); // consumer 403, draft 409, admin 200, admin_access
it('download refuses pending or deleting files', ...);                         // 404
it('deletion audit uses delete_evidence with no key or filename', ...);
```

- [ ] **Step 2: Run and confirm failure.** Expected: FAIL.

- [ ] **Step 3: Implement.** Follow the spec's two phases. `deleteDraft` calls `markEvidenceDeleting` before deleting the dispute, in the same transaction, and calls `eraseMarked` after commit. Audit payloads contain `action` and the evidence id only.

- [ ] **Step 4: Verify.** `npx vitest run --root services/dispute-engine` and the gateway suite. Expected: PASS.

- [ ] **Step 5: Commit** `feat(disputes): evidence download, removal and retryable erasure`.

---

### Task 4: Evidence job and infrastructure

**Files:**
- Modify: `packages/jobs/src/jobs.ts`, `runner.ts`, `src/__tests__/jobs.integration.test.ts`
- Modify: `infra/terraform/schedules.tf`, `infra/terraform/data.tf`

**Interfaces:**
- Produces: `runEvidenceMaintenance(pool: Pool, now?: Date): Promise<{ erased: number; failed: number; expiredPending: number; staleDrafts: number; retained: number }>`, and `RETENTION.evidenceMonths` from `EVIDENCE_RETENTION_MONTHS`.

- [ ] **Step 1: Write failing tests**

```ts
it('retries rows left in deleting', ...);
it('expires pending at 24 hours, not before', ...);
it('clears evidence on drafts idle 90 days, keeps the draft', ...);
it('keeps evidence on a draft with a recent upload', ...);        // idle = max(dispute updated_at, newest evidence created_at)
it('erases 24 months after resolved_at, not one day earlier', ...);
it('measures escalated disputes from ncr_escalated_at', ...);
it('never touches open submitted or under_review disputes', ...);
it('a storage failure is counted and retried next run', ...);
```

- [ ] **Step 2: Run and confirm failure.** `npx vitest run --root packages/jobs`. Expected: FAIL.

- [ ] **Step 3: Implement** with batches of 200. Add command `evidence` and include it in `all` after `deletions`. Add to `schedules.tf`: `evidence = { expression = "cron(45 2 * * ? *)", args = ["evidence"] }`. In `data.tf` add `expiration { expired_object_delete_marker = true }` to the lifecycle rule.

- [ ] **Step 4: Verify.** Run the jobs suite. Run `terraform -chdir=infra/terraform fmt -check`, and `validate` if Terraform is installed. Report if it is not. Do not apply.

- [ ] **Step 5: Commit** `feat(jobs): evidence retention and erasure retries`.

---

### Task 5: Local S3 with MinIO

**Files:**
- Modify: `docker-compose.yml`, `services/dispute-engine/.env.example`, `.claude/skills/run-credisync/SKILL.md` (local only, not committed)

**Interfaces:**
- Consumes: `S3_ENDPOINT`, `S3_PUBLIC_ENDPOINT`, `EVIDENCE_BUCKET`, `KMS_KEY_ID` from Task 1.

- [ ] **Step 1: Add services.** `minio` with a pinned image tag, dev-only credentials, host port `9000`, a named volume and a healthcheck. A one-shot `minio-init` creates bucket `credisync-evidence-dev`. Give `dispute-engine` and `jobs` `S3_ENDPOINT=http://minio:9000`, `S3_PUBLIC_ENDPOINT=http://localhost:9000`, `EVIDENCE_BUCKET`, a local `KMS_KEY_ID` placeholder and the MinIO credentials as `AWS_*`, with `AWS_REGION=af-south-1`.

- [ ] **Step 2: Verify a real round trip.** Rebuild with the skill's override file. Using a fresh smoke user, create a draft, request an upload, `curl` a PDF to the URL, complete it, fetch the download URL and compare bytes, delete it, and confirm the object is gone with `mc ls`. Expected: every step succeeds.

- [ ] **Step 3: Commit** `chore(dev): MinIO for local evidence storage`.

---

### Task 6: Web evidence UI

**Files:**
- Create: `web/src/components/EvidenceSection.tsx`, `web/src/lib/evidence.ts`, `web/src/lib/__tests__/evidence.test.ts`
- Modify: `web/src/components/DraftReview.tsx`, `web/src/lib/api-client.ts`, `web/src/lib/types.ts`

**Interfaces:**
- Produces in `evidence.ts`: `validateEvidenceFile(file: { type: string; size: number }, existingCount: number): string | null`, `formatFileSize(bytes: number): string`.
- Produces in `api-client.ts`: `requestEvidenceUpload`, `putEvidenceFile(url, headers, file, onProgress: (pct: number) => void)` using `XMLHttpRequest` with **no credentials**, `completeEvidence`, `removeEvidence`, `evidenceDownloadUrl`.
- `EvidenceSection` props: `{ dispute: Dispute; onChange: (d: Dispute) => void; disabled: boolean }`.

- [ ] **Step 1: Write failing tests** for `validateEvidenceFile`: accepts each type at exactly 10 MB, rejects 10 MB + 1 with `Files must be smaller than 10 MB`, rejects other types with `Upload a PDF, JPEG or PNG file`, rejects an 11th file, and `formatFileSize(1536) === '1.5 KB'`.

- [ ] **Step 2: Run and confirm failure.** `npx vitest run --root web evidence`. Expected: FAIL.

- [ ] **Step 3: Implement.** Show per-file progress, error, Retry and Remove. Disable Send while any file is uploading or pending, with the hint `Finish or remove your uploads before sending.` Render names as text only. Use a labelled file input, `aria-live` status and 44px targets. Must fit 360px. Use design tokens from `web/src/components/ui.tsx`.

- [ ] **Step 4: Verify.** Web tests and `npm run typecheck -w web`. Expected: PASS.

- [ ] **Step 5: Commit** `feat(web): attach evidence to dispute drafts`.

---

### Task 7: Admin evidence downloads

**Files:**
- Modify: `admin/src/app/disputes/page.tsx` (`DisputeUpdatePanel`, near the lodging letter link at line 164), its types and API helper

**Interfaces:**
- Consumes: `GET /api/admin/disputes/:id/evidence/:evidenceId/download-url`, and `evidence` on the dispute.

- [ ] **Step 1: Implement.** List verified files by name, type and size, each with a Download button that fetches a fresh link on click. Use the existing `LoadError` pattern. Show `No evidence attached` when empty. Add the line `Files come from consumers and are not malware-scanned yet.` until scanning ships.

- [ ] **Step 2: Verify.** `npm run typecheck -w admin`. Browser check in Task 9.

- [ ] **Step 3: Commit** `feat(admin): download dispute evidence for lodging`.

---

### Task 8: Mobile evidence and draft review

**Files:**
- Create: `mobile/lib/screens/dispute_review_screen.dart`, `mobile/lib/services/evidence_validation.dart`, `mobile/test/evidence_validation_test.dart`
- Modify: `mobile/lib/screens/dispute_create_screen.dart`, `mobile/lib/services/dispute_service.dart`, `mobile/pubspec.yaml`, `android/app/src/main/AndroidManifest.xml`, `ios/Runner/Info.plist`

**Interfaces:**
- Produces: `String? validateEvidence(String contentType, int size, int existingCount)`; `DisputeEvidence` model; `DisputeService.getDispute`, `uploadEvidence(disputeId, fileName, contentType, bytes, onProgress)`, `removeEvidence`, `deleteDraft`.
- `DisputeReviewScreen({ required String disputeId })` replaces the current dialog.

- [ ] **Step 1: Write failing tests** matching Task 6's limits and messages.

- [ ] **Step 2: Run and confirm failure.** `flutter test test/evidence_validation_test.dart` from `mobile/`. Expected: FAIL.

- [ ] **Step 3: Implement.** Add `file_picker` and `image_picker` with `flutter pub add`. Add camera and photo permission text explaining the purpose. Limit camera capture to `imageQuality: 80`, `maxWidth: 2000`, to suit slow connections. The presigned PUT uses plain `http` with `requiredHeaders`, **without** the API bearer token. Show the letter, evidence list and actions for Send, Keep as draft and Delete. Disable Send while uploads are pending.

- [ ] **Step 4: Verify.** `flutter analyze` and `flutter test`. Expected: no new issues, PASS. Device camera testing stays manual and must be reported as not done.

- [ ] **Step 5: Commit** `feat(mobile): evidence uploads and draft review screen`.

---

### Task 9: Compliance docs and end-to-end verification

**Files:**
- Modify: `docs/legal-review-pack.md`, `docs/go-live-checklist.md`, `docs/regulatory-figures.md`
- Create (not committed): `.claude/skills/run-credisync/evidence.cjs`

- [ ] **Step 1: Update docs.** Legal pack: 24-month retention, 90-day draft rule, escalation measured from `ncr_escalated_at`, up to 7-day S3 version retention, and the question of whether Ombud cases need longer. Checklist: unticked blocker **Malware scanning before staff can open consumer files**, and a note that POPIA erasure reports must filter `delete_evidence` and `delete_draft_dispute`. Figures: add `EVIDENCE_RETENTION_MONTHS`.

- [ ] **Step 2: Write and run the browser driver** on a fresh smoke user against the MinIO stack: upload a PDF and PNG, reject a renamed executable, reload and confirm persistence, remove one, block Send during a stalled upload, send, staff downloads matching bytes, a second draft's deletion removes its object. Expected: ends `EVIDENCE OK`.

- [ ] **Step 3: Run everything.** The full suite with the test database URL, typechecks for web, admin, gateway, dispute engine, storage and jobs, eslint and prettier on changed files, and `flutter analyze`. Expected: 0 failures.

- [ ] **Step 4: Commit** `docs(compliance): evidence retention, deletion and malware blocker`.
