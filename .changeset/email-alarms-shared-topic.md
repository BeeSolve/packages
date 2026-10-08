---
"@beesolve/cdk-email-alarms": patch
---

Share a single SNS topic and email subscription across all alarms.

`EmailAlarms` previously created one `AWS::SNS::Topic` plus one `AWS::SNS::Subscription` per alarm (per handler, per DLQ, and per queue-metric group), producing many duplicate resources and one subscription-confirmation email per alarm. It now creates a single topic + email subscription in the construct's own scope and points every alarm's `SnsAction` at it.

Benefits: far fewer resources to create/update, one confirmation email instead of many, and the firing alarm's name/description still identifies what broke.

Migration note: on existing stacks the old per-handler/per-queue topics and subscriptions are deleted and a single shared topic + subscription is created. The new email subscription must be confirmed (click the link in the confirmation email) for alarms to deliver notifications.
