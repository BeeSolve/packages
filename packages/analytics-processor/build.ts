import { rm } from "node:fs/promises";

import { esmBuild } from "@beesolve/cdk-constructs";

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
