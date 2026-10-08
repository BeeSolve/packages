# @beesolve/cdk-email-alarms

## 0.1.7

### Patch Changes

- 8bc2016: Share a single SNS topic and email subscription across all alarms.

  `EmailAlarms` previously created one `AWS::SNS::Topic` plus one `AWS::SNS::Subscription` per alarm (per handler, per DLQ, and per queue-metric group), producing many duplicate resources and one subscription-confirmation email per alarm. It now creates a single topic + email subscription in the construct's own scope and points every alarm's `SnsAction` at it.

  Benefits: far fewer resources to create/update, one confirmation email instead of many, and the firing alarm's name/description still identifies what broke.

  Migration note: on existing stacks the old per-handler/per-queue topics and subscriptions are deleted and a single shared topic + subscription is created. The new email subscription must be confirmed (click the link in the confirmation email) for alarms to deliver notifications.

## 0.1.6

### Patch Changes

- b9e6f26: Publish agent-readable documentation inside the package tarball.

  Each package now ships a `DOCS.md` index at its root and, for user-facing packages, how-to guides under `docs/how-to/`, so AI agents can read usage directly from `node_modules`. The `files` allowlist was extended to include `DOCS.md` (and `docs/how-to` for user-facing packages); ADRs remain unpublished. Every `DOCS.md` carries a keyword line for grep-based discovery, a directive to prefer the installed docs over prior knowledge, and absolute links to the GitHub repository for full working examples. No runtime code changed.

## 0.1.5

### Patch Changes

- 0615a63: Move aws-cdk-lib and constructs from dependencies to peerDependencies to prevent duplicate package instances in consuming projects

## 0.1.4

### Patch Changes

- adf27f3: fix duplicate CDK construct ID error when `reportSqsErrors` is called for more than one queue
