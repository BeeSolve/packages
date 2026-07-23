# ADR-001: Single-Region DynamoDB Table

## Status

Accepted

## Context

Action tokens are one-shot credentials (OTP codes) that must enforce strict usage limits — a token with `remainingUses: 3` must never be usable more than 3 times, regardless of concurrent requests. The package also implements throttle enforcement via `TransactWriteCommand` to prevent rapid-fire token creation for the same identity.

The question is whether the DynamoDB table should use global tables (multi-region replication) to reduce latency for geographically distributed users.

## Decision

The action-tokens table is deployed as a single-region DynamoDB table. All token operations (create, use, throttle) execute against one region.

## Rationale

### 1. Conditional writes require strong consistency

The `use` operation performs a conditional `UpdateCommand`:

```
ConditionExpression: #remainingUses = :remainingUses AND #expiresAt > :now
```

This atomically verifies the token hasn't been consumed by a concurrent request. DynamoDB global tables use **last-writer-wins** conflict resolution — two replicas could both successfully decrement `remainingUses` from 1 to 0 before replication propagates the first write, allowing a token to be used twice.

### 2. Transactions are single-region only

`createNewWithThrottling` uses `TransactWriteCommand` to atomically write both the token and a throttle record. DynamoDB transactions do not span global table replicas — they execute against the local replica only. A throttle enforced in eu-west-1 would not prevent a concurrent creation in us-east-1 during the replication window.

### 3. Brute-force protection depends on atomic decrements

The `use` method intentionally decrements `remainingUses` even when the provided value is incorrect — this prevents enumeration attacks. With global tables, an attacker could submit attempts against different replicas simultaneously, getting `N × replica_count` attempts instead of `N`.

### 4. GSI eventual consistency would compound with replication lag

Token lookup by value (`getOneByValue`) queries a GSI, which is already eventually consistent within a single region. Adding cross-region replication introduces a second layer of eventual consistency — a token created in region A might not be queryable by value in region B for an indeterminate period (GSI propagation + replication lag).

## Consequences

- **Latency:** Users far from the deployment region pay cross-region latency (~50–150ms) on auth operations. This is acceptable because token operations happen infrequently (once per sign-in, not per page load).
- **Availability:** A regional DynamoDB outage would prevent token creation and verification. This is mitigated by DynamoDB's high single-region availability SLA (99.99%).
- **Multi-region deployments:** If the consuming application (e.g. `@beesolve/auth-service`) is deployed multi-region, all auth operations should route to the token table's region rather than attempting local reads against a replica.

## Alternatives Considered

### Global tables with application-level routing

Route all writes to a single "primary" region while allowing reads from any replica. Rejected because `use` is a read-modify-write operation that must be atomic — splitting reads and writes across regions would reintroduce the double-use problem.

### Global tables with conditional writes on all replicas

DynamoDB global tables do support conditional writes on each replica, but conflicts are resolved by last-writer-wins at the item level. Two successful conditional writes on different replicas would both succeed locally and then one would be silently overwritten during replication — exactly the failure mode we need to prevent.

## References

- [DynamoDB Global Tables conflict resolution](https://docs.aws.amazon.com/amazondynamodb/latest/developerguide/globaltables_HowItWorks.html#globaltables_HowItWorks.conflict-resolution)
- [DynamoDB Transactions](https://docs.aws.amazon.com/amazondynamodb/latest/developerguide/transaction-apis.html) — "Transactions are not supported across regions in global tables"
