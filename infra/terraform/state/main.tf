terraform {
  required_version = ">= 1.10, < 2.0"
  required_providers {
    aws = {
      source = "hashicorp/aws", version = "~> 6.0"
    }
  }
}
variable "aws_profile" {
  type    = string
  default = "foodmenu-deploy-PowerUserAccess-844706634415"
}
variable "account_id" {
  type    = string
  default = "844706634415"
}
variable "region" {
  type    = string
  default = "eu-west-2"
}
provider "aws" {
  region              = var.region
  profile             = var.aws_profile
  allowed_account_ids = [var.account_id]
}
resource "aws_s3_bucket" "state" {
  bucket = "foodmenu-tfstate-${var.account_id}-${var.region}"
  lifecycle {
    prevent_destroy = true
  }
}
resource "aws_s3_bucket_versioning" "state" {
  bucket = aws_s3_bucket.state.id
  versioning_configuration {
    status = "Enabled"
  }
}
resource "aws_s3_bucket_public_access_block" "state" {
  bucket                  = aws_s3_bucket.state.id
  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}
resource "aws_s3_bucket_server_side_encryption_configuration" "state" {
  bucket = aws_s3_bucket.state.id
  rule {
    apply_server_side_encryption_by_default {
      sse_algorithm = "AES256"
    }
  }
}
output "bucket" {
  value = aws_s3_bucket.state.bucket
}
