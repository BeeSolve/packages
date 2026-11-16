# ADR-002: Access Manifest in SSM, Applied by an Admin Step

## Status

Accepted

## Context

Roles, table privileges and IAM mappings live inside the cluster and can only be changed over an `admin` connection, which needs `dsql:DbConnectAdmin`. CDK knows the desired state (roles, and the Lambda role ARNs as deploy-time tokens) but cannot run SQL by itself. Something has to carry the desired state from the deploy to an admin connection, and something has to run the SQL.

Tables only exist after migrations, and migrations already run in an admin step after deploy.

## Decision

- The construct writes the desired state, the access manifest, to the SSM parameter `/beesolve/dsql/<cluster id>/access-manifest`.
- `reconcileAccess` runs in the same admin step as the migrations, after them. It reads the parameter (`readAccessManifest`, name derived from the endpoint), diffs it against the cluster, applies the difference, and verifies.

## Rationale

### 1. No new admin-capable resource in the stack

Only the operator running the admin step holds admin access, as before. A deploy can only change the desired state, never run SQL.

### 2. Runs after migrations

A role without a table list covers every table in the schema. Applying it after migrations covers new tables without `ALTER DEFAULT PRIVILEGES`, which DSQL may reject with 0A000.

### 3. The manifest does not fit a stack output

A CloudFormation output is limited to 1,024 characters; a few Lambda role ARNs already exceed it. A standard SSM parameter holds 4 KB (advanced: 8 KB), and its name is derived from the cluster id, so the admin step needs no extra configuration.

## Consequences

- Between a deploy that changes a function's role and the admin step, that function cannot log in as its new role. The admin step must run right after such deploys.
- The manifest is untrusted input to SQL. It is validated (identifier allowlist, privilege allowlist, ARN pattern, principals in the cluster's account), and a manifest naming a different cluster than the endpoint is refused.
- Anyone with `ssm:PutParameter` on the parameter can change the desired state; the operator applies it. `dryRun` shows the plan first.

## Alternatives Considered

### CloudFormation custom resource

A Lambda with `dsql:DbConnectAdmin` runs the reconciler on every deploy, with the manifest as resource properties (no SSM). Access would change in the same deploy, and Lambdas could depend on it so they never run with a role that does not exist yet. Rejected for now: it puts an admin-capable function in every stack, and on the first deploy it runs before migrations create the tables, so table-scoped roles and full coverage of new tables still need the post-migration run. Can be added later on top of the same `reconcileAccess`.

### DynamoDB table and stream-triggered Lambda ([Anvil's design](https://anvilcloud.dev/docs/blog/automating-dsql))

Deploys write items, a stream-triggered Lambda is the only admin connection. Equivalent to the custom resource in CDK, where CloudFormation is already the trusted writer, with more moving parts.

### Stack output

Rejected because of the 1,024-character limit.
