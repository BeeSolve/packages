import { defineWorkspace } from "bunup";

// https://bunup.dev/docs/guide/workspaces

export default defineWorkspace([
  {
    name: "@beesolve/dmarc-parser",
    root: "packages/dmarc-parser",
    config: {
      entry: ["index.ts"],
      dts: {
        inferTypes: true,
        tsgo: true,
      },
    },
  },
  {
    name: "@beesolve/dmarc-reports",
    root: "packages/dmarc-reports",
    config: {
      entry: ["index.ts", "cdk.ts"],
      dts: {
        inferTypes: true,
        tsgo: true,
      },
    },
  },
  {
    name: "@beesolve/dmarc-consumer",
    root: "packages/dmarc-consumer",
    config: {
      entry: [
        "report.ts",
        "domain.ts",
        "processingStats.ts",
        "ipInfo.ts",
        "backfill.ts",
        "sdk.ts",
        "cdk.ts",
      ],
      dts: {
        inferTypes: true,
        tsgo: true,
      },
    },
  },
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
      entry: [
        "api.ts",
        "cdk.ts",
        "sdk.ts",
        "sessionAuthorizer.ts",
        "index.ts",
        "events.ts",
        "sveltekit.ts",
      ],
      // tsconfig.dts.json excludes authorizer.ts and sdkHandler.ts (lambda-only
      // handlers not exported as modules). api.ts is included but its `handler`
      // export uses an explicit type annotation to avoid tsgo TS2883.
      preferredTsconfig: "./tsconfig.dts.json",
      // types inferred via tsgo because of complex types like valibot are exported
      // @see: https://bunup.dev/docs/guide/typescript-declarations.html#infer-types
      dts: {
        inferTypes: true,
        tsgo: true,
      },
    },
  },
  {
    name: "@beesolve/lambda-keep-active",
    root: "packages/lambda-keep-active",
    config: {
      entry: ["index.ts", "runtime.ts"],
      // dts: {
      //   inferTypes: true,
      //   tsgo: true,
      // },
    },
  },
  {
    name: "@beesolve/dmarc-dashboard",
    root: "packages/dmarc-dashboard",
    config: {
      entry: ["cdk.ts"],
      preferredTsconfig: "./tsconfig.cdk.json",
      dts: {
        inferTypes: true,
        tsgo: true,
      },
    },
  },
]);
