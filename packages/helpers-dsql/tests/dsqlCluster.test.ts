import { describe, expect, test } from "bun:test";

import { App, RemovalPolicy, Stack } from "aws-cdk-lib";
import { Template } from "aws-cdk-lib/assertions";
import { Role, ServicePrincipal } from "aws-cdk-lib/aws-iam";
import { Code, Function, Runtime } from "aws-cdk-lib/aws-lambda";

import { DsqlCluster, type DsqlRoleProps } from "../cdk";

function makeStack() {
  return new Stack(new App(), "TestStack", {
    env: { account: "123456789012", region: "eu-central-1" },
  });
}

function makeLambda(stack: Stack, id: string) {
  return new Function(stack, id, {
    runtime: Runtime.NODEJS_24_X,
    code: Code.fromInline("exports.handler = async () => {}"),
    handler: "index.handler",
  });
}

function resolvedManifest(stack: Stack, dsql: DsqlCluster<string>) {
  return stack.resolve(dsql.toAccessManifest());
}

describe("DsqlCluster", () => {
  test("keeps the construct id as the cluster logical id", () => {
    const stack = makeStack();
    new DsqlCluster(stack, "Dsql");
    const clusters = Template.fromStack(stack).findResources("AWS::DSQL::Cluster");
    expect(Object.keys(clusters)).toEqual(["Dsql"]);
  });

  test("defaults to deletion protection and RETAIN", () => {
    const stack = makeStack();
    new DsqlCluster(stack, "Dsql");
    Template.fromStack(stack).hasResource("AWS::DSQL::Cluster", {
      Properties: { DeletionProtectionEnabled: true },
      DeletionPolicy: "Retain",
      UpdateReplacePolicy: "Retain",
    });
  });

  test("passes deletion protection and removal policy through", () => {
    const stack = makeStack();
    new DsqlCluster(stack, "Dsql", {
      deletionProtection: false,
      removalPolicy: RemovalPolicy.DESTROY,
    });
    Template.fromStack(stack).hasResource("AWS::DSQL::Cluster", {
      Properties: { DeletionProtectionEnabled: false },
      DeletionPolicy: "Delete",
    });
  });

  test("grantReadWrite adds DbConnect on the cluster and the DSQL env vars", () => {
    const stack = makeStack();
    const dsql = new DsqlCluster(stack, "Dsql");
    const fn = makeLambda(stack, "Fn");
    dsql.grantReadWrite(fn);

    const template = Template.fromStack(stack);
    template.hasResourceProperties("AWS::IAM::Policy", {
      PolicyDocument: {
        Statement: [
          {
            Action: "dsql:DbConnect",
            Effect: "Allow",
            Resource: { "Fn::GetAtt": ["Dsql", "ResourceArn"] },
          },
        ],
      },
    });
    const functions = Object.values(template.findResources("AWS::Lambda::Function"));
    const variables = functions[0]?.Properties.Environment.Variables;
    expect(variables.DSQL_DB_USER).toBe("app_readwrite");
    expect(variables.DSQL_REGION).toBe("eu-central-1");
    expect(variables.DSQL_ENDPOINT).toEqual({
      "Fn::Join": ["", [{ Ref: "Dsql" }, ".dsql.eu-central-1.on.aws"]],
    });
  });

  test("never grants DbConnectAdmin", () => {
    const stack = makeStack();
    const dsql = new DsqlCluster(stack, "Dsql", {
      roles: { reporting: { privileges: ["SELECT"] } },
    });
    dsql.grantRead(makeLambda(stack, "A"));
    dsql.grantWrite(makeLambda(stack, "B"));
    dsql.grant(makeLambda(stack, "C"), "reporting");
    expect(JSON.stringify(Template.fromStack(stack).toJSON())).not.toContain("DbConnectAdmin");
  });

  test("records roles, table scopes and principals in the manifest", () => {
    const stack = makeStack();
    const dsql = new DsqlCluster(stack, "Dsql", {
      roles: {
        digest: { privileges: ["UPDATE", "SELECT", "SELECT"], tables: ["users", "pending"] },
        unused: { privileges: ["SELECT"] },
      },
    });
    const site = makeLambda(stack, "Site");
    const digest = makeLambda(stack, "Digest");
    dsql.grantReadWrite(site);
    dsql.grant(digest, "digest");

    const manifest = resolvedManifest(stack, dsql);
    expect(manifest.version).toBe(1);
    expect(manifest.account).toBe("123456789012");
    expect(manifest.schema).toBe("public");
    expect(manifest.clusterId).toEqual({ Ref: "Dsql" });
    expect(manifest.roles).toEqual([
      {
        name: "digest",
        privileges: ["SELECT", "UPDATE"],
        tables: ["pending", "users"],
        principals: [stack.resolve(digest.role?.roleArn)],
      },
      { name: "unused", privileges: ["SELECT"], principals: [] },
      {
        name: "app_readwrite",
        privileges: ["SELECT", "INSERT", "UPDATE", "DELETE"],
        principals: [stack.resolve(site.role?.roleArn)],
      },
    ]);
  });

  test("writes the manifest to an SSM parameter named after the cluster id", () => {
    const stack = makeStack();
    const dsql = new DsqlCluster(stack, "Dsql");
    dsql.grantRead(makeLambda(stack, "Fn"));
    Template.fromStack(stack).hasResourceProperties("AWS::SSM::Parameter", {
      Name: { "Fn::Join": ["", ["/beesolve/dsql/", { Ref: "Dsql" }, "/access-manifest"]] },
      Type: "String",
      Tier: "Standard",
    });
  });

  test("granting the same role twice is idempotent", () => {
    const stack = makeStack();
    const dsql = new DsqlCluster(stack, "Dsql");
    const fn = makeLambda(stack, "Fn");
    dsql.grantRead(fn);
    dsql.grantRead(fn);
    expect(resolvedManifest(stack, dsql).roles[0].principals).toHaveLength(1);
  });

  test("rejects a second database role for the same IAM principal", () => {
    const stack = makeStack();
    const dsql = new DsqlCluster(stack, "Dsql");
    const fn = makeLambda(stack, "Fn");
    dsql.grantRead(fn);
    expect(() => dsql.grantReadWrite(fn)).toThrow(/already granted DSQL role app_read/);
  });

  test("accepts an IAM role and does not need env vars", () => {
    const stack = makeStack();
    const dsql = new DsqlCluster(stack, "Dsql");
    const role = new Role(stack, "TaskRole", {
      assumedBy: new ServicePrincipal("ecs-tasks.amazonaws.com"),
    });
    dsql.grantRead(role);
    expect(resolvedManifest(stack, dsql).roles[0].principals).toHaveLength(1);
  });

  test("uses the role name prefix for built-in roles", () => {
    const stack = makeStack();
    const dsql = new DsqlCluster(stack, "Dsql", { roleNamePrefix: "expense_ease" });
    dsql.grantRead(makeLambda(stack, "Fn"));
    expect(resolvedManifest(stack, dsql).roles[0].name).toBe("expense_ease_read");
  });

  test("rejects a custom role that collides with a built-in role", () => {
    const stack = makeStack();
    const dsql = new DsqlCluster(stack, "Dsql", {
      roles: { app_read: { privileges: ["SELECT"], tables: ["users"] } },
    });
    expect(() => dsql.grantRead(makeLambda(stack, "Fn"))).toThrow(
      /collides with the built-in role/,
    );
  });

  test("validates role names, table names and privileges", () => {
    const stack = makeStack();
    expect(
      () => new DsqlCluster(stack, "A", { roles: { admin: { privileges: ["SELECT"] } } }),
    ).toThrow(/Invalid DSQL role name/);
    expect(
      () => new DsqlCluster(stack, "B", { roles: { "x; drop": { privileges: ["SELECT"] } } }),
    ).toThrow(/Invalid DSQL role name/);
    expect(
      () =>
        new DsqlCluster(stack, "C", {
          roles: { r: { privileges: ["SELECT"], tables: ['users"; --'] } },
        }),
    ).toThrow(/Invalid table name/);
    const truncate: DsqlRoleProps = JSON.parse('{ "privileges": ["TRUNCATE"] }');
    expect(() => new DsqlCluster(stack, "D", { roles: { r: truncate } })).toThrow(
      /unsupported privilege/,
    );
    expect(
      () => new DsqlCluster(stack, "E", { roles: { r: { privileges: ["SELECT"], tables: [] } } }),
    ).toThrow(/empty table list/);
  });

  test("grant only accepts declared role names", () => {
    const stack = makeStack();
    const dsql = new DsqlCluster(stack, "Dsql", {
      roles: { reporting: { privileges: ["SELECT"] } },
    });
    // @ts-expect-error "typo" is not a declared role
    expect(() => dsql.grant(makeLambda(stack, "Fn"), "typo")).toThrow(/not declared/);
  });
});
