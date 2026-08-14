# ADR-001: Handle RUA (Aggregate) Reports Only

## Status

Accepted

## Context

DMARC defines two reporting mechanisms:

- **RUA** (aggregate reports) — periodic XML summaries sent by receivers (typically daily), containing per-source-IP pass/fail statistics for SPF, DKIM, and DMARC alignment.
- **RUF** (forensic/failure reports) — real-time per-message failure notifications in IODEF or ARF format, containing details about individual messages that failed DMARC evaluation.

We need to decide which report types to ingest and whether they should share infrastructure (SES inbound rule, S3 bucket, processing pipeline).

## Decision

Handle **RUA only**. Do not ingest or process RUF reports.

### Rationale

1. **RUF is effectively dead.** Most major mailbox providers (Google, Microsoft, Yahoo) do not send RUF reports. The `ruf` tag in DNS is widely ignored. Implementing a RUF parser would serve almost no real-world traffic.

2. **Privacy concerns.** RUF reports can contain PII from email headers (recipient addresses, subject lines, message IDs). Several providers stopped sending them specifically to avoid liability under GDPR and similar regulations. Storing this data would add compliance burden with minimal monitoring value.

3. **Incompatible formats.** RUA uses gzipped/zipped XML in a well-defined schema (RFC 7489 Appendix C). RUF uses IODEF (RFC 5070) or ARF (RFC 5965) — completely different formats that would require a separate parser, separate storage schema, and separate query patterns.

4. **RUA is sufficient for monitoring.** Aggregate reports provide everything needed to identify unauthorized senders, track alignment rates, and inform policy changes (`none` → `quarantine` → `reject`). Per-message forensics are not needed for this workflow.

## Consequences

- The SES inbound rule and processing pipeline only need to handle XML aggregate reports (plain, gzipped, or zipped).
- The DMARC DNS record should set `rua` to the ingest address. The `ruf` tag can be omitted or left unset.
- If RUF support is ever needed in the future, it should use a separate inbound address, separate parser, and separate storage — not be mixed into the existing pipeline.

## References

- [RFC 7489 §7.1 — Aggregate Reports](https://datatracker.ietf.org/doc/html/rfc7489#section-7.1)
- [RFC 7489 §7.2 — Failure Reports](https://datatracker.ietf.org/doc/html/rfc7489#section-7.2)
- [Google DMARC FAQ — "Google doesn't support sending failure reports"](https://support.google.com/a/answer/2466580)
