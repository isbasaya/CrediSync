# CrediSync infrastructure (Terraform, AWS af-south-1)

Everything runs in **Africa (Cape Town), `af-south-1`** for POPIA data residency.

```
Internet ─► WAF ─► ALB (HTTPS, TLS 1.2+) ─► api-gateway ─┬─► auth / bureau-ingestion / dispute-engine
                                            (ECS Fargate) ├─► open-banking / bank-readiness   (Cloud Map, private)
                                                          └─► Redis (rate limits)
            all services ─► RDS PostgreSQL 15 (Multi-AZ, KMS, private, force SSL)
            EventBridge Scheduler ─► jobs task (outbox, deadlines, erasure, retention, partitions)
            outbox ─► SNS (KMS) ─► SQS subscribers (+ DLQ alarm)
            SES (af-south-1, HTTPS API) for email · S3 evidence bucket (KMS, TLS-only, versioned)
```

Two KMS keys: **platform** (RDS, S3 logs, Secrets Manager, SNS/SQS, CloudWatch) and **app**
(envelope encryption of SA ID numbers and bank tokens; only auth, bureau-ingestion,
dispute-engine and open-banking can use it). Each service has its own task role.

## One-time bootstrap

1. **State backend** (once per AWS account):
   ```bash
   aws s3api create-bucket --bucket <org>-credisync-tfstate --region af-south-1 \
     --create-bucket-configuration LocationConstraint=af-south-1
   aws s3api put-bucket-versioning --bucket <org>-credisync-tfstate --versioning-configuration Status=Enabled
   aws s3api put-bucket-encryption --bucket <org>-credisync-tfstate \
     --server-side-encryption-configuration '{"Rules":[{"ApplyServerSideEncryptionByDefault":{"SSEAlgorithm":"aws:kms"}}]}'
   aws dynamodb create-table --table-name credisync-tflock --region af-south-1 \
     --attribute-definitions AttributeName=LockID,AttributeType=S --key-schema AttributeName=LockID,KeyType=HASH \
     --billing-mode PAY_PER_REQUEST
   ```
   Copy `backend.hcl.example` to `backend.hcl` and fill in the bucket name.
2. **Certificate:** request an ACM certificate for `api_domain` **in af-south-1** and validate it.
3. **Variables:** copy `staging.tfvars.example` and fill it in.
4. **Images:** the first apply creates ECR repositories. Push one image per service tagged with the
   git SHA (CI builds them; see `.github/workflows/ci.yml`), then apply with `image_tag=<sha>`.
   ```bash
   terraform init -backend-config=backend.hcl
   terraform apply -var-file=staging.tfvars -var image_tag=<sha>
   ```

## After the first apply

1. **Migration connection.** Read the RDS-managed owner secret (`database_owner_secret_arn`
   output) and store the owner URL in `credisync-<env>/migration_database_url`:
   `postgresql://credisync_owner:<password>@<database_endpoint>:5432/credisync?sslmode=require`
   (RDS rotates the owner password; update this secret after rotation, or run migrations from CI
   with the RDS secret directly.)
2. **Run migrations** (creates the schema and the non-owner `credisync_app` role):
   ```bash
   aws ecs run-task --cluster credisync-<env> --launch-type FARGATE \
     --task-definition <migration_task_definition> \
     --network-configuration 'awsvpcConfiguration={subnets=[<private-subnet>],securityGroups=[<services-sg>]}'
   ```
3. **Create the application login** (once, as the owner), using the generated password in
   `credisync-<env>/db_app_password`:
   ```sql
   CREATE ROLE credisync_service LOGIN PASSWORD '<db_app_password>' IN ROLE credisync_app;
   ```
   Services connect as `credisync_service`, so row-level security always applies.
4. **DNS:** point `api_domain` at `alb_dns_name`; publish the three SES DKIM CNAMEs from
   `ses_dkim_tokens`; add SPF and a DMARC record for `email_domain`. Ask AWS to move SES out of
   the sandbox for af-south-1 before launch.
5. **External secrets** — replace the `SET-ME-…` placeholders (Terraform never overwrites them):
   `credisync-<env>/stitch_client_secret` and `credisync-<env>/bureau_webhook_secret_{transunion,experian,xds}`.
   Then set `stitch_client_id` / `stitch_redirect_uri` and re-apply to enable bank linking.
6. **Ops mailbox:** confirm the SNS email subscription sent to `ops_email` (alarms).

## Deploying a new version

CI builds and pushes images tagged with the commit SHA. Then:

1. run the migration task with the new image (migrations are forward-only and advisory-locked);
2. `terraform apply -var image_tag=<sha>` — ECS rolls each service with the deployment circuit
   breaker (automatic rollback on failed health checks).

## Web and admin apps

Both Next.js apps build to static pages (no server-side personal data). Host them on S3 behind
CloudFront, or any static host, with the API at `api_domain`. Keep `web_origins` in sync with their
URLs, and serve them from the same registrable domain as the API (e.g. `app.` and `api.credisync.co.za`)
so the `SameSite=Strict` session cookie is sent.

## Not covered yet

- CI/CD deployment role (GitHub OIDC → AWS) and the deploy job itself.
- Backups of SNS/SQS consumers, cross-region disaster recovery (af-south-1 only by design;
  a second-region copy needs a POPIA s72 cross-border assessment first).
- AWS Config / GuardDuty / Security Hub — recommended at the account level.
