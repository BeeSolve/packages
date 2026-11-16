/**
 * Environment variables the CDK construct sets on every granted Lambda and that
 * {@link toDsqlConfig} reads at runtime.
 */
export const dsqlEnvNames = {
  endpoint: "DSQL_ENDPOINT",
  region: "DSQL_REGION",
  user: "DSQL_DB_USER",
} as const;
