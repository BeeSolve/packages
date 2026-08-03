# IP-Based Throttling Design

## Status

Draft — not yet implemented.

## Problem

The current `createNewWithThrottling` throttles per email address (e.g., 60s window). An attacker can submit the contact form with many _different_ email addresses from the same IP, bypassing the per-email throttle entirely. Each unique email starts a fresh throttle window, allowing unlimited SES sends from a single source. This triggered an AWS SES abuse notice.

## Current Behavior

`createNewWithThrottling` writes two items in a single `TransactWriteCommand`:

1. **Throttle record** — `owner: "throttle#<id>"`, `action: <action>`, `expiresAt: now + windowSeconds`
2. **Token record** — the actual action token

The throttle record uses a conditional put:

```
ConditionExpression: attribute_not_exists(#owner) OR #expiresAt <= :now
```

If a non-expired throttle record already exists for this `(id, action)` pair, the transaction fails and `TokenThrottledError` is thrown. TTL cleans up expired throttle records automatically.

## Goal

Add per-IP throttling alongside per-email throttling to limit how many emails a single IP can trigger within a time window. Reuse the existing action-tokens DynamoDB table and transaction pattern. No WAF dependency.

## Why Composite `ip+email` Doesn't Work

A composed throttle ID like `` `${ip}:${email}` `` would only throttle repeated requests for the _same_ IP+email pair. The attack vector is many different emails from the same IP — each combination is unique, so the throttle record never collides and never fires.

## Proposed Approach: Multiple Throttle Records

Extend `createNewWithThrottling` to accept an array of throttle entries. Each entry becomes a separate conditional put in the same DynamoDB transaction.

```ts
await actionTokens.createNewWithThrottling({
  owner: token,
  action: "contactVerify",
  value: code,
  remainingUses: 3,
  expiresAt,
  data: { name, email, subject, message },
  overwrite: true,
  throttle: [
    { id: email, windowSeconds: 60 },
    { id: `ip:${clientIp}`, windowSeconds: 30 },
  ],
});
```

Transaction items:

| #   | Item           | Key                                                             |
| --- | -------------- | --------------------------------------------------------------- |
| 1   | IP throttle    | `owner: "throttle#ip:1.2.3.4"`, `action: "contactVerify"`       |
| 2   | Email throttle | `owner: "throttle#user@example.com"`, `action: "contactVerify"` |
| 3   | Token          | `owner: <token>`, `action: "contactVerify"`                     |

This is well within DynamoDB's 100-item transaction limit. The API change is backward-compatible — accept both a single throttle object and an array.

When the transaction fails, inspect `CancellationReasons` by index to determine which throttle was violated and throw `TokenThrottledError` with appropriate context.

## Alternative: Per-IP Counter

Instead of a binary "throttled or not" check, maintain an atomic counter per IP with a sliding window (e.g., max 5 requests per 10 minutes). This is more forgiving for shared IPs (corporate NATs, mobile carriers) but requires a different DynamoDB pattern:

- Atomic increment via `UpdateCommand` with `ADD` expression
- TTL reset on each increment to maintain the window
- Separate read-before-write or condition on counter value

This is more complex and could be a future enhancement layered on top of the simpler multi-throttle approach.

## Client IP Source

`kit-on-lambda` configures CloudFront with `OriginRequestPolicy.ALL_VIEWER_EXCEPT_HOST_HEADER`, so all viewer headers reach the Lambda. The SvelteKit handler returns `x-forwarded-for` from `getClientAddress()`.

**`x-forwarded-for` caveat:** The client can prepend arbitrary IPs to this header. CloudFront appends the real viewer IP, so the rightmost IP (before CloudFront's own) is authoritative — but parsing this correctly is error-prone.

**Better option:** Add `CloudFront-Viewer-Address` to the origin request policy. This header is set by CloudFront itself (unspoofable), contains `ip:port` format. Requires either:

- A CDK change in `kit-on-lambda` to use a custom origin request policy that includes this header
- Or an override in the consuming stack's distribution config

## Open Questions

- [ ] Decide on IP throttle window — simple cooldown (15–30s) vs counter-based (5 per 10 min)
- [ ] Decide on client IP source — `x-forwarded-for` parsing vs `CloudFront-Viewer-Address` header
- [ ] Decide if `createNewWithThrottling` accepts `throttle: ThrottleConfig | ThrottleConfig[]` (backward-compatible) or gets a new method
- [ ] Consider shared IP impact — corporate NATs and mobile carriers can have thousands of users behind one IP; is a simple cooldown too aggressive?
- [ ] Consider counter-based throttling (Option B) as a future enhancement for more granular control
- [ ] Determine error reporting — when multiple throttles exist, should the error indicate _which_ throttle was hit (IP vs email)?
