terraform {
  required_version = ">= 1.6.0"

  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.70"
    }
    random = {
      source  = "hashicorp/random"
      version = "~> 3.6"
    }
  }

  # State lives in af-south-1 too. Create the bucket and lock table once
  # (see README.md), then: terraform init -backend-config=backend.hcl
  backend "s3" {}
}

provider "aws" {
  # POPIA data residency: every resource in this stack is created in Cape Town.
  region = "af-south-1"

  default_tags {
    tags = {
      Project     = "credisync"
      Environment = var.environment
      ManagedBy   = "terraform"
      DataClass   = "personal-information"
    }
  }
}

locals {
  name   = "credisync-${var.environment}"
  region = "af-south-1"
  azs    = ["af-south-1a", "af-south-1b"]
}
