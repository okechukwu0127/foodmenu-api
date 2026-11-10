# AWS staging account setup

This guide prepares account `844706634415` for a FoodMenu Terraform deployment. It does not create application infrastructure. The configured CLI profile is `foodmenu-deploy-PowerUserAccess-844706634415`, using IAM Identity Center in `eu-west-2`.

## Monthly budget alerts

AWS Budgets provides monitoring and notifications, not a guaranteed hard spending cap. Charges can exceed the threshold before an alert arrives. A monthly amount is a target for infrastructure sizing, not evidence that a proposed stack fits within it. Budget actions can stop selected supported resources or restrict new provisioning, but do not universally stop all billable services.

1. Sign in as a principal with billing/budget administration access.
2. Open Billing and Cost Management → Budgets → Create budget.
3. Choose Customize (advanced) → Cost budget.
4. Use a name such as `foodmenu-staging-monthly`, Monthly period, recurring budget, Fixed amount.
5. Enter the USD amount you are comfortable spending. For example, $50 is an illustrative alert threshold, not a deployment cost estimate.
6. Initially monitor all account costs, across services/regions. Tag-based filtering can miss untagged resources; we can add a separate project-filtered budget once deployment tags are established.
7. Add actual-spend alerts at 50%, 80% and 100%, plus a forecasted-spend alert at 100%. Add an email address you monitor to each notification.
8. Review and create the budget. Keep default cost coverage unless you intentionally want to exclude particular types of charges.

Choose an infrastructure budget before provisioning. We will size the stack against it and review the Terraform plan separately. Automated shutdown, if wanted, requires an explicit service-specific design; stopping compute does not eliminate storage, database or other ongoing charges.

References: [creating a cost budget](https://docs.aws.amazon.com/cost-management/latest/userguide/create-cost-budget.html), [Budgets timing and behavior](https://docs.aws.amazon.com/cost-management/latest/userguide/budgets-managing-costs.html).

## Add the Terraform IAM permissions

The existing AWS managed `PowerUserAccess` policy allows broad service operations but excludes most IAM role administration. Add the repository policy as an **inline policy on the Identity Center permission set**, preserving the managed PowerUserAccess policy. Do not edit the generated `AWSReservedSSO_*` IAM role directly.

1. Sign in to the AWS console with authority to administer IAM Identity Center.
2. Select the Identity Center region, Europe (London), and open IAM Identity Center.
3. Under Multi-account permissions, open Permission sets → PowerUserAccess.
4. Under Permissions, add/edit its Inline policy. Copy [`foodmenu-terraform-iam.json`](../infra/bootstrap/foodmenu-terraform-iam.json) into the JSON editor. If an inline policy already exists, merge its statements rather than replacing unrelated permissions.
5. Save. Follow any Update/Reprovision prompt for account `844706634415`. If needed, use the permission set's AWS accounts/Provisioned accounts view to reprovision the assigned account. The assignment must finish successfully before testing.
6. Refresh your CLI login:

```bash
aws sso login --profile foodmenu-deploy-PowerUserAccess-844706634415
aws sts get-caller-identity --profile foodmenu-deploy-PowerUserAccess-844706634415
```

The identity command verifies login, not every Terraform permission. Actual authorization will also depend on any account/organization policies and boundaries. Terraform planning/applying the reviewed stack provides further verification.

On macOS, copy the policy from the repository root with:

```bash
pbcopy < infra/bootstrap/foodmenu-terraform-iam.json
```

Reference: [Identity Center custom permissions](https://docs.aws.amazon.com/singlesignon/latest/userguide/permissionsetcustom.html).

## Policy contract for the Terraform implementation

This is an additive policy for the initial EC2/ECS deployment design, not a claim of a complete least-privilege policy for every possible AWS architecture:

- Existing PowerUserAccess remains the service-level permission source.
- Application role and instance-profile names must start with `foodmenu-` and use the root IAM path in this account.
- Role creation requires the AWS managed PowerUserAccess policy as a **workload permissions boundary**. Each Terraform `aws_iam_role` must set `permissions_boundary = "arn:aws:iam::aws:policy/PowerUserAccess"`. The boundary limits maximum permissions; it grants no workload permissions by itself.
- Define the workload's actual access narrowly with inline role policies. This bootstrap policy does not grant managed-policy creation/attachment or permissions-boundary removal. Update the reviewed bootstrap policy if a later design needs those operations.
- `iam:PassRole` is scoped to the FoodMenu role prefix and the EC2/ECS task services. Additional service principals require an explicit update.
- `ReadOwnIdentityCenterRole` permits only `iam:GetRole` on this account's London `AWSReservedSSO_PowerUserAccess_*` role, so the console can inspect the assigned SSO role. It does not grant permission to modify that role.
- Terraform can read/update/delete those roles, their inline policies and the matching EC2 instance profiles. It cannot use these additions to administer unrelated IAM identities.
- This is still a powerful deployment identity. Do not place its SSO credentials in the application container; workloads use their own roles.

The account ID is configuration, not a credential, but this policy must be adjusted before reuse in another AWS account.

## Resolving 403 on iam:GetRole for the SSO role

If the console reports `iam:GetRole` denied on `AWSReservedSSO_PowerUserAccess_*`, the active PowerUser session lacks that IAM read permission. The earlier policy scoped GetRole to `foodmenu-*`; that scope excludes the generated SSO role. The current JSON includes the narrow read-only statement above and has passed AWS Access Analyzer policy validation.

Use an existing administrator session to apply the updated policy in IAM Identity Center, then reprovision the assigned account and refresh the SSO login. If the account owner has only root access available for initial setup, they can use that account-owner session to bootstrap this correction and then return to SSO. Do not modify the protected generated role directly in IAM. Adding a statement to a local file does not grant the active session permission until the administrator saves/provisions it.

A console error can occur after the inline policy has already been stored. In the reported case, read-only inspection confirmed that the five replacement statements were saved in Identity Center despite the console's 403; the previous inline statements were absent. Back up the current policy and merge any original required statements from their source/backup before saving further changes. The available CloudTrail change history did not contain a recoverable previous policy. Do not assume an error means AWS rolled back the replacement.

## Decisions still needed

Environment: `staging`. Region: `eu-west-2`. No custom domain initially: use an AWS-provided HTTPS frontend to the gateway, such as the CloudFront distribution domain. The application will need configured streaming behavior, API cache policy and appropriate origin restrictions. No AWS application resources have been provisioned by this setup guide.

Before creating Terraform resources, choose the monthly budget, whether to initialize a fresh database or migrate existing records/photos, and which provider credentials are appropriate for staging. Secrets stay in local/AWS secret storage, not chat or committed Terraform variables.
