import {
  type AccessManifest,
  assertPrincipalArn,
  assertRoleName,
  assertSchemaName,
  assertTableName,
  type DsqlPrivilege,
  dsqlPrivileges,
  toPrincipalAccount,
} from "./manifest";
import { type AccessState, toUndeclaredMappedRoles } from "./state";

export type AccessPlan = {
  /** SQL to run, in order. Empty when the cluster already matches the manifest. */
  readonly statements: ReadonlyArray<string>;
  /** Mismatches that block applying the plan. */
  readonly problems: ReadonlyArray<string>;
  /** Drift that is reported but left alone (see `prune`). */
  readonly warnings: ReadonlyArray<string>;
};

const emptyPrivileges: ReadonlySet<DsqlPrivilege> = new Set();

function toPrivilegeList(privileges: Iterable<DsqlPrivilege>): string {
  const set = new Set(privileges);
  return dsqlPrivileges.filter((privilege) => set.has(privilege)).join(", ");
}

/**
 * Computes the SQL that makes the cluster match the manifest. Pure: no database access.
 *
 * Declared roles converge in both directions: missing privileges and IAM mappings are granted,
 * extra ones revoked. Roles that are mapped to IAM but not declared are only reported, unless
 * `prune` is set, in which case their mappings and privileges are revoked and the role dropped.
 *
 * Privileges are granted before the IAM mapping, so a principal never logs in as a role that
 * cannot yet use its tables. Stale mappings are revoked before new ones are granted, so moving
 * a principal from one role to another works even if DSQL allows one role per principal.
 */
export function planAccess(props: {
  readonly manifest: AccessManifest;
  readonly state: AccessState;
  readonly prune?: boolean;
}): AccessPlan {
  const { manifest, state } = props;
  const problems: Array<string> = [];
  const warnings: Array<string> = [];

  assertSchemaName(manifest.schema);
  const schema = manifest.schema;
  const isPublicSchema = schema === "public";
  const qualified = (table: string) => `"${schema}"."${table}"`;

  if (!state.schemaExists) {
    problems.push(`Schema "${schema}" does not exist. Create it in a migration first.`);
  }

  const existingTables = new Set(state.tables);
  const creates: Array<string> = [];
  const usageGrants: Array<string> = [];
  const tableGrants: Array<string> = [];
  const tableRevokes: Array<string> = [];
  const mappingRevokes: Array<string> = [];
  const mappingGrants: Array<string> = [];

  for (const role of manifest.roles) {
    assertRoleName(role.name);
    const exists = state.existingRoles.has(role.name);

    if (!exists) {
      creates.push(`CREATE ROLE ${role.name} WITH LOGIN`);
    }

    if (exists && state.schemaExists && state.schemaUsage.get(role.name) !== true) {
      if (isPublicSchema) {
        problems.push(
          `Role ${role.name} has no USAGE on schema public, and DSQL does not allow granting it on that system schema.`,
        );
      } else {
        usageGrants.push(`GRANT USAGE ON SCHEMA "${schema}" TO ${role.name}`);
      }
    } else if (!exists && !isPublicSchema) {
      usageGrants.push(`GRANT USAGE ON SCHEMA "${schema}" TO ${role.name}`);
    }

    for (const table of role.tables ?? []) {
      assertTableName(table);
      if (!existingTables.has(table)) {
        problems.push(
          `Role ${role.name} lists table "${table}", which does not exist in schema "${schema}".`,
        );
      }
    }

    const scopedTables = new Set(role.tables ?? state.tables);
    const current = state.tablePrivileges.get(role.name);
    for (const table of state.tables) {
      const desired: ReadonlySet<DsqlPrivilege> = scopedTables.has(table)
        ? new Set(role.privileges)
        : emptyPrivileges;
      const held = current?.get(table) ?? emptyPrivileges;
      const missing = [...desired].filter((privilege) => !held.has(privilege));
      const extra = [...held].filter((privilege) => !desired.has(privilege));
      if (missing.length > 0) {
        tableGrants.push(
          `GRANT ${toPrivilegeList(missing)} ON TABLE ${qualified(table)} TO ${role.name}`,
        );
      }
      if (extra.length > 0) {
        tableRevokes.push(
          `REVOKE ${toPrivilegeList(extra)} ON TABLE ${qualified(table)} FROM ${role.name}`,
        );
      }
    }

    const desiredPrincipals = new Set(role.principals);
    const mappedPrincipals = new Set(
      state.mappings.filter((mapping) => mapping.role === role.name).map((mapping) => mapping.arn),
    );
    for (const arn of desiredPrincipals) {
      assertPrincipalArn(arn);
      if (toPrincipalAccount(arn) !== manifest.account) {
        problems.push(
          `Principal ${arn} of role ${role.name} is not in account ${manifest.account}, the account of the cluster.`,
        );
      }
      if (!mappedPrincipals.has(arn)) {
        mappingGrants.push(`AWS IAM GRANT ${role.name} TO '${arn}'`);
      }
      const otherRoles = state.mappings
        .filter((mapping) => mapping.arn === arn && mapping.role !== role.name)
        .map((mapping) => mapping.role);
      for (const other of otherRoles) {
        if (!manifest.roles.some((declared) => declared.name === other) && !props.prune) {
          warnings.push(
            `${arn} is also mapped to undeclared role ${other}. Run with prune to revoke it.`,
          );
        }
      }
    }
    for (const arn of mappedPrincipals) {
      if (!desiredPrincipals.has(arn)) {
        assertPrincipalArn(arn);
        mappingRevokes.push(`AWS IAM REVOKE ${role.name} FROM '${arn}'`);
      }
    }
  }

  const pruneStatements: Array<string> = [];
  for (const role of toUndeclaredMappedRoles(manifest, state.mappings)) {
    if (!props.prune) {
      warnings.push(
        `Role ${role} is mapped to IAM principals but not declared. Run with prune to revoke and drop it.`,
      );
      continue;
    }
    assertRoleName(role);
    for (const mapping of state.mappings.filter((candidate) => candidate.role === role)) {
      assertPrincipalArn(mapping.arn);
      pruneStatements.push(`AWS IAM REVOKE ${role} FROM '${mapping.arn}'`);
    }
    for (const [table, held] of state.tablePrivileges.get(role) ?? []) {
      if (held.size > 0) {
        assertTableName(table);
        pruneStatements.push(
          `REVOKE ${toPrivilegeList(held)} ON TABLE ${qualified(table)} FROM ${role}`,
        );
      }
    }
    if (!isPublicSchema && state.schemaUsage.get(role) === true) {
      pruneStatements.push(`REVOKE USAGE ON SCHEMA "${schema}" FROM ${role}`);
    }
    pruneStatements.push(`DROP ROLE ${role}`);
  }

  return {
    statements: [
      ...creates,
      ...usageGrants,
      ...tableGrants,
      ...mappingRevokes,
      ...mappingGrants,
      ...tableRevokes,
      ...pruneStatements,
    ],
    problems: [...new Set(problems)],
    warnings: [...new Set(warnings)],
  };
}
