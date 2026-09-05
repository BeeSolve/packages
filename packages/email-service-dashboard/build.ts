import { rm } from "node:fs/promises";

import { esmBuild } from "@beesolve/cdk-constructs";

const authConsumerOutDir = "./dist/authConsumer";

await rm(authConsumerOutDir, { force: true, recursive: true });
await esmBuild({
  entryPoints: ["./src/authConsumer.ts"],
  outDir: authConsumerOutDir,
});

const eventConsumerOutDir = "./dist/eventConsumer";

await rm(eventConsumerOutDir, { force: true, recursive: true });
await esmBuild({
  entryPoints: ["./src/eventConsumer.ts"],
  outDir: eventConsumerOutDir,
});
