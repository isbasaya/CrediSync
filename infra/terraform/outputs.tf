output "alb_dns_name" {
  description = "Point api_domain (CNAME/alias) here."
  value       = aws_lb.main.dns_name
}

output "ecr_repositories" {
  value = { for k, r in aws_ecr_repository.repo : k => r.repository_url }
}

output "app_kms_key_arn" {
  description = "KMS_KEY_ID for the services (envelope encryption)."
  value       = aws_kms_key.app.arn
}

output "evidence_bucket" {
  value = aws_s3_bucket.evidence.bucket
}

output "events_topic_arn" {
  value = aws_sns_topic.events.arn
}

output "database_endpoint" {
  value = aws_db_instance.main.address
}

output "database_owner_secret_arn" {
  description = "RDS-managed owner credentials (used to build the migration URL and to bootstrap the app role)."
  value       = aws_db_instance.main.master_user_secret[0].secret_arn
}

output "ses_dkim_tokens" {
  description = "Publish these as CNAME records <token>._domainkey.<email_domain> → <token>.dkim.amazonses.com."
  value       = aws_sesv2_email_identity.domain.dkim_signing_attributes[0].tokens
}

output "migration_task_definition" {
  value = aws_ecs_task_definition.jobs["migrations"].arn
}
