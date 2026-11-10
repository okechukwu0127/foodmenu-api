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
variable "environment" {
  type    = string
  default = "staging"
  validation {
    condition     = can(regex("^[a-z][a-z0-9-]{1,20}$", var.environment))
    error_message = "Use a short lowercase environment name."
  }
}
variable "instance_type" {
  type    = string
  default = "t4g.medium"
  validation {
    condition     = startswith(var.instance_type, "t4g.")
    error_message = "This image/deployment is ARM64; use a t4g instance."
  }
}
variable "ami_id" {
  description = "Optionally pin an approved Ubuntu 22.04 ARM64 AMI. New AMIs may require instance replacement, blocked by prevent_destroy."
  type        = string
  default     = null
}
variable "disk_gb" {
  type    = number
  default = 60
  validation {
    condition     = var.disk_gb >= 30
    error_message = "At least 30 GiB is needed for images and persistent application data."
  }
}
variable "backup_retention_days" {
  type    = number
  default = 14
}
