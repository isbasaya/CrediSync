variable "environment" {
  description = "Environment name: staging or production."
  type        = string
  validation {
    condition     = contains(["staging", "production"], var.environment)
    error_message = "environment must be staging or production"
  }
}

variable "api_domain" {
  description = "Public hostname for the API gateway, e.g. api.credisync.co.za."
  type        = string
}

variable "web_origins" {
  description = "Browser origins allowed to call the API with cookies (web and admin apps)."
  type        = list(string)
}

variable "web_app_url" {
  description = "Base URL of the consumer web app (used in email links)."
  type        = string
}

variable "acm_certificate_arn" {
  description = "ACM certificate (in af-south-1) covering api_domain."
  type        = string
}

variable "email_domain" {
  description = "Domain verified in SES for sending mail, e.g. credisync.co.za."
  type        = string
}

variable "email_from_address" {
  description = "From address for transactional email, e.g. no-reply@credisync.co.za."
  type        = string
}

variable "ops_email" {
  description = "Operations mailbox that receives dispute lodging notices and alarms."
  type        = string
}

variable "image_tag" {
  description = "Container image tag (git SHA) to deploy for every service."
  type        = string
}

variable "vpc_cidr" {
  type    = string
  default = "10.20.0.0/16"
}

variable "db_instance_class" {
  type    = string
  default = "db.t4g.medium"
}

variable "db_multi_az" {
  description = "Multi-AZ standby for the database (recommended for production)."
  type        = bool
  default     = true
}

variable "nat_gateway_per_az" {
  description = "One NAT gateway per AZ (production) or a single shared one (staging, cheaper)."
  type        = bool
  default     = true
}

variable "stitch_client_id" {
  description = "Stitch client id (leave empty to keep bank linking disabled)."
  type        = string
  default     = ""
}

variable "stitch_redirect_uri" {
  description = "Stitch redirect URI (the web app's /bank/callback), whitelisted with Stitch."
  type        = string
  default     = ""
}

variable "bureau_mode" {
  description = "Empty for real bureaus. 'sandbox' is refused by the services outside development."
  type        = string
  default     = ""
}

variable "service_desired_count" {
  description = "Tasks per service."
  type        = number
  default     = 2
}

variable "log_retention_days" {
  type    = number
  default = 90
}
