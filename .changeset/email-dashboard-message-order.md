---
"@beesolve/email-service-dashboard": patch
---

Fix message list ordering and resilience in `messagesManyForMonth` and `messageManyByRecipient`. Results are now returned in the query order (newest-first) instead of the arbitrary order returned by DynamoDB `BatchGetItem`, duplicate index rows are de-duplicated so a single message is not fetched twice, and index rows whose message item is missing are skipped instead of throwing.
