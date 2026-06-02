import { esmBuild } from "@beesolve/cdk-constructs";
import { execSync } from "node:child_process";
import { rm } from "node:fs/promises";

const root = new URL(".", import.meta.url).pathname;
const lambdaDir = `${root}dist-lambda`;
const distDir = `${root}dist`;

await rm(lambdaDir, { force: true, recursive: true });

for (const entry of [
  "api",
  "authorizer",
  "sdkHandler",
  "tasks",
  "src/edgeBodyHash",
] as const) {
  const outDir = `${lambdaDir}/${entry}`;
  await esmBuild({ entryPoints: [`${root}${entry}.ts`], outDir });
  const zipName = entry.includes("/") ? entry.split("/").pop()! : entry;
  execSync(`zip -r ${distDir}/${zipName}.zip *`, { cwd: outDir });
}

await rm(lambdaDir, { force: true, recursive: true });
