import { mkdir, rm } from "node:fs/promises";
import { join } from "node:path";

import { build } from "esbuild";

export const cloudFrontFunctionMaxBytes = 10 * 1024;

const packageRoot = import.meta.dir;

const cloudFrontFunctionSyntax = {
  arrow: true,
  "const-and-let": true,
  "template-literal": true,
  "rest-argument": true,
  "exponent-operator": true,
  destructuring: false,
  "for-of": false,
  "array-spread": false,
  "object-rest-spread": false,
  "object-extensions": false,
  "default-argument": false,
  "optional-catch-binding": false,
  "nullish-coalescing": false,
  "optional-chain": false,
  "logical-assignment": false,
  class: false,
  generator: false,
  "async-generator": false,
  "for-await": false,
  bigint: false,
  "top-level-await": false,
  "dynamic-import": false,
  "import-meta": false,
  "new-target": false,
};

if (import.meta.main) {
  await buildAll();
}

/**
 * Bundles the viewer-request function into one script without imports and exports.
 * CloudFront Functions (JavaScript runtime 2.0) have no module system and support only ES5.1
 * plus a few ES6+ features, so esbuild lowers everything else (destructuring, `for...of`,
 * spread, shorthand properties, optional catch binding, `?.`, `??`, default parameters).
 * esbuild fails the build for syntax it cannot lower.
 */
export async function buildEdgeFunction(): Promise<string> {
  const result = await build({
    entryPoints: [join(packageRoot, "src/edge.ts")],
    bundle: true,
    write: false,
    platform: "neutral",
    format: "esm",
    target: "es2022",
    supported: cloudFrontFunctionSyntax,
    legalComments: "none",
    minifyWhitespace: false,
    minifySyntax: false,
    minifyIdentifiers: false,
    charset: "ascii",
  });
  const [output] = result.outputFiles;
  if (output == null) throw new Error("Edge function bundle has no output");

  return output.text
    .replace(/^\s*export\s*\{[^}]*\};?\s*$/gm, "")
    .replace(/\n{2,}/g, "\n")
    .trim()
    .concat("\n");
}

export async function buildAll(): Promise<void> {
  const edgeDir = join(packageRoot, "dist/edge");
  await rm(edgeDir, { force: true, recursive: true });
  await mkdir(edgeDir, { recursive: true });
  const edge = await buildEdgeFunction();
  if (edge.length > cloudFrontFunctionMaxBytes) {
    throw new Error(
      `Edge function is ${edge.length} bytes, CloudFront allows ${cloudFrontFunctionMaxBytes}`,
    );
  }
  await Bun.write(join(edgeDir, "function.js"), edge);
  console.log(`dist/edge/function.js ${edge.length} bytes`);

  const handlerDir = join(packageRoot, "dist/handler");
  await rm(handlerDir, { force: true, recursive: true });
  const handler = await Bun.build({
    entrypoints: [join(packageRoot, "src/handler.ts")],
    outdir: handlerDir,
    target: "bun",
    format: "esm",
    minify: true,
  });
  if (!handler.success)
    throw new Error(`Handler bundle failed: ${handler.logs.map((log) => log.message).join("\n")}`);
  console.log(`dist/handler/handler.js ${handler.outputs[0]?.size ?? 0} bytes`);
}
