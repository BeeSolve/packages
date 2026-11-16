import { Lazy, RemovalPolicy, Stack } from "aws-cdk-lib";
import { CfnCluster } from "aws-cdk-lib/aws-dsql";
import { Grant, type IRole } from "aws-cdk-lib/aws-iam";
import { ParameterTier, StringParameter } from "aws-cdk-lib/aws-ssm";
import { Construct } from "constructs";

import {
  type AccessManifest,
  assertRoleName,
  assertSchemaName,
  assertTableName,
  type DsqlPrivilege,
  dsqlPrivileges,
  toAccessManifestParameterName,
} from "../access/manifest";
import { dsqlEnvNames } from "../envNames";

/** A database role declared on the cluster. */
export type DsqlRoleProps = {
  readonly privileges: ReadonlyArray<DsqlPrivilege>;
  /**
   * Tables the privileges apply to. Omit to cover every table in the schema, including tables
   * added by later migrations.
   */
  readonly tables?: ReadonlyArray<string>;
};

export type DsqlClusterProps<TRoles extends string> = {
  /** Custom database roles, granted with {@link DsqlCluster.grant}. */
  readonly roles?: Readonly<Record<TRoles, DsqlRoleProps>>;
  /** Prefix of the built-in roles (`<prefix>_read`, `<prefix>_write`, `<prefix>_readwrite`). Default `app`. */
  readonly roleNamePrefix?: string;
  /** Schema the roles' privileges apply to. Default `public`. */
  readonly schema?: string;
  /** Default `true`. */
  readonly deletionProtection?: boolean;
  /** Default `RemovalPolicy.RETAIN`. */
  readonly removalPolicy?: RemovalPolicy;
  /** Tier of the SSM parameter holding the access manifest. Standard holds 4 KB. Default standard. */
  readonly manifestParameterTier?: ParameterTier;
};

/** A Lambda function (gets IAM access and the `DSQL_*` env vars) or an IAM role (IAM access only). */
export type DsqlGrantee =
  | IRole
  | {
      readonly role?: IRole | undefined;
      readonly node: Construct["node"];
      addEnvironment(key: string, value: string): unknown;
    };

const builtInRoles = {
  read: { method: "grantRead", privileges: ["SELECT"] },
  write: { method: "grantWrite", privileges: ["INSERT", "UPDATE", "DELETE"] },
  readwrite: { method: "grantReadWrite", privileges: ["SELECT", "INSERT", "UPDATE", "DELETE"] },
} as const satisfies Record<
  string,
  { readonly method: string; readonly privileges: ReadonlyArray<DsqlPrivilege> }
>;

type RoleDefinition = {
  readonly privileges: ReadonlyArray<DsqlPrivilege>;
  readonly tables?: ReadonlyArray<string> | undefined;
};

function isRole(grantee: DsqlGrantee): grantee is IRole {
  return !("addEnvironment" in grantee);
}

/**
 * An Aurora DSQL cluster with least-privilege database access declared in code.
 *
 * IAM only decides who may connect (`dsql:DbConnect`); which tables a connection may touch is
 * decided by the database role its IAM principal is mapped to. Each `grant*` call adds the IAM
 * permission, sets `DSQL_ENDPOINT`, `DSQL_REGION` and `DSQL_DB_USER` on a Lambda, and records the
 * mapping in an access manifest (an SSM parameter). `reconcileAccess` from
 * `@beesolve/dsql-helpers/admin` applies the manifest to the database: it creates roles, grants
 * and revokes table privileges, and grants and revokes IAM mappings, so access follows the code.
 *
 * The cluster keeps the logical ID of this construct (`new DsqlCluster(this, "Dsql")` creates
 * `Dsql`), so wrapping an existing `CfnCluster` with the same ID does not replace it.
 */
export class DsqlCluster<TRoles extends string = never> extends Construct {
  readonly cluster: CfnCluster;
  /** Cluster identifier (`Ref`). */
  readonly clusterId: string;
  readonly clusterArn: string;
  /** `<cluster id>.dsql.<region>.on.aws`, the host the connector expects. */
  readonly endpoint: string;
  readonly schema: string;
  readonly accessManifestParameter: StringParameter;

  private readonly roleNamePrefix: string;
  private readonly roles = new Map<string, RoleDefinition>();
  private readonly builtInRoleNames = new Set<string>();
  private readonly principalsByRole = new Map<string, Array<string>>();
  private readonly roleByPrincipal = new Map<IRole, string>();

  constructor(scope: Construct, id: string, props: DsqlClusterProps<TRoles> = {}) {
    super(scope, id);

    this.schema = props.schema ?? "public";
    assertSchemaName(this.schema);
    this.roleNamePrefix = props.roleNamePrefix ?? "app";

    for (const [name, role] of Object.entries<DsqlRoleProps>(props.roles ?? {})) {
      this.defineRole(name, role);
    }

    // The ID `Default` keeps the construct's own logical ID for the cluster.
    this.cluster = new CfnCluster(this, "Default", {
      deletionProtectionEnabled: props.deletionProtection ?? true,
    });
    this.cluster.applyRemovalPolicy(props.removalPolicy ?? RemovalPolicy.RETAIN);

    const stack = Stack.of(this);
    this.clusterId = this.cluster.ref;
    this.clusterArn = this.cluster.attrResourceArn;
    this.endpoint = `${this.clusterId}.dsql.${stack.region}.on.aws`;

    this.accessManifestParameter = new StringParameter(this, "AccessManifest", {
      parameterName: toAccessManifestParameterName(this.clusterId),
      simpleName: false,
      description: "Database roles and IAM mappings of the DSQL cluster (@beesolve/dsql-helpers).",
      tier: props.manifestParameterTier ?? ParameterTier.STANDARD,
      stringValue: Lazy.string({ produce: () => stack.toJsonString(this.toAccessManifest()) }),
    });
  }

  /** Maps the grantee to the custom role `role` declared in `roles`. */
  grant(grantee: DsqlGrantee, role: TRoles): Grant {
    return this.grantRole(grantee, role);
  }

  /** `SELECT` on every table. Role `<prefix>_read`. */
  grantRead(grantee: DsqlGrantee): Grant {
    return this.grantRole(grantee, this.useBuiltInRole("read"));
  }

  /**
   * `INSERT`, `UPDATE`, `DELETE` on every table, without `SELECT`. Role `<prefix>_write`.
   * PostgreSQL also requires `SELECT` for `UPDATE`/`DELETE` with a `WHERE` clause and for
   * `RETURNING`, so this suits append-only writers; most code wants {@link grantReadWrite}.
   */
  grantWrite(grantee: DsqlGrantee): Grant {
    return this.grantRole(grantee, this.useBuiltInRole("write"));
  }

  /** `SELECT`, `INSERT`, `UPDATE`, `DELETE` on every table. Role `<prefix>_readwrite`. */
  grantReadWrite(grantee: DsqlGrantee): Grant {
    return this.grantRole(grantee, this.useBuiltInRole("readwrite"));
  }

  /** The desired access as recorded so far. Principal ARNs are unresolved tokens until deploy. */
  toAccessManifest(): AccessManifest {
    const stack = Stack.of(this);
    return {
      version: 1,
      clusterId: this.clusterId,
      account: stack.account,
      schema: this.schema,
      roles: [...this.roles.entries()].map(([name, role]) => ({
        name,
        privileges: role.privileges,
        ...(role.tables == null ? {} : { tables: role.tables }),
        principals: this.principalsByRole.get(name) ?? [],
      })),
    };
  }

  private defineRole(name: string, role: DsqlRoleProps): void {
    assertRoleName(name);
    if (this.roles.has(name)) {
      throw new Error(`DSQL role ${name} is declared twice.`);
    }
    if (role.privileges.length === 0) {
      throw new Error(`DSQL role ${name} has no privileges.`);
    }
    for (const privilege of role.privileges) {
      if (!dsqlPrivileges.includes(privilege)) {
        throw new Error(`DSQL role ${name} has unsupported privilege "${privilege}".`);
      }
    }
    if (role.tables != null) {
      if (role.tables.length === 0) {
        throw new Error(`DSQL role ${name} has an empty table list. Omit it to cover every table.`);
      }
      role.tables.forEach(assertTableName);
    }
    this.roles.set(name, {
      privileges: dsqlPrivileges.filter((privilege) => role.privileges.includes(privilege)),
      ...(role.tables == null ? {} : { tables: [...new Set(role.tables)].sort() }),
    });
  }

  private useBuiltInRole(kind: keyof typeof builtInRoles): string {
    const builtIn = builtInRoles[kind];
    const name = `${this.roleNamePrefix}_${kind}`;
    const existing = this.roles.get(name);
    if (existing == null) {
      this.defineRole(name, { privileges: builtIn.privileges });
      this.builtInRoleNames.add(name);
    } else if (!this.builtInRoleNames.has(name)) {
      throw new Error(
        `Custom DSQL role ${name} collides with the built-in role of ${builtIn.method}(). Rename it or set roleNamePrefix.`,
      );
    }
    return name;
  }

  private grantRole(grantee: DsqlGrantee, roleName: string): Grant {
    if (!this.roles.has(roleName)) {
      throw new Error(`DSQL role ${roleName} is not declared on ${this.node.path}.`);
    }

    const role = isRole(grantee) ? grantee : grantee.role;
    if (role == null) {
      throw new Error(`Expected ${grantee.node.path} to have an execution role.`);
    }

    const mapped = this.roleByPrincipal.get(role);
    if (mapped != null && mapped !== roleName) {
      throw new Error(
        `${role.node.path} is already granted DSQL role ${mapped}; an IAM principal maps to one database role, so it cannot also get ${roleName}. Declare a role that combines both.`,
      );
    }
    if (mapped == null) {
      this.roleByPrincipal.set(role, roleName);
      const principals = this.principalsByRole.get(roleName) ?? [];
      principals.push(role.roleArn);
      this.principalsByRole.set(roleName, principals);
    }

    if (!isRole(grantee)) {
      const stack = Stack.of(this);
      grantee.addEnvironment(dsqlEnvNames.endpoint, this.endpoint);
      grantee.addEnvironment(dsqlEnvNames.region, stack.region);
      grantee.addEnvironment(dsqlEnvNames.user, roleName);
    }

    return Grant.addToPrincipal({
      grantee: role,
      actions: ["dsql:DbConnect"],
      resourceArns: [this.clusterArn],
    });
  }
}
