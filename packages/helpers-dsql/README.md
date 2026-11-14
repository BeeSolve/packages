# @beesolve/dsql-helpers

Aurora DSQL helpers: a CDK cluster construct with least-privilege, per-table database roles declared in code, an access reconciler that applies them to the database, and a Drizzle database factory for Lambda.

> [!WARNING]
> **Pre-1.0 — unstable API.** This package is `0.x` and under active
> development. Breaking changes can land in any `0.x` release without a major
> version bump. Pin an exact version and review the changelog before upgrading.
> Once the API stabilizes and the package reaches `1.0.0`, it follows semantic
> versioning and this notice is removed.

## Installation

```bash
bun add @beesolve/dsql-helpers
# or: npm install @beesolve/dsql-helpers
```

Every entry point needs different peers, so they are optional. Install what you use:

| Entry point                    | Peers                                             |
| ------------------------------ | ------------------------------------------------- |
| `@beesolve/dsql-helpers/cdk`   | `aws-cdk-lib`, `constructs`                       |
| `@beesolve/dsql-helpers`       | `@aws/aurora-dsql-drizzle`, `drizzle-orm`, `pg`   |
| `@beesolve/dsql-helpers/admin` | `drizzle-orm` (for `repairFirstPendingMigration`) |

## How access works

IAM only decides **who may connect**: a principal with `dsql:DbConnect` on the cluster can log in as the database role its ARN is mapped to (`AWS IAM GRANT <role> TO '<arn>'`). **What it may touch** is decided by that role's table privileges. IAM cannot restrict which database role is used, so least privilege lives in the database.

1. The CDK construct declares roles and records which IAM principals map to which role. Each grant adds only `dsql:DbConnect` (never `DbConnectAdmin`) and, for a Lambda, sets `DSQL_ENDPOINT`, `DSQL_REGION` and `DSQL_DB_USER`.
2. The desired state is written to an SSM parameter, `/beesolve/dsql/<cluster id>/access-manifest`.
3. An admin step, after migrations, runs `reconcileAccess`: it creates missing roles, grants and revokes table privileges, and grants and revokes IAM mappings so the database matches the code. It then reads the state again and fails unless nothing is left to do.

## CDK: `DsqlCluster`

```ts
import { DsqlCluster } from "@beesolve/dsql-helpers/cdk";

const dsql = new DsqlCluster(this, "Dsql", {
  deletionProtection: isProd,
  removalPolicy: isProd ? RemovalPolicy.RETAIN : RemovalPolicy.DESTROY,
  roles: {
    digest: { privileges: ["SELECT", "UPDATE"], tables: ["pending_notifications", "users"] },
    reporting: { privileges: ["SELECT"] },
  },
});

dsql.grantReadWrite(siteHandler); // role app_readwrite: SELECT, INSERT, UPDATE, DELETE on every table
dsql.grantRead(statsHandler); // role app_read: SELECT on every table
dsql.grantWrite(importer); // role app_write: INSERT, UPDATE, DELETE, no SELECT
dsql.grant(digestHandler, "digest"); // custom role, typed: only declared names compile
```

- A role without `tables` covers every table in the schema, including tables created by later migrations. With `tables`, it covers only those.
- `grantWrite` has no `SELECT`. PostgreSQL also needs `SELECT` for `UPDATE`/`DELETE` with a `WHERE` clause and for `RETURNING`, so it only suits append-only writers.
- An IAM principal maps to one database role. Granting a second, different role to the same function throws at synth; declare a role that combines both.
- Grantees are Lambda functions or IAM roles (IAM permission only, no env vars).
- `new DsqlCluster(this, "Dsql")` gives the cluster the logical ID `Dsql`, so replacing an existing `new CfnCluster(this, "Dsql")` keeps the same cluster.

| Prop                    | Default           | Description                                                       |
| ----------------------- | ----------------- | ----------------------------------------------------------------- |
| `roles`                 | `{}`              | Custom roles: `privileges` and optional `tables`                  |
| `roleNamePrefix`        | `app`             | Prefix of `<prefix>_read`, `<prefix>_write`, `<prefix>_readwrite` |
| `schema`                | `public`          | Schema the privileges apply to                                    |
| `deletionProtection`    | `true`            | Cluster deletion protection                                       |
| `removalPolicy`         | `RETAIN`          | Cluster removal policy                                            |
| `manifestParameterTier` | `STANDARD` (4 KB) | SSM tier of the manifest parameter                                |

Properties: `cluster` (`CfnCluster`), `clusterId`, `clusterArn`, `endpoint`, `schema`, `accessManifestParameter`, and `toAccessManifest()`.

Names are validated at synth: roles and tables must be plain lowercase identifiers (`[a-z_][a-z0-9_]*`, max 63), privileges one of `SELECT`, `INSERT`, `UPDATE`, `DELETE`.

## Admin: apply access

```ts
import { drizzle, migrate } from "@aws/aurora-dsql-drizzle";
import { readAccessManifest, reconcileAccess } from "@beesolve/dsql-helpers/admin";

const endpoint = process.env.DSQL_ENDPOINT!;
const db = drizzle({ connection: { host: endpoint, user: "admin" } });

try {
  const result = await migrate(db, "./drizzle");
  if (!result.success) throw new Error(result.error.message);

  const manifest = await readAccessManifest({ endpoint, profile: process.env.AWS_PROFILE });
  await reconcileAccess({ client: db.$client, manifest, prune: false, dryRun: false });
} finally {
  await db.$client.end();
}
```

The caller needs `dsql:DbConnectAdmin` on the cluster and `ssm:GetParameter` on the manifest parameter.

- `dryRun: true` prints the plan and runs nothing.
- `prune: true` also handles roles that are mapped to IAM principals but no longer declared: their mappings and privileges are revoked and the role is dropped. Without it they are reported as warnings.
- The manifest is validated before use (identifiers, privileges, ARNs, and that every principal is in the cluster's account), and `readAccessManifest` refuses a manifest that names a different cluster than the endpoint.
- `planAccess({ manifest, state })` is the pure diff and `readAccessState({ client, manifest })` the read-only query, if you want to build your own tooling.

Statement order: create roles, grant schema usage, grant table privileges, revoke stale IAM mappings, grant IAM mappings, revoke extra table privileges, then prune. A principal therefore never logs in as a role that cannot yet use its tables.

### Migrations

- `repairFirstPendingMigration({ client, migrationsFolder })` records the first pending `CREATE INDEX ASYNC` / `ALTER TABLE ASYNC ... VALIDATE CONSTRAINT` statement as applied when the index or constraint already exists and is valid. Use it when a migration run stopped while DSQL was still running the job and a re-run fails with 42P07.
- `readAsyncJobs({ client })` returns `sys.jobs` and the schema's indexes with their validity.

## Runtime: `createDsqlDatabase`

```ts
import { createDsqlDatabase, toDsqlConfig } from "@beesolve/dsql-helpers";

import * as schema from "./schema";

const { db, transact } = createDsqlDatabase({
  config: toDsqlConfig(), // DSQL_ENDPOINT, DSQL_REGION, DSQL_DB_USER, optional AWS_PROFILE
  schema,
  casing: "snake_case",
  toRetryExhaustedError: () => new BadRequestError("Please try again."),
});
```

- Create it once per Lambda container. The connector creates an IAM token per new connection; DSQL closes connections after one hour and the pool replaces them.
- `transact(fn)` runs `transactionWithRetry`, which retries optimistic concurrency conflicts (SQLSTATE 40001). `fn` may run more than once, so keep side effects outside it.
- `dsqlEnvEntries` are the Valibot entries for the env vars, to spread into an entry point's own schema.
- Types `Db<TSchema>`, `Tx<TSchema>`, `Executor<TSchema>`, `Transact<TSchema>` and `DbProps<TSchema>` are the plain PostgreSQL bases, so repositories also run against PGlite in tests.
- Errors: `toSqlState`, `isUniqueViolation`, `isForeignKeyViolation`, `isCheckViolation`, `isSerializationFailure`, `isRetryExhausted`, `sqlState`.

See [DOCS.md](./DOCS.md) for how-to guides.
