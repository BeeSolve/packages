# Getting Started

Declare an Aurora DSQL cluster and its database roles in CDK, apply the access after migrations, and connect from a Lambda.

## 1. Install

```bash
bun add @beesolve/dsql-helpers @aws/aurora-dsql-drizzle drizzle-orm pg
bun add -d aws-cdk-lib constructs
```

## 2. Declare the cluster and grant access

```ts
import { DsqlCluster } from "@beesolve/dsql-helpers/cdk";

const dsql = new DsqlCluster(this, "Dsql", {
  roles: {
    digest: { privileges: ["SELECT", "UPDATE"], tables: ["pending_notifications"] },
  },
});

dsql.grantReadWrite(apiHandler);
dsql.grant(digestHandler, "digest");
```

Each grant gives the function `dsql:DbConnect` on the cluster and sets `DSQL_ENDPOINT`, `DSQL_REGION` and `DSQL_DB_USER` (the role name). Deploy; the desired access is written to the SSM parameter `/beesolve/dsql/<cluster id>/access-manifest`.

## 3. Apply access after migrations

Run this as an admin step after every deploy (credentials with `dsql:DbConnectAdmin` and `ssm:GetParameter`):

```ts
import { drizzle, migrate } from "@aws/aurora-dsql-drizzle";
import { readAccessManifest, reconcileAccess } from "@beesolve/dsql-helpers/admin";

const endpoint = process.env.DSQL_ENDPOINT!;
const db = drizzle({ connection: { host: endpoint, user: "admin" } });

try {
  const result = await migrate(db, "./drizzle");
  if (!result.success) throw new Error(result.error.message);

  const manifest = await readAccessManifest({ endpoint });
  await reconcileAccess({
    client: db.$client,
    manifest,
    dryRun: process.argv.includes("--dry-run"),
  });
} finally {
  await db.$client.end();
}
```

Until this step has run, a function granted a new role cannot log in as it. Run it right after the deploy that adds or changes grants.

## 4. Connect from the Lambda

```ts
import { createDsqlDatabase, toDsqlConfig } from "@beesolve/dsql-helpers";

import * as schema from "./schema";

const { db, transact } = createDsqlDatabase({
  config: toDsqlConfig(),
  schema,
  casing: "snake_case",
});

export const handler = async () => {
  await transact(async (tx) => {
    await tx.update(schema.pendingNotifications).set({ sent: true });
  });
};
```

`transact` retries optimistic concurrency conflicts, so the callback may run more than once: keep emails, queue messages and other side effects after it returns.
