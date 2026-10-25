# EventBridge Scheduler runs the jobs image on a schedule (times in SAST).

locals {
  schedules = {
    outbox     = { expression = "rate(1 minute)", args = ["outbox"] }
    deadlines  = { expression = "cron(5 * * * ? *)", args = ["deadlines"] }
    deletions  = { expression = "cron(20 * * * ? *)", args = ["deletions"] }
    retention  = { expression = "cron(30 2 * * ? *)", args = ["retention"] }
    partitions = { expression = "cron(0 3 1 * ? *)", args = ["partitions"] }
  }
}

resource "aws_iam_role" "scheduler" {
  name = "${local.name}-scheduler"
  assume_role_policy = jsonencode({
    Version   = "2012-10-17"
    Statement = [{ Effect = "Allow", Principal = { Service = "scheduler.amazonaws.com" }, Action = "sts:AssumeRole" }]
  })
}

resource "aws_iam_role_policy" "scheduler" {
  role = aws_iam_role.scheduler.id
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      { Effect = "Allow", Action = ["ecs:RunTask"], Resource = "${replace(aws_ecs_task_definition.jobs["jobs"].arn, "/:\\d+$/", "")}:*" },
      { Effect = "Allow", Action = ["iam:PassRole"], Resource = [aws_iam_role.execution.arn, aws_iam_role.task["jobs"].arn] },
    ]
  })
}

resource "aws_scheduler_schedule" "jobs" {
  for_each                     = local.schedules
  name                         = "${local.name}-${each.key}"
  schedule_expression          = each.value.expression
  schedule_expression_timezone = "Africa/Johannesburg"
  flexible_time_window {
    mode = "OFF"
  }
  target {
    arn      = aws_ecs_cluster.main.arn
    role_arn = aws_iam_role.scheduler.arn
    ecs_parameters {
      task_definition_arn = aws_ecs_task_definition.jobs["jobs"].arn
      launch_type         = "FARGATE"
      network_configuration {
        subnets          = [for s in aws_subnet.private : s.id]
        security_groups  = [aws_security_group.services.id]
        assign_public_ip = false
      }
    }
    input = jsonencode({ containerOverrides = [{ name = "jobs", command = each.value.args }] })
    retry_policy {
      maximum_retry_attempts = 2
    }
  }
}

# --- Alarms -----------------------------------------------------------------------

resource "aws_sns_topic" "alarms" {
  name              = "${local.name}-alarms"
  kms_master_key_id = aws_kms_key.platform.arn
}

resource "aws_sns_topic_subscription" "alarms_email" {
  topic_arn = aws_sns_topic.alarms.arn
  protocol  = "email"
  endpoint  = var.ops_email
}

resource "aws_cloudwatch_metric_alarm" "gateway_5xx" {
  alarm_name          = "${local.name}-gateway-5xx"
  namespace           = "AWS/ApplicationELB"
  metric_name         = "HTTPCode_Target_5XX_Count"
  dimensions          = { LoadBalancer = aws_lb.main.arn_suffix, TargetGroup = aws_lb_target_group.gateway.arn_suffix }
  statistic           = "Sum"
  period              = 300
  evaluation_periods  = 1
  threshold           = 25
  comparison_operator = "GreaterThanThreshold"
  treat_missing_data  = "notBreaching"
  alarm_actions       = [aws_sns_topic.alarms.arn]
}

resource "aws_cloudwatch_metric_alarm" "db_storage" {
  alarm_name          = "${local.name}-db-free-storage"
  namespace           = "AWS/RDS"
  metric_name         = "FreeStorageSpace"
  dimensions          = { DBInstanceIdentifier = aws_db_instance.main.identifier }
  statistic           = "Minimum"
  period              = 300
  evaluation_periods  = 2
  threshold           = 5 * 1024 * 1024 * 1024
  comparison_operator = "LessThanThreshold"
  alarm_actions       = [aws_sns_topic.alarms.arn]
}

resource "aws_cloudwatch_metric_alarm" "db_cpu" {
  alarm_name          = "${local.name}-db-cpu"
  namespace           = "AWS/RDS"
  metric_name         = "CPUUtilization"
  dimensions          = { DBInstanceIdentifier = aws_db_instance.main.identifier }
  statistic           = "Average"
  period              = 300
  evaluation_periods  = 3
  threshold           = 80
  comparison_operator = "GreaterThanThreshold"
  alarm_actions       = [aws_sns_topic.alarms.arn]
}

resource "aws_cloudwatch_metric_alarm" "events_dlq" {
  alarm_name          = "${local.name}-events-dlq"
  namespace           = "AWS/SQS"
  metric_name         = "ApproximateNumberOfMessagesVisible"
  dimensions          = { QueueName = aws_sqs_queue.events_dlq.name }
  statistic           = "Maximum"
  period              = 300
  evaluation_periods  = 1
  threshold           = 0
  comparison_operator = "GreaterThanThreshold"
  alarm_actions       = [aws_sns_topic.alarms.arn]
}
