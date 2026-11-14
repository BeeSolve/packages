import * as v from "valibot";

import { type AccessManifest, type DsqlPrivilege, dsqlPrivileges } from "./manifest";

/**
 * The part of a `pg` `Pool` or `Client` the admin helpers use. Every call runs on its own
 * (autocommit), which DSQL requires for DDL and role statements.
 */
export type SqlClient = {
  query(text: string, values?: Array<unknown>): Promise<{ rows: Array<unknown> }>;
};

export type RoleMapping = {
  readonly role: string;
  readonly arn: string;
};

/** What the cluster currently has, as far as the manifest's roles are concerned. */
export type AccessState = {
  readonly existingRoles: ReadonlySet<string>;
  readonly mappings: ReadonlyArray<RoleMapping>;
  readonly schemaExists: boolean;
  readonly tables: ReadonlyArray<string>;
  /** Per inspected role: whether it has USAGE on the manifest schema. */
  readonly schemaUsage: ReadonlyMap<string, boolean>;
  /** Per inspected role and table: the privileges it holds. */
  readonly tablePrivileges: ReadonlyMap<string, ReadonlyMap<string, ReadonlySet<DsqlPrivilege>>>;
};

const roleRowSchema = v.object({ rolname: v.string() });
const mappingRowSchema = v.object({ pg_role_name: v.string(), arn: v.string() });
const tableRowSchema = v.object({ relname: v.string() });
const usageRowSchema = v.object({ usage: v.boolean() });
const privilegeRowSchema = v.object({
  table: v.string(),
  select: v.boolean(),
  insert: v.boolean(),
  update: v.boolean(),
  delete: v.boolean(),
});

const privilegeColumns = {
  SELECT: "select",
  INSERT: "insert",
  UPDATE: "update",
  DELETE: "delete",
} as const satisfies Record<DsqlPrivilege, string>;

/** Roles the cluster maps to IAM principals but the manifest does not declare. */
export function toUndeclaredMappedRoles(
  manifest: AccessManifest,
  mappings: ReadonlyArray<RoleMapping>,
): ReadonlyArray<string> {
  const declared = new Set(manifest.roles.map((role) => role.name));
  const undeclared = new Set(
    mappings
      .map((mapping) => mapping.role)
      .filter((role) => role !== "admin" && !declared.has(role)),
  );
  return [...undeclared].sort();
}

/**
 * Reads the current roles, IAM mappings, tables and privileges. Read-only. With `prune`, the
 * undeclared mapped roles are inspected too, so their privileges can be revoked.
 */
export async function readAccessState(props: {
  readonly client: SqlClient;
  readonly manifest: AccessManifest;
  readonly prune?: boolean;
}): Promise<AccessState> {
  const { client, manifest } = props;

  const roleRows = await client.query("SELECT rolname FROM pg_roles");
  const existingRoles = new Set(roleRows.rows.map((row) => v.parse(roleRowSchema, row).rolname));

  const mappingRows = await client.query("SELECT pg_role_name, arn FROM sys.iam_pg_role_mappings");
  const mappings = mappingRows.rows.map((row) => {
    const parsed = v.parse(mappingRowSchema, row);
    return { role: parsed.pg_role_name, arn: parsed.arn };
  });

  const schemaRows = await client.query("SELECT 1 FROM pg_namespace WHERE nspname = $1", [
    manifest.schema,
  ]);
  const schemaExists = schemaRows.rows.length > 0;

  const tableRows = schemaExists
    ? await client.query(
        `SELECT c.relname FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
          WHERE n.nspname = $1 AND c.relkind = 'r' ORDER BY c.relname`,
        [manifest.schema],
      )
    : { rows: [] };
  const tables = tableRows.rows.map((row) => v.parse(tableRowSchema, row).relname);

  const inspectedRoles = [
    ...manifest.roles.map((role) => role.name),
    ...(props.prune ? toUndeclaredMappedRoles(manifest, mappings) : []),
  ].filter((role) => existingRoles.has(role));

  const schemaUsage = new Map<string, boolean>();
  const tablePrivileges = new Map<string, Map<string, Set<DsqlPrivilege>>>();

  for (const role of schemaExists ? inspectedRoles : []) {
    const usageRows = await client.query("SELECT has_schema_privilege($1, $2, 'USAGE') AS usage", [
      role,
      manifest.schema,
    ]);
    const usageRow = usageRows.rows[0];
    schemaUsage.set(role, usageRow != null && v.parse(usageRowSchema, usageRow).usage);

    const privilegeRows = await client.query(
      `SELECT c.relname AS table,
              has_table_privilege($1, c.oid, 'SELECT') AS select,
              has_table_privilege($1, c.oid, 'INSERT') AS insert,
              has_table_privilege($1, c.oid, 'UPDATE') AS update,
              has_table_privilege($1, c.oid, 'DELETE') AS delete
         FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = $2 AND c.relkind = 'r'`,
      [role, manifest.schema],
    );
    const byTable = new Map<string, Set<DsqlPrivilege>>();
    for (const row of privilegeRows.rows) {
      const parsed = v.parse(privilegeRowSchema, row);
      byTable.set(
        parsed.table,
        new Set(dsqlPrivileges.filter((privilege) => parsed[privilegeColumns[privilege]])),
      );
    }
    tablePrivileges.set(role, byTable);
  }

  return { existingRoles, mappings, schemaExists, tables, schemaUsage, tablePrivileges };
}
