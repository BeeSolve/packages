import { esmBuild } from "@beesolve/cdk-constructs";
import { rm } from "node:fs/promises";

const outDir = "./handler";

await rm(outDir, { force: true, recursive: true });
await esmBuild({
  entryPoints: [`./src/handler.ts`],
  outDir,
});
