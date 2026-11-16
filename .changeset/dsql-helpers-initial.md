---
"@beesolve/dsql-helpers": minor
---

Initial release: `DsqlCluster` CDK construct with per-function, per-table database roles (`grantRead`, `grantWrite`, `grantReadWrite`, `grant`), an access manifest in SSM, `reconcileAccess` to apply it in both directions, migration repair helpers, and `createDsqlDatabase` for Lambda.
