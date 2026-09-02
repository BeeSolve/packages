# @beesolve/email-service

## 0.4.0

### Minor Changes

- 562809c: Add `replyToAddresses` support to `sendEmail`. Reply-to addresses are passed through to SES as `ReplyToAddresses` and, unlike the sender, do not need to be verified in SES.

## 0.3.6

### Patch Changes

- Updated dependencies [d54dca7]
  - @beesolve/cdk-constructs@0.3.0

## 0.3.5

### Patch Changes

- 834140e: Fix return-await in try/finally block to preserve stack traces on attachment fetch errors

## 0.3.4

### Patch Changes

- 0615a63: Move aws-cdk-lib and constructs from dependencies to peerDependencies to prevent duplicate package instances in consuming projects
- Updated dependencies [0615a63]
  - @beesolve/cdk-constructs@0.2.1

## 0.3.3

### Patch Changes

- f1e4fc9: Improve documentation: rewrite READMEs for clarity, add ADR documents, and reorganize docs structure.

## 0.3.2

### Patch Changes

- Updated dependencies [c2bd8aa]
  - @beesolve/cdk-constructs@0.2.0

## 0.3.1

### Patch Changes

- a1a259e: add permissions for configuration-set

## 0.3.0

### Minor Changes

- 8fad7d8: fix permissions

## 0.2.0

### Minor Changes

- 7ef69a7: Add `./events` entry point, templating helpers, and documentation.

  **New: `@beesolve/email-service/events`**

  Typed EventBridge event types and runtime helpers for both event sources the email service emits:

  - `beesolve.email.api` — `EmailSentSuccess`, `EmailSentFailure`
  - `aws.ses` — `SES Delivery`, `SES Bounce`, `SES Complaint`, `SES Message Sent`, `SES Reject`

  All types are derived from valibot schemas. `parseEmailEvent(body)` safely parses and validates an SQS record body; `is*` type guards narrow the union type in handlers.

  **New: `hydrateTemplate()` in `@beesolve/email-service/templating`**

  Replaces `$$$__KEY__$$$` placeholder tokens in pre-built HTML/text with runtime values. Pairs with the pre-build pattern to keep React out of the Lambda bundle.

  **New: `buildTemplates()` in `@beesolve/email-service/templating`**

  Build-time helper that discovers React template components in a directory, renders each with all requested locales, and writes `<name>_<locale>.json` files. Eliminates the need to hand-write the build script in every consuming package.

### Patch Changes

- Updated dependencies [9ac7256]
  - @beesolve/cdk-constructs@0.1.30

## 0.1.20

### Patch Changes

- adf27f3: fix several correctness, error handling, and security issues
  - DynamoDB `batchWrite` now chunked into ≤25-item groups; previously would throw for emails with many recipients
  - EventBridge `putEvents` failures are now logged instead of silently swallowed
  - Sender `emailAddress` field now validated as a valid email address
  - Public attachment fetching now has a 10s timeout and a 25 MB size guard
  - SES IAM policy scoped to account identities instead of `"*"`
  - Migrated from SES v1 (`SendRawEmail`) to SES v2 (`SendEmailCommand`); raises effective message size limit from 10 MB to 40 MB
