terraform {
  required_version = ">= 1.10, < 2.0"
  required_providers {
    aws = {
      source = "hashicorp/aws", version = "~> 6.0"
    }
    random = {
      source = "hashicorp/random", version = "~> 3.7"
    }
  }
}
provider "aws" {
  region              = var.region
  profile             = var.aws_profile
  allowed_account_ids = [var.account_id]
  default_tags {
    tags = {
      Project = "foodmenu", Environment = var.environment, ManagedBy = "Terraform"
    }
  }
}
