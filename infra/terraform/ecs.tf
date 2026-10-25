# One ECS Fargate service per container. Internal services are reachable only
# inside the VPC through Cloud Map (<name>.credisync.internal) and still
# require the gateway's service token.

locals {
  ecr_repos = ["api-gateway", "auth", "bureau-ingestion", "dispute-engine", "open-banking", "bank-readiness", "jobs", "migrations"]

  internal_domain = "credisync.internal"
  url             = { for k, v in { auth = 4004, "bureau-ingestion" = 4001, "dispute-engine" = 4002, "open-banking" = 4003, "bank-readiness" = 8000 } : k => "http://${k}.${local.internal_domain}:${v}" }

  common_env = {
    NODE_ENV    = "production"
    AWS_REGION  = local.region
    KMS_KEY_ID  = aws_kms_key.app.arn
    TRUST_PROXY = "0"
    WEB_APP_URL = var.web_app_url
  }

  secret = {
    database_url           = aws_secretsmanager_secret.database_url.arn
    redis_url              = aws_secretsmanager_secret.redis_url.arn
    jwt_secret             = aws_secretsmanager_secret.generated["jwt_secret"].arn
    internal_service_token = aws_secretsmanager_secret.generated["internal_service_token"].arn
    hmac_key               = aws_secretsmanager_secret.generated["hmac_key"].arn
  }

  services = {
    "api-gateway" = {
      port   = 4000
      cpu    = 512
      memory = 1024
      public = true
      env = merge(local.common_env, {
        PORT                 = "4000"
        TRUST_PROXY          = "1"
        ALLOWED_ORIGINS      = join(",", var.web_origins)
        AUTH_SERVICE_URL     = local.url["auth"]
        BUREAU_INGESTION_URL = local.url["bureau-ingestion"]
        DISPUTE_ENGINE_URL   = local.url["dispute-engine"]
        OPEN_BANKING_URL     = local.url["open-banking"]
        BANK_READINESS_URL   = local.url["bank-readiness"]
      })
      secrets = { DATABASE_URL = local.secret.database_url, REDIS_URL = local.secret.redis_url, JWT_SECRET = local.secret.jwt_secret, INTERNAL_SERVICE_TOKEN = local.secret.internal_service_token }
      kms     = false
      s3      = false
      ses     = false
    }
    auth = {
      port    = 4004
      cpu     = 512
      memory  = 1024
      public  = false
      env     = merge(local.common_env, { PORT = "4004", SES_FROM_ADDRESS = var.email_from_address, SES_CONFIGURATION_SET = aws_sesv2_configuration_set.main.configuration_set_name })
      secrets = { DATABASE_URL = local.secret.database_url, JWT_SECRET = local.secret.jwt_secret, INTERNAL_SERVICE_TOKEN = local.secret.internal_service_token, HMAC_KEY = local.secret.hmac_key }
      kms     = true
      s3      = false
      ses     = true
    }
    "bureau-ingestion" = {
      port    = 4001
      cpu     = 512
      memory  = 1024
      public  = false
      env     = merge(local.common_env, { PORT = "4001", BUREAU_MODE = var.bureau_mode })
      secrets = { DATABASE_URL = local.secret.database_url, INTERNAL_SERVICE_TOKEN = local.secret.internal_service_token }
      kms     = true
      s3      = false
      ses     = false
    }
    "dispute-engine" = {
      port   = 4002
      cpu    = 512
      memory = 1024
      public = false
      env = merge(local.common_env, {
        PORT                       = "4002"
        DISPUTE_SUBMISSION_CHANNEL = "manual"
        DISPUTES_OPS_EMAIL         = var.ops_email
        EVIDENCE_BUCKET            = aws_s3_bucket.evidence.bucket
        SES_FROM_ADDRESS           = var.email_from_address
        SES_CONFIGURATION_SET      = aws_sesv2_configuration_set.main.configuration_set_name
      })
      secrets = {
        DATABASE_URL                     = local.secret.database_url
        INTERNAL_SERVICE_TOKEN           = local.secret.internal_service_token
        BUREAU_WEBHOOK_SECRET_TRANSUNION = aws_secretsmanager_secret.external["bureau_webhook_secret_transunion"].arn
        BUREAU_WEBHOOK_SECRET_EXPERIAN   = aws_secretsmanager_secret.external["bureau_webhook_secret_experian"].arn
        BUREAU_WEBHOOK_SECRET_XDS        = aws_secretsmanager_secret.external["bureau_webhook_secret_xds"].arn
      }
      kms = true
      s3  = true
      ses = true
    }
    "open-banking" = {
      port   = 4003
      cpu    = 512
      memory = 1024
      public = false
      env    = merge(local.common_env, { PORT = "4003", STITCH_CLIENT_ID = var.stitch_client_id, STITCH_REDIRECT_URI = var.stitch_redirect_uri })
      secrets = {
        DATABASE_URL           = local.secret.database_url
        INTERNAL_SERVICE_TOKEN = local.secret.internal_service_token
        STITCH_CLIENT_SECRET   = aws_secretsmanager_secret.external["stitch_client_secret"].arn
      }
      kms = true
      s3  = false
      ses = false
    }
    "bank-readiness" = {
      port    = 8000
      cpu     = 256
      memory  = 512
      public  = false
      env     = { NODE_ENV = "production" }
      secrets = { INTERNAL_SERVICE_TOKEN = local.secret.internal_service_token }
      kms     = false
      s3      = false
      ses     = false
    }
  }
}

resource "aws_ecr_repository" "repo" {
  for_each             = toset(local.ecr_repos)
  name                 = "credisync/${each.key}"
  image_tag_mutability = "IMMUTABLE"
  image_scanning_configuration {
    scan_on_push = true
  }
  encryption_configuration {
    encryption_type = "KMS"
    kms_key         = aws_kms_key.platform.arn
  }
}

resource "aws_ecr_lifecycle_policy" "repo" {
  for_each   = aws_ecr_repository.repo
  repository = each.value.name
  policy = jsonencode({
    rules = [{ rulePriority = 1, description = "Keep the last 50 images", selection = { tagStatus = "any", countType = "imageCountMoreThan", countNumber = 50 }, action = { type = "expire" } }]
  })
}

resource "aws_ecs_cluster" "main" {
  name = local.name
  setting {
    name  = "containerInsights"
    value = "enabled"
  }
}

resource "aws_service_discovery_private_dns_namespace" "internal" {
  name = local.internal_domain
  vpc  = aws_vpc.main.id
}

resource "aws_service_discovery_service" "svc" {
  for_each = { for k, v in local.services : k => v if !v.public }
  name     = each.key
  dns_config {
    namespace_id = aws_service_discovery_private_dns_namespace.internal.id
    dns_records {
      type = "A"
      ttl  = 10
    }
    routing_policy = "MULTIVALUE"
  }
  health_check_custom_config {
    failure_threshold = 1
  }
}

resource "aws_cloudwatch_log_group" "svc" {
  for_each          = merge(local.services, { jobs = {}, migrations = {} })
  name              = "/${local.name}/${each.key}"
  retention_in_days = var.log_retention_days
  kms_key_id        = aws_kms_key.platform.arn
}

# --- IAM ------------------------------------------------------------------------

data "aws_iam_policy_document" "ecs_assume" {
  statement {
    actions = ["sts:AssumeRole"]
    principals {
      type        = "Service"
      identifiers = ["ecs-tasks.amazonaws.com"]
    }
  }
}

# Execution role: pull images, write logs, read only this environment's secrets.
resource "aws_iam_role" "execution" {
  name               = "${local.name}-ecs-execution"
  assume_role_policy = data.aws_iam_policy_document.ecs_assume.json
}

resource "aws_iam_role_policy_attachment" "execution" {
  role       = aws_iam_role.execution.name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AmazonECSTaskExecutionRolePolicy"
}

resource "aws_iam_role_policy" "execution_secrets" {
  role = aws_iam_role.execution.id
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      { Effect = "Allow", Action = ["secretsmanager:GetSecretValue"], Resource = "arn:aws:secretsmanager:${local.region}:${data.aws_caller_identity.current.account_id}:secret:${local.name}/*" },
      { Effect = "Allow", Action = ["kms:Decrypt"], Resource = aws_kms_key.platform.arn },
    ]
  })
}

# Task roles: one per service, least privilege.
resource "aws_iam_role" "task" {
  for_each           = merge(local.services, { jobs = { kms = false, s3 = true, ses = true } })
  name               = "${local.name}-${each.key}"
  assume_role_policy = data.aws_iam_policy_document.ecs_assume.json
}

resource "aws_iam_role_policy" "task" {
  for_each = merge(local.services, { jobs = { kms = false, s3 = true, ses = true } })
  role     = aws_iam_role.task[each.key].id
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = concat(
      each.value.kms ? [{ Effect = "Allow", Action = ["kms:Encrypt", "kms:Decrypt", "kms:GenerateDataKey"], Resource = aws_kms_key.app.arn }] : [],
      each.value.s3 ? [
        { Effect = "Allow", Action = ["s3:PutObject", "s3:GetObject", "s3:DeleteObject", "s3:ListBucket"], Resource = [aws_s3_bucket.evidence.arn, "${aws_s3_bucket.evidence.arn}/*"] },
        { Effect = "Allow", Action = ["kms:GenerateDataKey", "kms:Decrypt"], Resource = aws_kms_key.app.arn },
      ] : [],
      each.value.ses ? [{ Effect = "Allow", Action = ["ses:SendEmail"], Resource = "*", Condition = { StringEquals = { "ses:FromAddress" = var.email_from_address } } }] : [],
      each.key == "jobs" ? [
        { Effect = "Allow", Action = ["sns:Publish"], Resource = aws_sns_topic.events.arn },
        { Effect = "Allow", Action = ["kms:GenerateDataKey", "kms:Decrypt"], Resource = aws_kms_key.platform.arn },
      ] : [],
      [{ Effect = "Allow", Action = ["logs:CreateLogStream", "logs:PutLogEvents"], Resource = "*" }],
    )
  })
}

# --- Task definitions and services ----------------------------------------------

resource "aws_ecs_task_definition" "svc" {
  for_each                 = local.services
  family                   = "${local.name}-${each.key}"
  requires_compatibilities = ["FARGATE"]
  network_mode             = "awsvpc"
  cpu                      = each.value.cpu
  memory                   = each.value.memory
  execution_role_arn       = aws_iam_role.execution.arn
  task_role_arn            = aws_iam_role.task[each.key].arn
  runtime_platform {
    operating_system_family = "LINUX"
    cpu_architecture        = "X86_64"
  }
  container_definitions = jsonencode([{
    name                   = each.key
    image                  = "${aws_ecr_repository.repo[each.key].repository_url}:${var.image_tag}"
    essential              = true
    readonlyRootFilesystem = true
    portMappings           = [{ containerPort = each.value.port, protocol = "tcp" }]
    environment            = [for k, v in each.value.env : { name = k, value = v } if v != ""]
    secrets                = [for k, v in each.value.secrets : { name = k, valueFrom = v }]
    logConfiguration = {
      logDriver = "awslogs"
      options = {
        awslogs-group         = aws_cloudwatch_log_group.svc[each.key].name
        awslogs-region        = local.region
        awslogs-stream-prefix = each.key
      }
    }
  }])
}

resource "aws_ecs_service" "svc" {
  for_each               = local.services
  name                   = each.key
  cluster                = aws_ecs_cluster.main.id
  task_definition        = aws_ecs_task_definition.svc[each.key].arn
  desired_count          = var.service_desired_count
  launch_type            = "FARGATE"
  enable_execute_command = false
  propagate_tags         = "SERVICE"

  network_configuration {
    subnets          = [for s in aws_subnet.private : s.id]
    security_groups  = [aws_security_group.services.id]
    assign_public_ip = false
  }

  deployment_circuit_breaker {
    enable   = true
    rollback = true
  }

  dynamic "load_balancer" {
    for_each = each.value.public ? [1] : []
    content {
      target_group_arn = aws_lb_target_group.gateway.arn
      container_name   = each.key
      container_port   = each.value.port
    }
  }

  dynamic "service_registries" {
    for_each = each.value.public ? [] : [1]
    content {
      registry_arn = aws_service_discovery_service.svc[each.key].arn
    }
  }
}

# --- One-off and scheduled tasks ----------------------------------------------------

resource "aws_secretsmanager_secret" "migration_url" {
  name        = "${local.name}/migration_database_url"
  kms_key_id  = aws_kms_key.platform.arn
  description = "Owner connection for migrations; set from the RDS-managed master secret (see README)."
}

resource "aws_ecs_task_definition" "jobs" {
  for_each                 = { jobs = ["node", "packages/jobs/dist/runner.js"], migrations = ["node", "packages/migrations/dist/runner.js", "up"] }
  family                   = "${local.name}-${each.key}"
  requires_compatibilities = ["FARGATE"]
  network_mode             = "awsvpc"
  cpu                      = 256
  memory                   = 512
  execution_role_arn       = aws_iam_role.execution.arn
  task_role_arn            = aws_iam_role.task["jobs"].arn
  container_definitions = jsonencode([{
    name       = each.key
    image      = "${aws_ecr_repository.repo[each.key].repository_url}:${var.image_tag}"
    essential  = true
    entryPoint = each.value
    environment = [for k, v in merge(local.common_env, {
      EVIDENCE_BUCKET       = aws_s3_bucket.evidence.bucket
      EVENTS_TOPIC_ARN      = aws_sns_topic.events.arn
      SES_FROM_ADDRESS      = var.email_from_address
      SES_CONFIGURATION_SET = aws_sesv2_configuration_set.main.configuration_set_name
    }) : { name = k, value = v }]
    secrets = each.key == "migrations" ? [{ name = "MIGRATION_DATABASE_URL", valueFrom = aws_secretsmanager_secret.migration_url.arn }] : [{ name = "DATABASE_URL", valueFrom = local.secret.database_url }]
    logConfiguration = {
      logDriver = "awslogs"
      options = {
        awslogs-group         = aws_cloudwatch_log_group.svc[each.key].name
        awslogs-region        = local.region
        awslogs-stream-prefix = each.key
      }
    }
  }])
}
