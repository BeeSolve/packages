---
"@beesolve/cdk-constructs": patch
---

Stop `tagFunctionsWithRevision` from propagating the `revision` tag to child constructs.

`Tags.of(fn).add("revision", ...)` propagated the tag to every taggable construct nested under each Lambda function (SQS queues, DLQs, SNS topics, CloudWatch alarms, IAM roles). Because `revision` changes on every commit, CloudFormation issued an in-place `UPDATE` on all of those resources on every deploy, making deploys slow and noisy even when nothing functional changed.

The aspect now restricts the tag to `AWS::Lambda::Function` resources via `includeResourceTypes`, so only the functions carry the changing `revision` tag. No public API change.
