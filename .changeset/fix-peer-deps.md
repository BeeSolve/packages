---
"@beesolve/cdk-constructs": patch
"@beesolve/cdk-email-alarms": patch
"@beesolve/lambda-keep-active": patch
"@beesolve/sqs-handler": patch
"@beesolve/auth-service": patch
"@beesolve/email-service": patch
"@beesolve/action-tokens": patch
---

Move aws-cdk-lib and constructs from dependencies to peerDependencies to prevent duplicate package instances in consuming projects
