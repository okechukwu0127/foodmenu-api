output "api_url" {
  value = "https://${aws_cloudfront_distribution.api.domain_name}"
}
output "instance_id" {
  value = aws_instance.app.id
}
output "repository_url" {
  value = aws_ecr_repository.app.repository_url
}
output "artifacts_bucket" {
  value = aws_s3_bucket.private.bucket
}
output "runtime_parameter" {
  value = local.runtime_parameter
}
output "region" {
  value = var.region
}
output "origin_token" {
  value     = random_password.origin.result
  sensitive = true
}
