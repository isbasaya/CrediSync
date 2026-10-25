# Go-live checklist

**For:** the person accountable for launch. Every line is either done in code (✅) or needs an owner.
Tick the owner items as they close; launch when the list is clear.

## Legal and compliance

- [ ] Counsel reviews the dispute letter, consent wording and retention — [legal-review-pack.md](legal-review-pack.md).
- [ ] Sign-off recorded in `services/dispute-engine/src/templates/legal-references.ts` (enables production letters).
- [ ] Privacy notice text approved; its version set in `POPIA_POLICY_VERSION`.
- [ ] Information Officer registered with the Information Regulator; PAIA manual published.
- [ ] Operator agreements in place (AWS, Stitch, each bureau) — legal pack C3.
- [ ] Regulatory figures confirmed — [regulatory-figures.md](regulatory-figures.md).
- ✅ Consent required, versioned and recorded; withdraw at any time.
- ✅ POPIA s23 export and s24 erasure; append-only audit log with 5-year floor.

## Partners

- [ ] Bureau agreements and integrations — [bureau-integration-checklist.md](bureau-integration-checklist.md) B1–B10, per bureau.
- [ ] Stitch live client and redirect whitelisting — checklist S1–S6.
- [ ] Decide on Ozow (integrate or drop).

## Infrastructure — [infra/terraform/README.md](../infra/terraform/README.md)

- [ ] AWS account hardening: GuardDuty, Security Hub, AWS Config, root MFA, SSO.
- [ ] Terraform state backend, ACM certificate, `terraform apply` for staging, then production.
- [ ] Migration owner secret, migrations run, `credisync_service` login created.
- [ ] DNS for the API, web and admin; SES DKIM/SPF/DMARC; SES production access in af-south-1.
- [ ] External secrets filled (Stitch, bureau webhooks).
- [ ] Web and admin hosted (static) on the same registrable domain as the API.
- [ ] CI/CD deploy role (GitHub OIDC) and deploy job.
- ✅ ECS Fargate, private networking, KMS everywhere, WAF, alarms, scheduled jobs, outbox to SNS.

## Operations

- [ ] Operations staff accounts created with the `admin` or `compliance_officer` role.
- [ ] Manual dispute lodging procedure written (download lodging PDF → submit via bureau channel →
      record bureau reference in admin).
- [ ] Monitoring of the ops mailbox and alarm topic; on-call owner.
- [ ] Incident response and breach-notification plan (POPIA s22).
- [ ] Penetration test of the deployed staging environment.

## Product

- [ ] SMS provider chosen (email only today, by decision).
- [ ] Bureau dispute API channel, once bureaus offer it (manual lodging works meanwhile).
- [ ] Mobile release builds: signing keys, `API_BASE_URL` set to HTTPS, store listings.
