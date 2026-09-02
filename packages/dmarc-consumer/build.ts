import { rm } from "node:fs/promises";

import { esmBuild } from "@beesolve/cdk-constructs";

const consumerOutDir = "./dist/consumer";
const tasksOutDir = "./dist/tasks";

await rm(consumerOutDir, { force: true, recursive: true });
await esmBuild({
  entryPoints: ["./src/consumer.ts"],
  outDir: consumerOutDir,
});

await rm(tasksOutDir, { force: true, recursive: true });
await esmBuild({
  entryPoints: ["./src/tasks.ts"],
  outDir: tasksOutDir,
});
