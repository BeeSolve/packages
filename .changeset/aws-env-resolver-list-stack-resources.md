---
"@beesolve/aws-env-resolver": patch
---

Fix: resources in stacks with more than 100 resources were not found. The resolver now pages through `ListStackResources` instead of calling `DescribeStackResources`, which returns at most 100 resources. The required IAM permission changes from `cloudformation:DescribeStackResources` to `cloudformation:ListStackResources`.
