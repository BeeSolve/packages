# ADR-001: Email Authentication Check

## Status

Accepted

## Context

The DMARC reports handler (`src/handler.ts`) includes a `checkEmailAuthentication` function that attempts to validate inbound emails before processing. The current implementation has two problems:

### Problem 1: Wrong headers

The code looks for `X-SES-SPF-Verdict` and `X-SES-DKIM-Verdict` headers in the stored email. **These headers do not exist.** SES prepends the following headers to emails stored in S3:

- `Authentication-Results` — always present, contains SPF, DKIM, and DMARC results in RFC 8601 format
- `X-SES-Spam-Verdict` — only when `scanEnabled: true` on the receipt rule
- `X-SES-Virus-Verdict` — only when `scanEnabled: true` on the receipt rule

The SPF/DKIM verdicts are not surfaced as separate `X-SES-*` headers. They are embedded in the `Authentication-Results` header as structured fields (e.g. `spf=pass`, `dkim=pass`).

As a result, `extractSesHeader` always returns `undefined` for both, the early-return branch fires, and the authentication check is effectively a **no-op**.

### Problem 2: Overly permissive logic

Even if the headers existed, the logic only rejected emails when **both** SPF and DKIM failed simultaneously. A single mechanism failing was silently accepted. The correct bar (aligned with DMARC RFC 7489) is: at least one of SPF or DKIM must explicitly pass.

## Decision

Fix `checkEmailAuthentication` to:

1. Parse the `Authentication-Results` header that SES actually adds to stored emails.
2. Require at least one of SPF or DKIM to pass. Reject if neither passes.
3. Continue to skip the check (early return) when no `Authentication-Results` header is found — this covers direct S3 uploads not originating from SES (e.g. manual test uploads).

The `Authentication-Results` header format (RFC 8601) looks like:

```
Authentication-Results: amazonses.com;
 spf=pass (spfCheck: ...) client-ip=...;
 dkim=pass header.i=@example.com;
 dmarc=pass header.from=example.com;
```

Parsing strategy: extract `spf=<result>` and `dkim=<result>` tokens from the header value.

## Consequences

- Emails where neither SPF nor DKIM passes will be rejected (thrown error, message skipped).
- Emails where at least one mechanism passes will be processed — consistent with DMARC itself.
- Direct S3 uploads (without SES headers) remain accepted to support testing and manual ingestion workflows.
- Existing tests must be updated to use `Authentication-Results` instead of the non-existent `X-SES-SPF-Verdict` / `X-SES-DKIM-Verdict` headers.

## References

- [SES email authentication and malware scanning](https://docs.aws.amazon.com/ses/latest/dg/receiving-email-concepts.html#receiving-email-auth-malware)
- [RFC 8601 — Message Header Field for Indicating Message Authentication Status](https://datatracker.ietf.org/doc/html/rfc8601)
- [RFC 7489 — DMARC](https://datatracker.ietf.org/doc/html/rfc7489)
