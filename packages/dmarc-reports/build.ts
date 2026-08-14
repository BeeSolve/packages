import { rm } from "node:fs/promises";

import { esmBuild } from "@beesolve/cdk-constructs";

const outDir = "./dist/handler";

await rm(outDir, { force: true, recursive: true });
await esmBuild({
  entryPoints: ["./src/handler.ts"],
  outDir,
});
