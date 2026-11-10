locals {
  name              = "foodmenu-${var.environment}"
  runtime_parameter = "/foodmenu/${var.environment}/runtime-env"
}
data "aws_caller_identity" "current" {
}
data "aws_availability_zones" "available" {
  state = "available"
}
data "aws_ami" "ubuntu" {
  most_recent = true
  owners      = ["099720109477"]
  filter {
    name   = "name"
    values = ["ubuntu/images/hvm-ssd/ubuntu-jammy-22.04-arm64-server-*"]
  }
  filter {
    name   = "virtualization-type"
    values = ["hvm"]
  }
}
data "aws_ec2_managed_prefix_list" "cloudfront" {
  name = "com.amazonaws.global.cloudfront.origin-facing"
}
data "aws_cloudfront_cache_policy" "disabled" {
  name = "Managed-CachingDisabled"
}
data "aws_cloudfront_origin_request_policy" "viewer" {
  name = "Managed-AllViewerExceptHostHeader"
}
resource "aws_vpc" "app" {
  cidr_block           = "10.42.0.0/16"
  enable_dns_hostnames = true
  enable_dns_support   = true
  tags = {
    Name = local.name
  }
}
resource "aws_internet_gateway" "app" {
  vpc_id = aws_vpc.app.id
}
resource "aws_subnet" "app" {
  vpc_id                  = aws_vpc.app.id
  cidr_block              = "10.42.1.0/24"
  availability_zone       = data.aws_availability_zones.available.names[0]
  map_public_ip_on_launch = false
}
resource "aws_route_table" "app" {
  vpc_id = aws_vpc.app.id
  route {
    cidr_block = "0.0.0.0/0"
    gateway_id = aws_internet_gateway.app.id
  }
}
resource "aws_route_table_association" "app" {
  subnet_id      = aws_subnet.app.id
  route_table_id = aws_route_table.app.id
}
resource "aws_security_group" "app" {
  name        = local.name
  description = "Only CloudFront origin traffic; management uses SSM, no inbound SSH/database/TCP ports"
  vpc_id      = aws_vpc.app.id
  ingress {
    from_port       = 80
    to_port         = 80
    protocol        = "tcp"
    prefix_list_ids = [data.aws_ec2_managed_prefix_list.cloudfront.id]
  }
  egress {
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }
}
resource "random_password" "origin" {
  length  = 48
  special = false
}
resource "aws_s3_bucket" "private" {
  bucket = "${local.name}-artifacts-${var.account_id}-${var.region}"
  lifecycle {
    prevent_destroy = true
  }
}
resource "aws_s3_bucket_public_access_block" "private" {
  bucket                  = aws_s3_bucket.private.id
  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}
resource "aws_s3_bucket_versioning" "private" {
  bucket = aws_s3_bucket.private.id
  versioning_configuration {
    status = "Enabled"
  }
}
resource "aws_s3_bucket_server_side_encryption_configuration" "private" {
  bucket = aws_s3_bucket.private.id
  rule {
    apply_server_side_encryption_by_default {
      sse_algorithm = "AES256"
    }
  }
}
resource "aws_s3_bucket_lifecycle_configuration" "private" {
  bucket     = aws_s3_bucket.private.id
  depends_on = [aws_s3_bucket_versioning.private]
  rule {
    id     = "backups"
    status = "Enabled"
    filter {
      prefix = "backups/"
    }
    expiration {
      days = var.backup_retention_days
    }
    noncurrent_version_expiration {
      noncurrent_days = 7
    }
  }
  rule {
    id     = "deployments"
    status = "Enabled"
    filter {
      prefix = "deploy/"
    }
    expiration {
      days = 7
    }
    noncurrent_version_expiration {
      noncurrent_days = 1
    }
    abort_incomplete_multipart_upload {
      days_after_initiation = 1
    }
  }
}
resource "aws_ecr_repository" "app" {
  name                 = local.name
  image_tag_mutability = "IMMUTABLE"
  image_scanning_configuration {
    scan_on_push = true
  }
  encryption_configuration {
    encryption_type = "AES256"
  }
  lifecycle {
    prevent_destroy = true
  }
}
resource "aws_ecr_lifecycle_policy" "app" {
  repository = aws_ecr_repository.app.name
  policy = jsonencode({
    rules = [
      for i, prefix in ["runtime-", "tools-"] : {
        rulePriority = i + 1
        description  = "Keep three ${prefix} releases"
        selection = {
          tagStatus = "tagged", tagPrefixList = [prefix], countType = "imageCountMoreThan", countNumber = 3
        }
        action = {
          type = "expire"
        }
      }
    ]
    }
  )
}
resource "aws_iam_role" "app" {
  name                 = "${local.name}-instance"
  permissions_boundary = "arn:aws:iam::aws:policy/PowerUserAccess"
  assume_role_policy = jsonencode({
    Version = "2012-10-17", Statement = [{
      Effect = "Allow", Action = "sts:AssumeRole", Principal = {
        Service = "ec2.amazonaws.com"
      }
      }
    ]
    }
  )
}
resource "aws_iam_role_policy" "app" {
  name = "${local.name}-runtime"
  role = aws_iam_role.app.id
  policy = jsonencode({
    Version = "2012-10-17", Statement = [
      {
        Effect = "Allow", Action = [
          "ssm:DescribeAssociation", "ssm:GetDeployablePatchSnapshotForInstance",
          "ssm:GetDocument", "ssm:DescribeDocument", "ssm:GetManifest",
          "ssm:ListAssociations", "ssm:ListInstanceAssociations", "ssm:PutInventory",
          "ssm:PutComplianceItems", "ssm:PutConfigurePackageResult",
          "ssm:UpdateAssociationStatus", "ssm:UpdateInstanceAssociationStatus",
          "ssm:UpdateInstanceInformation", "ssmmessages:CreateControlChannel",
          "ssmmessages:CreateDataChannel", "ssmmessages:OpenControlChannel",
          "ssmmessages:OpenDataChannel", "ec2messages:AcknowledgeMessage",
          "ec2messages:DeleteMessage", "ec2messages:FailMessage", "ec2messages:GetEndpoint",
          "ec2messages:GetMessages", "ec2messages:SendReply"
        ], Resource = "*"
      }
      ,
      {
        Effect = "Allow", Action = ["ssm:GetParameter", "ssm:GetParameters"], Resource = "arn:aws:ssm:${var.region}:${var.account_id}:parameter${local.runtime_parameter}"
      }
      ,
      {
        Effect = "Allow", Action = "kms:Decrypt", Resource = "*", Condition = {
          StringEquals = {
            "kms:ViaService" = "ssm.${var.region}.amazonaws.com", "kms:CallerAccount" = var.account_id
          }
        }
      }
      ,
      {
        Effect = "Allow", Action = "ecr:GetAuthorizationToken", Resource = "*"
      }
      ,
      {
        Effect = "Allow", Action = ["ecr:BatchGetImage", "ecr:GetDownloadUrlForLayer", "ecr:BatchCheckLayerAvailability"], Resource = aws_ecr_repository.app.arn
      }
      ,
      {
        Effect = "Allow", Action = "s3:ListBucket", Resource = aws_s3_bucket.private.arn, Condition = {
          StringLike = {
            "s3:prefix" = ["deploy/*", "backups/*"]
          }
        }
      }
      ,
      {
        Effect = "Allow", Action = ["s3:GetObject", "s3:PutObject"], Resource = ["${aws_s3_bucket.private.arn}/deploy/*", "${aws_s3_bucket.private.arn}/backups/*"]
      }
    ]
    }
  )
}
resource "aws_iam_instance_profile" "app" {
  name = "${local.name}-instance"
  role = aws_iam_role.app.name
}
resource "aws_instance" "app" {
  credit_specification { cpu_credits = "standard" }
  ami                    = coalesce(var.ami_id, data.aws_ami.ubuntu.id)
  instance_type          = var.instance_type
  subnet_id              = aws_subnet.app.id
  vpc_security_group_ids = [aws_security_group.app.id]
  iam_instance_profile   = aws_iam_instance_profile.app.name
  metadata_options {
    http_endpoint               = "enabled"
    http_tokens                 = "required"
    http_put_response_hop_limit = 1
  }
  root_block_device {
    volume_type           = "gp3"
    volume_size           = var.disk_gb
    encrypted             = true
    delete_on_termination = false
  }
  user_data                   = file("${path.module}/../../deploy/bootstrap.sh")
  user_data_replace_on_change = false
  tags = {
    Name = local.name
  }
  lifecycle {
    prevent_destroy = true
  }
  depends_on = [aws_iam_role_policy.app, aws_route_table_association.app]
}
resource "aws_eip" "app" {
  domain     = "vpc"
  instance   = aws_instance.app.id
  depends_on = [aws_internet_gateway.app]
}
resource "aws_cloudfront_distribution" "api" {
  enabled         = true
  comment         = local.name
  price_class     = "PriceClass_100"
  is_ipv6_enabled = true
  origin {
    domain_name = aws_eip.app.public_dns
    origin_id   = "gateway"
    custom_header {
      name  = "X-FoodMenu-Origin"
      value = random_password.origin.result
    }
    custom_origin_config {
      http_port                = 80
      https_port               = 443
      origin_protocol_policy   = "http-only"
      origin_ssl_protocols     = ["TLSv1.2"]
      origin_read_timeout      = 60
      origin_keepalive_timeout = 5
    }
    connection_attempts = 1
  }
  default_cache_behavior {
    target_origin_id         = "gateway"
    allowed_methods          = ["DELETE", "GET", "HEAD", "OPTIONS", "PATCH", "POST", "PUT"]
    cached_methods           = ["GET", "HEAD"]
    viewer_protocol_policy   = "redirect-to-https"
    cache_policy_id          = data.aws_cloudfront_cache_policy.disabled.id
    origin_request_policy_id = data.aws_cloudfront_origin_request_policy.viewer.id
    compress                 = false
  }
  restrictions {
    geo_restriction {
      restriction_type = "none"
    }
  }
  viewer_certificate {
    cloudfront_default_certificate = true
  }
  dynamic "custom_error_response" {
    for_each = [500, 502, 503, 504]
    content {
      error_code            = custom_error_response.value
      error_caching_min_ttl = 0
    }
  }
}
