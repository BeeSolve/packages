import * as v from "valibot";

/** Table privileges a role can be granted. */
export const dsqlPrivileges = ["SELECT", "INSERT", "UPDATE", "DELETE"] as const;
export type DsqlPrivilege = (typeof dsqlPrivileges)[number];

/**
 * Identifiers are interpolated into SQL (identifiers cannot be bound parameters), so only plain
 * lowercase PostgreSQL identifiers are accepted. Drizzle's `snake_case` names fit.
 */
const identifierPattern = /^[a-z_][a-z0-9_]{0,62}$/;
const reservedRoleNames: ReadonlySet<string> = new Set(["admin", "public", "none", "postgres"]);
/** ARNs are interpolated into a quoted literal, so only the IAM role/user ARN charset is accepted. */
const principalArnPattern = /^arn:aws[a-z-]*:iam::(\d{12}):(role|user)\/[\w+=,.@/-]+$/;

export function assertRoleName(name: string): void {
  if (!identifierPattern.test(name) || name.startsWith("pg_") || reservedRoleNames.has(name)) {
    throw new Error(
      `Invalid DSQL role name "${name}": use lowercase letters, digits and "_" (max 63), not starting with "pg_", and not ${[...reservedRoleNames].join(", ")}.`,
    );
  }
}

export function assertTableName(name: string): void {
  if (!identifierPattern.test(name)) {
    throw new Error(
      `Invalid table name "${name}": use lowercase letters, digits and "_" (max 63).`,
    );
  }
}

export function assertSchemaName(name: string): void {
  if (!identifierPattern.test(name) || name.startsWith("pg_") || name === "sys") {
    throw new Error(`Invalid schema name "${name}".`);
  }
}

export function assertPrincipalArn(arn: string): void {
  if (!principalArnPattern.test(arn)) {
    throw new Error(`Not an IAM role or user ARN: "${arn}".`);
  }
}

export function toPrincipalAccount(arn: string): string | undefined {
  return principalArnPattern.exec(arn)?.[1];
}

const roleNameSchema = v.pipe(
  v.string(),
  v.check((name) => {
    try {
      assertRoleName(name);
      return true;
    } catch {
      return false;
    }
  }, "Invalid role name."),
);
const tableNameSchema = v.pipe(v.string(), v.regex(identifierPattern, "Invalid table name."));
const schemaNameSchema = v.pipe(
  v.string(),
  v.regex(identifierPattern, "Invalid schema name."),
  v.check((name) => !name.startsWith("pg_") && name !== "sys", "Invalid schema name."),
);
const principalArnSchema = v.pipe(
  v.string(),
  v.regex(principalArnPattern, "Invalid principal ARN."),
);

const accessRoleSchema = v.pipe(
  v.object({
    name: roleNameSchema,
    privileges: v.pipe(v.array(v.picklist(dsqlPrivileges)), v.minLength(1), v.readonly()),
    /** Tables the privileges apply to. Absent means every table in the schema, including later ones. */
    tables: v.optional(v.pipe(v.array(tableNameSchema), v.minLength(1), v.readonly())),
    /** IAM role or user ARNs mapped to this role with `AWS IAM GRANT`. */
    principals: v.pipe(v.array(principalArnSchema), v.readonly()),
  }),
  v.readonly(),
);

const accessManifestSchema = v.pipe(
  v.object({
    version: v.literal(1),
    clusterId: v.pipe(v.string(), v.regex(/^[a-z0-9]+$/, "Invalid cluster id.")),
    account: v.pipe(v.string(), v.regex(/^\d{12}$/, "Invalid account id.")),
    schema: schemaNameSchema,
    roles: v.pipe(v.array(accessRoleSchema), v.readonly()),
  }),
  v.check(
    (manifest) => new Set(manifest.roles.map((role) => role.name)).size === manifest.roles.length,
    "Role names must be unique.",
  ),
  v.readonly(),
);

/** One database role: what it may do, where, and which IAM principals log in as it. */
export type AccessRole = v.InferOutput<typeof accessRoleSchema>;

/** Desired database access, written by the CDK construct and applied by {@link reconcileAccess}. */
export type AccessManifest = v.InferOutput<typeof accessManifestSchema>;

/** Validates untrusted input (for example the SSM parameter value) as an {@link AccessManifest}. */
export function parseAccessManifest(value: unknown): AccessManifest {
  return v.parse(accessManifestSchema, value);
}

/** SSM parameter that holds the manifest of a cluster. */
export function toAccessManifestParameterName(clusterId: string): string {
  return `/beesolve/dsql/${clusterId}/access-manifest`;
}
