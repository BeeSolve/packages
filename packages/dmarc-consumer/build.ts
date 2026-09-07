import { rm } from "node:fs/promises";

import { esmBuild } from "@beesolve/cdk-constructs";

const consumerOutDir = "./dist/consumer";
const tasksOutDir = "./dist/tasks";
const dnsCronOutDir = "./dist/dnsCron";

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

await rm(dnsCronOutDir, { force: true, recursive: true });
await esmBuild({
  entryPoints: ["./src/dnsCron.ts"],
  outDir: dnsCronOutDir,
});
