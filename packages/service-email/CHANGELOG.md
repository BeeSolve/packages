# @beesolve/email-service

## 0.1.20

### Patch Changes

- adf27f3: fix several correctness, error handling, and security issues

  - DynamoDB `batchWrite` now chunked into ≤25-item groups; previously would throw for emails with many recipients
  - EventBridge `putEvents` failures are now logged instead of silently swallowed
  - Sender `emailAddress` field now validated as a valid email address
  - Public attachment fetching now has a 10s timeout and a 25 MB size guard
  - SES IAM policy scoped to account identities instead of `"*"`
  - Migrated from SES v1 (`SendRawEmail`) to SES v2 (`SendEmailCommand`); raises effective message size limit from 10 MB to 40 MB
