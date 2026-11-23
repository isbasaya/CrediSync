data "aws_caller_identity" "current" {}

# --- KMS ----------------------------------------------------------------------
# platform: encrypts infrastructure (RDS, S3, logs, SNS/SQS, secrets).
# app:      the envelope-encryption key the services use for SA ID numbers and
#           bank tokens (KMS_KEY_ID); only the services that decrypt them may use it.

data "aws_iam_policy_document" "platform_key" {
  statement {
    sid       = "AccountAdmin"
    actions   = ["kms:*"]
    resources = ["*"]
    principals {
      type        = "AWS"
      identifiers = ["arn:aws:iam::${data.aws_caller_identity.current.account_id}:root"]
    }
  }
  statement {
    sid       = "AllowAwsServices"
    actions   = ["kms:Encrypt", "kms:Decrypt", "kms:ReEncrypt*", "kms:GenerateDataKey*", "kms:DescribeKey"]
    resources = ["*"]
    principals {
      type        = "Service"
      identifiers = ["logs.${local.region}.amazonaws.com", "sns.amazonaws.com", "sqs.amazonaws.com", "s3.amazonaws.com", "scheduler.amazonaws.com"]
    }
  }
}

resource "aws_kms_key" "platform" {
  description             = "${local.name} platform encryption"
  enable_key_rotation     = true
  deletion_window_in_days = 30
  policy                  = data.aws_iam_policy_document.platform_key.json
}

resource "aws_kms_alias" "platform" {
  name          = "alias/${local.name}-platform"
  target_key_id = aws_kms_key.platform.key_id
}

resource "aws_kms_key" "app" {
  description             = "${local.name} application envelope encryption (SA ID numbers, bank tokens)"
  enable_key_rotation     = true
  deletion_window_in_days = 30
}

resource "aws_kms_alias" "app" {
  name          = "alias/${local.name}-app"
  target_key_id = aws_kms_key.app.key_id
}

# --- Database -----------------------------------------------------------------

resource "aws_db_subnet_group" "main" {
  name       = local.name
  subnet_ids = [for s in aws_subnet.private : s.id]
}

resource "aws_db_parameter_group" "postgres" {
  name   = "${local.name}-pg15"
  family = "postgres15"
  parameter {
    name  = "rds.force_ssl"
    value = "1"
  }
  parameter {
    name  = "log_min_duration_statement"
    value = "1000"
  }
  # Never log statement parameters: they can contain personal information.
  parameter {
    name  = "log_statement"
    value = "ddl"
  }
}

resource "aws_db_instance" "main" {
  identifier                      = local.name
  engine                          = "postgres"
  engine_version                  = "15"
  instance_class                  = var.db_instance_class
  allocated_storage               = 50
  max_allocated_storage           = 500
  storage_type                    = "gp3"
  storage_encrypted               = true
  kms_key_id                      = aws_kms_key.platform.arn
  db_name                         = "credisync"
  username                        = "credisync_owner"
  manage_master_user_password     = true # Secrets Manager rotates the owner password
  master_user_secret_kms_key_id   = aws_kms_key.platform.arn
  db_subnet_group_name            = aws_db_subnet_group.main.name
  vpc_security_group_ids          = [aws_security_group.database.id]
  parameter_group_name            = aws_db_parameter_group.postgres.name
  multi_az                        = var.db_multi_az
  publicly_accessible             = false
  backup_retention_period         = 35
  deletion_protection             = true
  copy_tags_to_snapshot           = true
  skip_final_snapshot             = false
  final_snapshot_identifier       = "${local.name}-final"
  auto_minor_version_upgrade      = true
  performance_insights_enabled    = true
  performance_insights_kms_key_id = aws_kms_key.platform.arn
  enabled_cloudwatch_logs_exports = ["postgresql"]
}

# --- Redis (shared rate limiting) -----------------------------------------------

resource "aws_elasticache_subnet_group" "main" {
  name       = local.name
  subnet_ids = [for s in aws_subnet.private : s.id]
}

resource "random_password" "redis_auth" {
  length  = 48
  special = false
}

resource "aws_elasticache_replication_group" "main" {
  replication_group_id       = local.name
  description                = "CrediSync rate limiting"
  engine                     = "redis"
  engine_version             = "7.1"
  node_type                  = "cache.t4g.small"
  num_cache_clusters         = 2
  automatic_failover_enabled = true
  multi_az_enabled           = true
  subnet_group_name          = aws_elasticache_subnet_group.main.name
  security_group_ids         = [aws_security_group.redis.id]
  at_rest_encryption_enabled = true
  kms_key_id                 = aws_kms_key.platform.arn
  transit_encryption_enabled = true
  auth_token                 = random_password.redis_auth.result
}

# --- Evidence bucket --------------------------------------------------------------

resource "aws_s3_bucket" "evidence" {
  bucket = "${local.name}-dispute-evidence-${data.aws_caller_identity.current.account_id}"
}

resource "aws_s3_bucket_public_access_block" "evidence" {
  bucket                  = aws_s3_bucket.evidence.id
  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

resource "aws_s3_bucket_ownership_controls" "evidence" {
  bucket = aws_s3_bucket.evidence.id
  rule {
    object_ownership = "BucketOwnerEnforced"
  }
}

resource "aws_s3_bucket_server_side_encryption_configuration" "evidence" {
  bucket = aws_s3_bucket.evidence.id
  rule {
    apply_server_side_encryption_by_default {
      sse_algorithm     = "aws:kms"
      kms_master_key_id = aws_kms_key.app.arn
    }
    bucket_key_enabled = true
  }
}

resource "aws_s3_bucket_versioning" "evidence" {
  bucket = aws_s3_bucket.evidence.id
  versioning_configuration {
    status = "Enabled"
  }
}

resource "aws_s3_bucket_lifecycle_configuration" "evidence" {
  bucket = aws_s3_bucket.evidence.id
  rule {
    id     = "expire-deleted-versions"
    status = "Enabled"
    filter {}
    # POPIA erasure deletes objects; old versions must not linger.
    noncurrent_version_expiration {
      noncurrent_days = 7
    }
    abort_incomplete_multipart_upload {
      days_after_initiation = 1
    }
  }
}

resource "aws_s3_bucket_cors_configuration" "evidence" {
  bucket = aws_s3_bucket.evidence.id
  cors_rule {
    allowed_methods = ["PUT"]
    allowed_origins = var.web_origins
    allowed_headers = ["content-type", "x-amz-server-side-encryption", "x-amz-server-side-encryption-aws-kms-key-id", "if-none-match"]
    max_age_seconds = 600
  }
}

resource "aws_s3_bucket_policy" "evidence" {
  bucket = aws_s3_bucket.evidence.id
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Sid       = "TlsOnly"
      Effect    = "Deny"
      Principal = "*"
      Action    = "s3:*"
      Resource  = [aws_s3_bucket.evidence.arn, "${aws_s3_bucket.evidence.arn}/*"]
      Condition = { Bool = { "aws:SecureTransport" = "false" } }
    }]
  })
}

# --- Events (transactional outbox → SNS → SQS) -------------------------------------

resource "aws_sns_topic" "events" {
  name              = "${local.name}-domain-events"
  kms_master_key_id = aws_kms_key.platform.arn
}

resource "aws_sqs_queue" "events_dlq" {
  name                      = "${local.name}-events-dlq"
  message_retention_seconds = 1209600
  kms_master_key_id         = aws_kms_key.platform.arn
}

# Example subscriber: analytics/reporting consumers read from here. Add one
# queue per consumer with a filter policy on event_type.
resource "aws_sqs_queue" "events_analytics" {
  name                       = "${local.name}-events-analytics"
  visibility_timeout_seconds = 60
  kms_master_key_id          = aws_kms_key.platform.arn
  redrive_policy             = jsonencode({ deadLetterTargetArn = aws_sqs_queue.events_dlq.arn, maxReceiveCount = 5 })
}

resource "aws_sqs_queue_policy" "events_analytics" {
  queue_url = aws_sqs_queue.events_analytics.id
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect    = "Allow"
      Principal = { Service = "sns.amazonaws.com" }
      Action    = "sqs:SendMessage"
      Resource  = aws_sqs_queue.events_analytics.arn
      Condition = { ArnEquals = { "aws:SourceArn" = aws_sns_topic.events.arn } }
    }]
  })
}

resource "aws_sns_topic_subscription" "events_analytics" {
  topic_arn            = aws_sns_topic.events.arn
  protocol             = "sqs"
  endpoint             = aws_sqs_queue.events_analytics.arn
  raw_message_delivery = true
}

# --- Email (SES in af-south-1) --------------------------------------------------------

resource "aws_sesv2_email_identity" "domain" {
  email_identity         = var.email_domain
  configuration_set_name = aws_sesv2_configuration_set.main.configuration_set_name
}

resource "aws_sesv2_configuration_set" "main" {
  configuration_set_name = local.name
  reputation_options {
    reputation_metrics_enabled = true
  }
  suppression_options {
    suppressed_reasons = ["BOUNCE", "COMPLAINT"]
  }
}
