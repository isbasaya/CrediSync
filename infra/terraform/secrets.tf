# Generated secrets are stored in Secrets Manager (encrypted with the platform
# key) and injected into tasks at start-up; they never appear in task
# definitions or images. Externally issued secrets (Stitch, bureau webhooks)
# are created empty-ish and filled in by an operator; Terraform then ignores
# their value so it never overwrites a real credential.

resource "random_password" "generated" {
  for_each = toset(["jwt_secret", "internal_service_token", "hmac_key", "db_app_password"])
  length   = 64
  special  = false
}

resource "aws_secretsmanager_secret" "generated" {
  for_each   = random_password.generated
  name       = "${local.name}/${each.key}"
  kms_key_id = aws_kms_key.platform.arn
}

resource "aws_secretsmanager_secret_version" "generated" {
  for_each      = random_password.generated
  secret_id     = aws_secretsmanager_secret.generated[each.key].id
  secret_string = each.value.result
}

# Application database login (member of the non-owner credisync_app role, so
# row-level security always applies). Created by the bootstrap step in
# infra/terraform/README.md using this password.
resource "aws_secretsmanager_secret" "database_url" {
  name       = "${local.name}/database_url"
  kms_key_id = aws_kms_key.platform.arn
}

resource "aws_secretsmanager_secret_version" "database_url" {
  secret_id     = aws_secretsmanager_secret.database_url.id
  secret_string = "postgresql://credisync_service:${random_password.generated["db_app_password"].result}@${aws_db_instance.main.address}:5432/credisync?sslmode=require"
}

resource "aws_secretsmanager_secret" "redis_url" {
  name       = "${local.name}/redis_url"
  kms_key_id = aws_kms_key.platform.arn
}

resource "aws_secretsmanager_secret_version" "redis_url" {
  secret_id     = aws_secretsmanager_secret.redis_url.id
  secret_string = "rediss://:${random_password.redis_auth.result}@${aws_elasticache_replication_group.main.primary_endpoint_address}:6379"
}

locals {
  external_secrets = [
    "stitch_client_secret",
    "bureau_webhook_secret_transunion",
    "bureau_webhook_secret_experian",
    "bureau_webhook_secret_xds",
  ]
}

resource "aws_secretsmanager_secret" "external" {
  for_each   = toset(local.external_secrets)
  name       = "${local.name}/${each.key}"
  kms_key_id = aws_kms_key.platform.arn
}

resource "aws_secretsmanager_secret_version" "external" {
  for_each      = aws_secretsmanager_secret.external
  secret_id     = each.value.id
  secret_string = "SET-ME-${each.key}"
  lifecycle {
    ignore_changes = [secret_string]
  }
}
