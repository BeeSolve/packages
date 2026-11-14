import { describe, expect, test } from "bun:test";

import {
  type AccessManifest,
  type AccessState,
  type DsqlPrivilege,
  parseAccessManifest,
  parseDsqlEndpoint,
  planAccess,
  reconcileAccess,
  type SqlClient,
} from "../admin";

const site = "arn:aws:iam::123456789012:role/App-SiteRole-ABC";
const digest = "arn:aws:iam::123456789012:role/App-DigestRole-DEF";

function makeManifest(overrides: Partial<AccessManifest> = {}): AccessManifest {
  return {
    version: 1,
    clusterId: "abc123",
    account: "123456789012",
    schema: "public",
    roles: [
      {
        name: "app_readwrite",
        privileges: ["SELECT", "INSERT", "UPDATE", "DELETE"],
        principals: [site],
      },
      {
        name: "digest",
        privileges: ["SELECT", "UPDATE"],
        tables: ["pending"],
        principals: [digest],
      },
    ],
    ...overrides,
  };
}

function makeState(overrides: Partial<AccessState> = {}): AccessState {
  return {
    existingRoles: new Set(),
    mappings: [],
    schemaExists: true,
    tables: ["pending", "users"],
    schemaUsage: new Map(),
    tablePrivileges: new Map(),
    ...overrides,
  };
}

const all: ReadonlyArray<DsqlPrivilege> = ["SELECT", "INSERT", "UPDATE", "DELETE"];

describe("planAccess", () => {
  test("creates roles, grants table privileges, then maps IAM principals", () => {
    const plan = planAccess({ manifest: makeManifest(), state: makeState() });
    expect(plan.problems).toEqual([]);
    expect(plan.statements).toEqual([
      "CREATE ROLE app_readwrite WITH LOGIN",
      "CREATE ROLE digest WITH LOGIN",
      'GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE "public"."pending" TO app_readwrite',
      'GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE "public"."users" TO app_readwrite',
      'GRANT SELECT, UPDATE ON TABLE "public"."pending" TO digest',
      `AWS IAM GRANT app_readwrite TO '${site}'`,
      `AWS IAM GRANT digest TO '${digest}'`,
    ]);
  });

  test("is empty when the cluster matches", () => {
    const plan = planAccess({
      manifest: makeManifest(),
      state: makeState({
        existingRoles: new Set(["app_readwrite", "digest"]),
        mappings: [
          { role: "app_readwrite", arn: site },
          { role: "digest", arn: digest },
        ],
        schemaUsage: new Map([
          ["app_readwrite", true],
          ["digest", true],
        ]),
        tablePrivileges: new Map([
          [
            "app_readwrite",
            new Map([
              ["pending", new Set(all)],
              ["users", new Set(all)],
            ]),
          ],
          [
            "digest",
            new Map([
              ["pending", new Set<DsqlPrivilege>(["SELECT", "UPDATE"])],
              ["users", new Set<DsqlPrivilege>()],
            ]),
          ],
        ]),
      }),
    });
    expect(plan).toEqual({ statements: [], problems: [], warnings: [] });
  });

  test("revokes privileges outside the role's scope and stale IAM mappings", () => {
    const stale = "arn:aws:iam::123456789012:role/App-OldRole-XYZ";
    const plan = planAccess({
      manifest: makeManifest(),
      state: makeState({
        existingRoles: new Set(["app_readwrite", "digest"]),
        mappings: [
          { role: "app_readwrite", arn: site },
          { role: "digest", arn: digest },
          { role: "digest", arn: stale },
        ],
        schemaUsage: new Map([
          ["app_readwrite", true],
          ["digest", true],
        ]),
        tablePrivileges: new Map([
          [
            "app_readwrite",
            new Map([
              ["pending", new Set(all)],
              ["users", new Set(all)],
            ]),
          ],
          [
            "digest",
            new Map([
              ["pending", new Set(all)],
              ["users", new Set<DsqlPrivilege>(["SELECT"])],
            ]),
          ],
        ]),
      }),
    });
    expect(plan.statements).toEqual([
      `AWS IAM REVOKE digest FROM '${stale}'`,
      'REVOKE INSERT, DELETE ON TABLE "public"."pending" FROM digest',
      'REVOKE SELECT ON TABLE "public"."users" FROM digest',
    ]);
  });

  test("reports a declared table that does not exist", () => {
    const plan = planAccess({
      manifest: makeManifest(),
      state: makeState({ tables: ["users"] }),
    });
    expect(plan.problems).toEqual([
      'Role digest lists table "pending", which does not exist in schema "public".',
    ]);
  });

  test("reports principals outside the cluster account", () => {
    const foreign = "arn:aws:iam::999999999999:role/Other";
    const plan = planAccess({
      manifest: makeManifest({
        roles: [{ name: "app_read", privileges: ["SELECT"], principals: [foreign] }],
      }),
      state: makeState(),
    });
    expect(plan.problems).toEqual([
      `Principal ${foreign} of role app_read is not in account 123456789012, the account of the cluster.`,
    ]);
  });

  test("reports missing USAGE on public instead of granting it", () => {
    const plan = planAccess({
      manifest: makeManifest({
        roles: [{ name: "app_read", privileges: ["SELECT"], principals: [] }],
      }),
      state: makeState({
        existingRoles: new Set(["app_read"]),
        schemaUsage: new Map([["app_read", false]]),
      }),
    });
    expect(plan.problems[0]).toContain("has no USAGE on schema public");
  });

  test("grants USAGE on a custom schema", () => {
    const plan = planAccess({
      manifest: makeManifest({
        schema: "orders",
        roles: [{ name: "app_read", privileges: ["SELECT"], principals: [] }],
      }),
      state: makeState({ tables: [] }),
    });
    expect(plan.statements).toEqual([
      "CREATE ROLE app_read WITH LOGIN",
      'GRANT USAGE ON SCHEMA "orders" TO app_read',
    ]);
  });

  test("only warns about undeclared mapped roles without prune", () => {
    const plan = planAccess({
      manifest: makeManifest({ roles: [] }),
      state: makeState({ mappings: [{ role: "expense_ease_app", arn: site }] }),
    });
    expect(plan.statements).toEqual([]);
    expect(plan.warnings).toEqual([
      "Role expense_ease_app is mapped to IAM principals but not declared. Run with prune to revoke and drop it.",
    ]);
  });

  test("prune revokes mappings and privileges, then drops the role", () => {
    const plan = planAccess({
      prune: true,
      manifest: makeManifest({ roles: [] }),
      state: makeState({
        existingRoles: new Set(["expense_ease_app"]),
        mappings: [
          { role: "expense_ease_app", arn: site },
          { role: "admin", arn: site },
        ],
        tablePrivileges: new Map([
          [
            "expense_ease_app",
            new Map([
              ["users", new Set(all)],
              ["pending", new Set<DsqlPrivilege>()],
            ]),
          ],
        ]),
      }),
    });
    expect(plan.statements).toEqual([
      `AWS IAM REVOKE expense_ease_app FROM '${site}'`,
      'REVOKE SELECT, INSERT, UPDATE, DELETE ON TABLE "public"."users" FROM expense_ease_app',
      "DROP ROLE expense_ease_app",
    ]);
  });
});

describe("parseAccessManifest", () => {
  test("rejects identifiers and ARNs that could inject SQL", () => {
    const base = makeManifest();
    expect(() =>
      parseAccessManifest({ ...base, roles: [{ ...base.roles[0], name: "x; DROP TABLE users" }] }),
    ).toThrow();
    expect(() =>
      parseAccessManifest({ ...base, roles: [{ ...base.roles[0], tables: ['users"; --'] }] }),
    ).toThrow();
    expect(() =>
      parseAccessManifest({
        ...base,
        roles: [{ ...base.roles[0], principals: ["arn'; DROP ROLE x; --"] }],
      }),
    ).toThrow();
    expect(() =>
      parseAccessManifest({ ...base, roles: [{ ...base.roles[0], privileges: ["ALL"] }] }),
    ).toThrow();
    expect(() => parseAccessManifest({ ...base, roles: [base.roles[0], base.roles[0]] })).toThrow();
  });

  test("accepts a valid manifest", () => {
    expect(parseAccessManifest(JSON.parse(JSON.stringify(makeManifest())))).toEqual(makeManifest());
  });
});

describe("parseDsqlEndpoint", () => {
  test("splits the endpoint", () => {
    expect(parseDsqlEndpoint("abc123.dsql.eu-central-1.on.aws")).toEqual({
      clusterId: "abc123",
      region: "eu-central-1",
    });
    expect(() => parseDsqlEndpoint("example.com")).toThrow(/Not a DSQL cluster endpoint/);
  });
});

/** Answers the state queries from an in-memory cluster and applies the plan's statements to it. */
function makeFakeCluster() {
  const roles = new Set<string>(["admin"]);
  const mappings: Array<{ role: string; arn: string }> = [];
  const privileges = new Map<string, Set<string>>();
  const tables = ["pending", "users"];
  const executed: Array<string> = [];
  const key = (role: string, table: string) => `${role}/${table}`;

  const client: SqlClient = {
    async query(text, values = []) {
      if (text.startsWith("SELECT rolname FROM pg_roles")) {
        return { rows: [...roles].map((rolname) => ({ rolname })) };
      }
      if (text.startsWith("SELECT pg_role_name, arn")) {
        return {
          rows: mappings.map((mapping) => ({ pg_role_name: mapping.role, arn: mapping.arn })),
        };
      }
      if (text.startsWith("SELECT 1 FROM pg_namespace")) {
        return { rows: [{ "?column?": 1 }] };
      }
      if (text.startsWith("SELECT c.relname FROM pg_class")) {
        return { rows: tables.map((relname) => ({ relname })) };
      }
      if (text.startsWith("SELECT has_schema_privilege")) {
        return { rows: [{ usage: true }] };
      }
      if (text.startsWith("SELECT c.relname AS table")) {
        const role = String(values[0]);
        return {
          rows: tables.map((table) => {
            const held = privileges.get(key(role, table)) ?? new Set();
            return {
              table,
              select: held.has("SELECT"),
              insert: held.has("INSERT"),
              update: held.has("UPDATE"),
              delete: held.has("DELETE"),
            };
          }),
        };
      }

      executed.push(text);
      const groups = (pattern: RegExp) => pattern.exec(text)?.slice(1).map(String);
      const privilegeList = (list: string) => list.split(", ");
      let parts: Array<string> | undefined;
      if ((parts = groups(/^CREATE ROLE (\w+) WITH LOGIN$/))) {
        roles.add(String(parts[0]));
      } else if ((parts = groups(/^GRANT ([A-Z, ]+) ON TABLE "public"\."(\w+)" TO (\w+)$/))) {
        const [list = "", table = "", role = ""] = parts;
        const held = privileges.get(key(role, table)) ?? new Set();
        privilegeList(list).forEach((privilege) => held.add(privilege));
        privileges.set(key(role, table), held);
      } else if ((parts = groups(/^REVOKE ([A-Z, ]+) ON TABLE "public"\."(\w+)" FROM (\w+)$/))) {
        const [list = "", table = "", role = ""] = parts;
        const held = privileges.get(key(role, table)) ?? new Set();
        privilegeList(list).forEach((privilege) => held.delete(privilege));
      } else if ((parts = groups(/^AWS IAM GRANT (\w+) TO '(.+)'$/))) {
        const [role = "", arn = ""] = parts;
        mappings.push({ role, arn });
      } else if ((parts = groups(/^AWS IAM REVOKE (\w+) FROM '(.+)'$/))) {
        const [role, arn] = parts;
        mappings.splice(
          mappings.findIndex((mapping) => mapping.role === role && mapping.arn === arn),
          1,
        );
      } else if ((parts = groups(/^DROP ROLE (\w+)$/))) {
        roles.delete(String(parts[0]));
      } else {
        throw new Error(`Unexpected statement: ${text}`);
      }
      return { rows: [] };
    },
  };
  return { client, executed, mappings, roles };
}

describe("reconcileAccess", () => {
  test("applies the plan, verifies it, and is a no-op on the second run", async () => {
    const cluster = makeFakeCluster();
    const log: Array<string> = [];
    await reconcileAccess({
      client: cluster.client,
      manifest: makeManifest(),
      log: (line) => log.push(line),
    });
    expect(cluster.executed).toHaveLength(7);
    expect(log.at(-1)).toBe("Access matches the manifest.");

    cluster.executed.length = 0;
    const plan = await reconcileAccess({
      client: cluster.client,
      manifest: makeManifest(),
      log: () => {},
    });
    expect(plan.statements).toEqual([]);
    expect(cluster.executed).toEqual([]);
  });

  test("dry run executes nothing", async () => {
    const cluster = makeFakeCluster();
    const plan = await reconcileAccess({
      client: cluster.client,
      manifest: makeManifest(),
      dryRun: true,
      log: () => {},
    });
    expect(plan.statements).toHaveLength(7);
    expect(cluster.executed).toEqual([]);
  });

  test("moves a principal to another role and prunes the old one", async () => {
    const cluster = makeFakeCluster();
    cluster.roles.add("expense_ease_app");
    cluster.mappings.push({ role: "expense_ease_app", arn: site });

    await reconcileAccess({
      client: cluster.client,
      manifest: makeManifest(),
      prune: true,
      log: () => {},
    });
    expect(cluster.executed.at(-1)).toBe("DROP ROLE expense_ease_app");
    expect(cluster.mappings).toEqual([
      { role: "app_readwrite", arn: site },
      { role: "digest", arn: digest },
    ]);
  });

  test("refuses to apply a manifest with problems", async () => {
    const cluster = makeFakeCluster();
    const manifest = makeManifest({
      roles: [{ name: "app_read", privileges: ["SELECT"], tables: ["missing"], principals: [] }],
    });
    expect(reconcileAccess({ client: cluster.client, manifest, log: () => {} })).rejects.toThrow(
      /lists table "missing"/,
    );
    expect(cluster.executed).toEqual([]);
  });
});
