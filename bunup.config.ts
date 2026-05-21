import { defineWorkspace } from "bunup";

// https://bunup.dev/docs/guide/workspaces

export default defineWorkspace([
  {
    name: "@beesolve/helpers",
    root: "packages/helpers",
    config: {
      entry: ["index.ts", "bun.ts"],
    },
  },
  {
    name: "@beesolve/cdk-constructs",
    root: "packages/cdk-constructs",
    config: {
      entry: ["index.ts"],
    },
  },
  {
    name: "@beesolve/cdk-email-alarms",
    root: "packages/cdk-email-alarms",
    config: {
      entry: ["index.ts"],
    },
  },
  {
    name: "@beesolve/email-service",
    root: "packages/service-email",
    config: {
      entry: ["cdk.ts", "sdk.ts", "templating.ts", "events.ts"],
      // types inferred via tsgo because of complex types like valibot are exported
      // @see: https://bunup.dev/docs/guide/typescript-declarations.html#infer-types
      dts: {
        inferTypes: true,
        tsgo: true,
      },
    },
  },
  {
    name: "@beesolve/sqs-handler",
    root: "packages/sqs-handler",
    config: {
      entry: ["index.ts", "cdk.ts"],
    },
  },
  {
    name: "@beesolve/lambda-fetch-api",
    root: "packages/lambda-fetch-api",
    config: {
      entry: ["index.ts"],
    },
  },
  {
    name: "@beesolve/action-tokens",
    root: "packages/action-tokens",
    config: {
      entry: ["cdk.ts", "sdk.ts", "model.ts"],
      dts: {
        inferTypes: true,
        tsgo: true,
      },
    },
  },
  {
    name: "@beesolve/auth-service",
    root: "packages/service-auth",
    config: {
      entry: ["cdk.ts", "sdk.ts", "index.ts", "events.ts"],
    },
  },
]);
