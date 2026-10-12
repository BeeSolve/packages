import { rm } from "node:fs/promises";

import { esmBuild } from "@beesolve/cdk-constructs";

const outDir = "./dist/authConsumer";

await rm(outDir, { force: true, recursive: true });
await esmBuild({
  entryPoints: ["./src/authConsumer.ts"],
  outDir,
});
