'use client';

import { useEffect, useRef, useState, type ReactNode } from 'react';
import {
  ApiError,
  completeEvidence,
  describeError,
  evidenceDownloadUrl,
  getDispute,
  putEvidenceFile,
  removeEvidence,
  requestEvidenceUpload,
  retryEvidenceUpload,
} from '../lib/api-client';
import {
  EVIDENCE_ACCEPT,
  formatFileSize,
  MAX_EVIDENCE_FILES,
  validateEvidenceFile,
} from '../lib/evidence';
import type { Dispute, DisputeEvidence } from '../lib/types';

type Phase = 'uploading' | 'verifying' | 'failed';

/** A file this browser tab is working on. Server rows without one were left by an earlier visit. */
interface LocalUpload {
  key: string;
  name: string;
  size: number;
  file: File;
  evidenceId?: string;
  phase: Phase;
  progress: number;
  error?: string;
}

/** Codes after which the server has already discarded the file. */
const ERASED = new Set(['invalid_evidence', 'evidence_upload_expired']);

const codeOf = (err: unknown) => (err instanceof ApiError ? err.code : null);

/**
 * Attach supporting documents to a draft. Files go straight to storage on a presigned link,
 * then the server checks the real contents before the letter mentions them.
 */
export function EvidenceSection({
  dispute,
  onChange,
  onPendingChange,
  disabled,
}: {
  dispute: Dispute;
  onChange: (d: Dispute) => void;
  /** True while any file is uploading, verifying or left unfinished. */
  onPendingChange?: (pending: boolean) => void;
  disabled: boolean;
}) {
  const [uploads, setUploads] = useState<LocalUpload[]>([]);
  const [busyRow, setBusyRow] = useState<string | null>(null);
  const [rowErrors, setRowErrors] = useState<Record<string, string>>({});
  const [status, setStatus] = useState('');
  const pickInput = useRef<HTMLInputElement>(null);
  const reselectInput = useRef<HTMLInputElement>(null);
  const reselectFor = useRef<DisputeEvidence | null>(null);
  const seq = useRef(0);

  const evidence = dispute.evidence ?? [];
  const tracked = new Set(uploads.map((u) => u.evidenceId).filter(Boolean));
  const orphans = evidence.filter((e) => e.status === 'pending' && !tracked.has(e.id));
  const verified = evidence.filter((e) => e.status === 'verified');
  const active = uploads.filter((u) => u.phase !== 'failed');
  const unfinished = uploads.filter((u) => u.phase === 'failed' && u.evidenceId);
  const pending = active.length > 0 || orphans.length > 0 || unfinished.length > 0;
  const slotsUsed =
    evidence.length + uploads.filter((u) => !u.evidenceId && u.phase !== 'failed').length;

  useEffect(() => onPendingChange?.(pending), [pending, onPendingChange]);

  const patch = (key: string, change: Partial<LocalUpload>) =>
    setUploads((list) => list.map((u) => (u.key === key ? { ...u, ...change } : u)));
  const drop = (key: string) => setUploads((list) => list.filter((u) => u.key !== key));

  async function refresh() {
    try {
      onChange(await getDispute(dispute.id));
    } catch {
      /* the next action will surface any problem */
    }
  }

  /** PUT then verify. Used for first attempts and retries alike. */
  async function send(
    u: LocalUpload,
    link: { evidenceId: string; url: string; headers: Record<string, string> },
  ) {
    patch(u.key, {
      evidenceId: link.evidenceId,
      phase: 'uploading',
      progress: 0,
      error: undefined,
    });
    try {
      await putEvidenceFile(link.url, link.headers, u.file, (p) => patch(u.key, { progress: p }));
    } catch {
      patch(u.key, {
        phase: 'failed',
        error: 'The upload didn’t finish. Check your connection and try again.',
      });
      setStatus(`${u.name} didn’t finish uploading.`);
      return;
    }
    await verify(u.key, u.name, link.evidenceId);
  }

  async function verify(key: string, name: string, evidenceId: string) {
    patch(key, { phase: 'verifying', error: undefined });
    try {
      const updated = await completeEvidence(dispute.id, evidenceId);
      drop(key);
      onChange(updated);
      setStatus(`${name} attached.`);
    } catch (err) {
      const message = describeError(err, 'We couldn’t check this file.');
      if (ERASED.has(codeOf(err) ?? '')) {
        // The server has removed the row, so this entry can only be dismissed.
        patch(key, { phase: 'failed', evidenceId: undefined, error: message });
        void refresh();
      } else {
        patch(key, { phase: 'failed', error: message });
      }
      setStatus(`${name}: ${message}`);
    }
  }

  async function start(file: File, existing: number) {
    const key = `local-${++seq.current}`;
    const base: LocalUpload = {
      key,
      name: file.name,
      size: file.size,
      file,
      phase: 'uploading',
      progress: 0,
    };
    const invalid = validateEvidenceFile(file, existing);
    if (invalid) {
      setUploads((list) => [...list, { ...base, phase: 'failed', error: invalid }]);
      setStatus(`${file.name}: ${invalid}`);
      return;
    }
    setUploads((list) => [...list, base]);
    try {
      const up = await requestEvidenceUpload(dispute.id, {
        contentType: file.type,
        contentLength: file.size,
        fileName: file.name,
      });
      await send(base, {
        evidenceId: up.evidence.id,
        url: up.uploadUrl,
        headers: up.requiredHeaders,
      });
    } catch (err) {
      const message = describeError(err, 'We couldn’t start this upload.');
      patch(key, { phase: 'failed', error: message });
      setStatus(`${file.name}: ${message}`);
    }
  }

  function onPick(files: FileList | null) {
    if (!files) return;
    const list = Array.from(files);
    list.forEach((f, i) => void start(f, slotsUsed + i));
    if (pickInput.current) pickInput.current.value = '';
  }

  /**
   * A retry first asks the server to check again, because the upload may have landed and
   * only the check failed. Only if nothing arrived does it upload again on a fresh link.
   */
  async function retry(u: LocalUpload) {
    if (!u.evidenceId) return;
    const evidenceId = u.evidenceId;
    patch(u.key, { phase: 'verifying', error: undefined });
    try {
      const updated = await completeEvidence(dispute.id, evidenceId);
      drop(u.key);
      onChange(updated);
      setStatus(`${u.name} attached.`);
      return;
    } catch (err) {
      if (codeOf(err) !== 'evidence_not_uploaded') {
        const message = describeError(err, 'We couldn’t check this file.');
        const erased = ERASED.has(codeOf(err) ?? '');
        patch(u.key, {
          phase: 'failed',
          error: message,
          ...(erased ? { evidenceId: undefined } : {}),
        });
        if (erased) void refresh();
        setStatus(`${u.name}: ${message}`);
        return;
      }
    }
    try {
      const link = await retryEvidenceUpload(dispute.id, evidenceId);
      await send(u, { evidenceId, url: link.uploadUrl, headers: link.requiredHeaders });
    } catch (err) {
      const message = describeError(err, 'We couldn’t restart this upload.');
      patch(u.key, { phase: 'failed', error: message });
      if (ERASED.has(codeOf(err) ?? '')) void refresh();
      setStatus(`${u.name}: ${message}`);
    }
  }

  /** An unfinished file from an earlier visit: check again, or ask for the same file. */
  async function resume(e: DisputeEvidence) {
    setBusyRow(e.id);
    setRowErrors((m) => ({ ...m, [e.id]: '' }));
    try {
      const updated = await completeEvidence(dispute.id, e.id);
      onChange(updated);
      setStatus(`${e.displayName} attached.`);
    } catch (err) {
      if (codeOf(err) === 'evidence_not_uploaded') {
        reselectFor.current = e;
        reselectInput.current?.click();
      } else {
        const message = describeError(err, 'We couldn’t check this file.');
        setRowErrors((m) => ({ ...m, [e.id]: message }));
        setStatus(`${e.displayName}: ${message}`);
        if (ERASED.has(codeOf(err) ?? '')) void refresh();
      }
    } finally {
      setBusyRow(null);
    }
  }

  function onReselect(files: FileList | null) {
    const e = reselectFor.current;
    const file = files?.[0];
    reselectFor.current = null;
    if (reselectInput.current) reselectInput.current.value = '';
    if (!e || !file) return;
    // The link is signed for the original size and type, so only the same file can finish it.
    if (file.size !== e.sizeBytes || file.type !== e.contentType) {
      const message = `Choose the same file you added before (${e.displayName}), or remove it.`;
      setRowErrors((m) => ({ ...m, [e.id]: message }));
      setStatus(message);
      return;
    }
    const u: LocalUpload = {
      key: `local-${++seq.current}`,
      name: e.displayName,
      size: file.size,
      file,
      evidenceId: e.id,
      phase: 'uploading',
      progress: 0,
    };
    setUploads((list) => [...list, u]);
    void retry(u);
  }

  async function remove(evidenceId: string, name: string, localKey?: string) {
    setBusyRow(evidenceId);
    try {
      onChange(await removeEvidence(dispute.id, evidenceId));
      if (localKey) drop(localKey);
      setStatus(`${name} removed.`);
    } catch (err) {
      const message = describeError(err, 'We couldn’t remove this file.');
      setRowErrors((m) => ({ ...m, [evidenceId]: message }));
      setStatus(`${name}: ${message}`);
    } finally {
      setBusyRow(null);
    }
  }

  async function download(e: DisputeEvidence) {
    setBusyRow(e.id);
    try {
      const { url } = await evidenceDownloadUrl(dispute.id, e.id);
      // Served as an attachment, so the browser saves it and stays on this page.
      window.location.assign(url);
    } catch (err) {
      const message = describeError(err, 'We couldn’t open this file.');
      setRowErrors((m) => ({ ...m, [e.id]: message }));
      setStatus(`${e.displayName}: ${message}`);
    } finally {
      setBusyRow(null);
    }
  }

  const full = slotsUsed >= MAX_EVIDENCE_FILES;

  return (
    <section aria-labelledby="evidence-heading" className="flex flex-col gap-3">
      <div>
        <h2 id="evidence-heading" className="text-base font-semibold text-text-primary">
          Supporting documents
        </h2>
        <p id="evidence-hint" className="mt-1 text-sm text-text-secondary">
          Optional. Add proof such as a paid-up letter or statement. PDF, JPEG or PNG, up to 10 MB
          each, {MAX_EVIDENCE_FILES} files at most.
        </p>
      </div>

      {(verified.length > 0 || uploads.length > 0 || orphans.length > 0) && (
        <ul className="flex flex-col divide-y divide-border-default rounded-xl border border-border-default bg-bg-surface">
          {verified.map((e) => (
            <Row
              key={e.id}
              name={e.displayName}
              meta={formatFileSize(e.sizeBytes)}
              error={rowErrors[e.id]}
            >
              <RowButton
                onClick={() => download(e)}
                disabled={disabled || busyRow === e.id}
                label={`Download ${e.displayName}`}
              >
                Download
              </RowButton>
              <RowButton
                danger
                onClick={() => remove(e.id, e.displayName)}
                disabled={disabled || busyRow === e.id}
                label={`Remove ${e.displayName}`}
              >
                Remove
              </RowButton>
            </Row>
          ))}

          {orphans.map((e) => (
            <Row
              key={e.id}
              name={e.displayName}
              meta={`${formatFileSize(e.sizeBytes)} · Upload didn’t finish`}
              error={rowErrors[e.id]}
              warn
            >
              <RowButton
                onClick={() => resume(e)}
                disabled={disabled || busyRow === e.id}
                label={`Retry ${e.displayName}`}
              >
                Retry
              </RowButton>
              <RowButton
                danger
                onClick={() => remove(e.id, e.displayName)}
                disabled={disabled || busyRow === e.id}
                label={`Remove ${e.displayName}`}
              >
                Remove
              </RowButton>
            </Row>
          ))}

          {uploads.map((u) => (
            <Row
              key={u.key}
              name={u.name}
              meta={
                u.phase === 'uploading'
                  ? `${formatFileSize(u.size)} · Uploading ${u.progress}%`
                  : u.phase === 'verifying'
                    ? `${formatFileSize(u.size)} · Checking file…`
                    : formatFileSize(u.size)
              }
              error={u.error}
              warn={u.phase === 'failed'}
              progress={u.phase === 'uploading' ? u.progress : undefined}
            >
              {u.phase === 'failed' && u.evidenceId && (
                <RowButton onClick={() => retry(u)} disabled={disabled} label={`Retry ${u.name}`}>
                  Retry
                </RowButton>
              )}
              {u.phase === 'failed' && (
                <RowButton
                  danger
                  onClick={() => (u.evidenceId ? remove(u.evidenceId, u.name, u.key) : drop(u.key))}
                  disabled={disabled || (u.evidenceId !== undefined && busyRow === u.evidenceId)}
                  label={u.evidenceId ? `Remove ${u.name}` : `Dismiss ${u.name}`}
                >
                  {u.evidenceId ? 'Remove' : 'Dismiss'}
                </RowButton>
              )}
            </Row>
          ))}
        </ul>
      )}

      <div>
        <input
          ref={pickInput}
          id="evidence-file"
          type="file"
          multiple
          accept={EVIDENCE_ACCEPT}
          disabled={disabled || full}
          onChange={(e) => onPick(e.target.files)}
          aria-describedby="evidence-hint"
          className="peer sr-only"
        />
        <label
          htmlFor="evidence-file"
          aria-disabled={disabled || full || undefined}
          className="inline-flex h-11 cursor-pointer items-center justify-center rounded-lg border border-dashed border-border-default bg-bg-surface px-4 text-sm font-semibold text-teal-700 transition-colors duration-normal hover:border-teal-700 peer-focus-visible:ring-2 peer-focus-visible:ring-teal-700/40 aria-disabled:cursor-not-allowed aria-disabled:opacity-50"
        >
          {full
            ? 'File limit reached'
            : evidence.length + uploads.length > 0
              ? 'Add another file'
              : 'Add a file'}
        </label>
        <input
          ref={reselectInput}
          type="file"
          accept={EVIDENCE_ACCEPT}
          tabIndex={-1}
          aria-hidden
          className="hidden"
          onChange={(e) => onReselect(e.target.files)}
        />
      </div>

      <p className="sr-only" aria-live="polite" role="status">
        {status}
      </p>
    </section>
  );
}

function Row({
  name,
  meta,
  error,
  warn,
  progress,
  children,
}: {
  name: string;
  meta: string;
  error?: string;
  warn?: boolean;
  progress?: number;
  children?: ReactNode;
}) {
  return (
    <li className="flex flex-col gap-2 p-3 sm:flex-row sm:items-center sm:gap-3">
      <div className="min-w-0 flex-1">
        {/* Names come from the user's device: always rendered as plain text. */}
        <p className="text-sm font-medium text-text-primary [overflow-wrap:anywhere]">{name}</p>
        <p className={`text-xs ${warn ? 'text-status-fair-fg' : 'text-text-muted'}`}>{meta}</p>
        {progress !== undefined && (
          <div
            className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-bg-muted"
            role="progressbar"
            aria-label={`Uploading ${name}`}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={progress}
          >
            <div
              className="h-full rounded-full bg-teal-700 transition-[width] duration-normal"
              style={{ width: `${progress}%` }}
            />
          </div>
        )}
        {error && <p className="mt-1 text-xs font-medium text-status-very-poor-fg">{error}</p>}
      </div>
      {children && <div className="flex shrink-0 gap-2">{children}</div>}
    </li>
  );
}

function RowButton({
  onClick,
  disabled,
  label,
  danger,
  children,
}: {
  onClick: () => void;
  disabled?: boolean;
  label: string;
  danger?: boolean;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      className={`inline-flex h-11 min-w-[44px] cursor-pointer items-center justify-center rounded-lg px-3 text-sm font-semibold transition-colors duration-normal disabled:cursor-not-allowed disabled:opacity-50 ${
        danger
          ? 'text-status-very-poor-fg hover:bg-status-very-poor-bg'
          : 'text-teal-700 hover:bg-teal-050'
      }`}
    >
      {children}
    </button>
  );
}
