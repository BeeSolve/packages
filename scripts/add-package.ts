#!/usr/bin/env bun
import { mkdir } from "fs/promises";
import { join } from "path";

import { $ } from "bun";

const ROOT = join(import.meta.dir, "..");

const name = process.argv[2];
if (!name) {
  console.error("Usage: bun scripts/add-package.ts <name>");
  process.exit(1);
}

if (!/^[a-z][a-z0-9-]*$/.test(name)) {
  console.error("Package name must be lowercase kebab-case (e.g. my-lib)");
  process.exit(1);
}

const pkgDir = join(ROOT, "packages", name);

if (await Bun.file(join(pkgDir, "package.json")).exists()) {
  console.error(`packages/${name} already exists`);
  process.exit(1);
}

await mkdir(pkgDir, { recursive: true });

await Bun.write(join(pkgDir, "index.ts"), "export {};\n");

await Bun.write(
  join(pkgDir, "tsconfig.json"),
  `{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": { "declaration": true, "isolatedDeclarations": true },
  "include": ["src/**/*", "index.ts"],
}\n`,
);

await Bun.write(
  join(pkgDir, "package.json"),
  JSON.stringify(
    {
      name: `@beesolve/${name}`,
      version: "0.1.0",
      license: "MIT",
      type: "module",
      files: ["dist"],
      repository: {
        type: "git",
        url: "git+https://github.com/BeeSolve/packages.git",
      },
      exports: {
        ".": {
          import: {
            types: "./dist/index.d.ts",
            default: "./dist/index.js",
          },
        },
        "./package.json": "./package.json",
      },
      scripts: {
        "type-check": "tsc --noEmit",
      },
    },
    null,
    2,
  ) + "\n",
);

console.log(`Created packages/${name}/`);

const bunupPath = join(ROOT, "bunup.config.ts");
const bunupContent = await Bun.file(bunupPath).text();
const newEntry = `  {
    name: "@beesolve/${name}",
    root: "packages/${name}",
    config: {
      entry: ["index.ts"],
    },
  },
`;
const updatedBunup = bunupContent.replace(/\]\);\s*$/, `${newEntry}]);\n`);
if (updatedBunup === bunupContent) {
  console.error("Could not update bunup.config.ts — closing ]); not found");
  process.exit(1);
}
await Bun.write(bunupPath, updatedBunup);
console.log("Updated bunup.config.ts");

await $`bun ${join(ROOT, "scripts/recalculate-dependencies.ts")}`;

console.log(`
Next steps:
  1. Add your exports to packages/${name}/index.ts
  2. Add @beesolve/* dependencies to packages/${name}/package.json and run: bun install
  3. Run: bun run recalculate-dependencies  (if you added @beesolve/* deps)
  4. Do the first manual publish:
       cd packages/${name}
       bun pm pack
       npm publish *.tgz --access public
       rm *.tgz
  5. Register OIDC Trusted Publisher:
       https://www.npmjs.com/package/@beesolve/${name}/access
       → Add Trusted Publisher → GitHub Actions
       Organization: BeeSolve  Repository: packages  Workflow: publish.yml
`);
