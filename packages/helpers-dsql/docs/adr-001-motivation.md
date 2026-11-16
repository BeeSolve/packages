# ADR-001: Why This Package Exists

## Status

Accepted

## Context

Aurora DSQL splits access control in two. IAM decides who may connect: `dsql:DbConnect` for custom database roles, `dsql:DbConnectAdmin` for `admin`. The database decides what a connection may touch: a role created with `CREATE ROLE ... WITH LOGIN`, mapped to an IAM principal with `AWS IAM GRANT`, and given table privileges with `GRANT`. IAM cannot restrict which database role a principal uses; the mapping lives in the cluster.

The first DSQL consumer (expense-ease) wired this by hand: a CDK helper that granted `dsql:DbConnect` and set the connection env vars on every Lambda, a stack output with the comma-joined Lambda role ARNs, and an admin script that created one shared application role with `SELECT, INSERT, UPDATE, DELETE` on every table and mapped every Lambda to it. Every Lambda got the same full access, the role ARNs had to be copied from a stack output, mappings were only ever added, and the runtime side (Drizzle database factory, SQLSTATE helpers, retry handling) was app code that the next DSQL project would copy.

## Decision

Ship one package with three entry points that share one contract, the access manifest:

- `@beesolve/dsql-helpers/cdk`: `DsqlCluster`, which declares database roles (built-in read, write, read/write, and custom roles with privileges and optional table scope), grants them to Lambdas or IAM roles, and writes the desired access to an SSM parameter.
- `@beesolve/dsql-helpers/admin`: `reconcileAccess`, which applies the manifest to the database in both directions, plus migration recovery helpers.
- `@beesolve/dsql-helpers`: `createDsqlDatabase`, env parsing, shared Drizzle types and SQLSTATE helpers for Lambda code.

## Rationale

### 1. The two halves of the contract must agree

The env var names the construct sets are the ones `toDsqlConfig` reads, and the manifest the construct writes is the one the reconciler validates. Keeping both sides in one package means they cannot drift apart.

### 2. Least privilege per function, declared next to the function

[Anvil's DSQL component](https://anvilcloud.dev/docs/blog/automating-dsql) showed that roles declared with the infrastructure, attached per function and optionally scoped per table, make least privilege the easy path. The same model fits CDK's `grant*` convention (`grantRead`, `grantReadWrite`, `grant(fn, role)`).

### 3. Access follows the code

A diff-based reconciler grants what is missing and revokes what is no longer declared, so removing a grant removes access instead of leaving a stale mapping behind.

## Consequences

- Each Lambda can get a narrower role than the application as a whole.
- The admin step must run after every deploy that changes grants; until it runs, a function granted a new role cannot log in as it (see ADR-002).
- The package is coupled to `@aws/aurora-dsql-drizzle` 0.x and `drizzle-orm` 0.45 through optional peers, so applications control those versions.

## Alternatives Considered

### Keep the code in each application

Rejected: the CDK helper, the role SQL, the SQLSTATE helpers and the migration repair logic are not application-specific, and each copy would re-learn the same DSQL limits (for example that `GRANT ... ON SCHEMA public` fails with 0A000).

### Separate CDK and runtime packages

Rejected for the same reason as in `@beesolve/sqs-handler`: entry points (`/cdk`, `/admin`, `.`) already keep CDK out of Lambda bundles, and one package keeps the manifest and env contract versioned together.

## References

- https://docs.aws.amazon.com/aurora-dsql/latest/userguide/using-database-and-iam-roles.html
- https://docs.aws.amazon.com/aurora-dsql/latest/userguide/authentication-authorization.html
- https://anvilcloud.dev/docs/blog/automating-dsql
