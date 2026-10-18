import { rm } from "node:fs/promises";

import { esmBuild } from "@beesolve/cdk-constructs";
import { build } from "esbuild";

const handlers = [
  { entry: "./hourly.ts", outDir: "./dist/hourly" },
  { entry: "./dailyRollup.ts", outDir: "./dist/dailyRollup" },
  { entry: "./monthlyRollup.ts", outDir: "./dist/monthlyRollup" },
  { entry: "./sdkHandler.ts", outDir: "./dist/sdkHandler" },
];

for (const handler of handlers) {
  await rm(handler.outDir, { force: true, recursive: true });
  await esmBuild({
    entryPoints: [handler.entry],
    outDir: handler.outDir,
  });
}

const commands = [
  { entry: "./command/backfill.ts", outDir: "./dist/command/backfill" },
  { entry: "./command/watch-backfill.ts", outDir: "./dist/command/watch-backfill" },
  { entry: "./command/compact.ts", outDir: "./dist/command/compact" },
];

for (const command of commands) {
  await rm(command.outDir, { force: true, recursive: true });
  await build({
    entryPoints: [command.entry],
    outdir: command.outDir,
    bundle: true,
    platform: "node",
    format: "esm",
    target: "node24",
    minify: true,
    sourcemap: "external",
    legalComments: "none",
    banner: {
      js: "#!/usr/bin/env node\nimport { fileURLToPath as __fileURLToPath } from 'node:url';import { createRequire as __createRequire } from 'node:module';const require = __createRequire(import.meta.url);const __filename = __fileURLToPath(import.meta.url);const __dirname = __fileURLToPath(new URL('.', import.meta.url));",
    },
    outExtension: { ".js": ".mjs" },
  });
}
