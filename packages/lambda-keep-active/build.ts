import { execSync } from "node:child_process";
import { rm } from "node:fs/promises";

import { esmBuild } from "@beesolve/cdk-constructs";

const root = new URL(".", import.meta.url).pathname;
const lambdaDir = `${root}dist-lambda`;
const distDir = `${root}dist`;

await rm(lambdaDir, { force: true, recursive: true });

const entry = "handler";

const outDir = `${lambdaDir}/${entry}`;
await esmBuild({ entryPoints: [`${root}${entry}.ts`], outDir });
const zipName = entry.includes("/") ? entry.split("/").pop() : entry;
if (zipName == null) throw Error(`Cannot parse zipName.`);
execSync(`zip -r ${distDir}/${zipName}.zip *`, { cwd: outDir });

await rm(lambdaDir, { force: true, recursive: true });
