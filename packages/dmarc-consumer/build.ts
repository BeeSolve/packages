import { rm } from "node:fs/promises";

import { esmBuild } from "@beesolve/cdk-constructs";

const outDir = "./dist/consumer";

await rm(outDir, { force: true, recursive: true });
await esmBuild({
  entryPoints: ["./src/consumer.ts"],
  outDir,
});
