#!/usr/bin/env bun
/**
 * Setup script for @beesolve/lint-config.
 * Generates oxfmt, oxlint, nano-staged configs and husky pre-commit hook.
 *
 * Usage:
 *   bunx @beesolve/lint-config setup --type package --internal "@beesolve/*"
 *   bunx @beesolve/lint-config setup --type monorepo --internal "@app/*"
 *   bunx @beesolve/lint-config setup --type sveltekit --internal "@app/*"
 */

import { join } from "node:path";
import { parseArgs } from "node:util";

const { values } = parseArgs({
  args: Bun.argv.slice(2),
  options: {
    type: { type: "string", default: "package" },
    internal: { type: "string", default: "@beesolve/*" },
  },
  strict: false,
});

const projectType = values.type ?? "package";
if (projectType !== "package" && projectType !== "monorepo" && projectType !== "sveltekit") {
  throw new Error(`Invalid type: ${projectType}. Must be "package", "monorepo", or "sveltekit".`);
}
const internalPattern = values.internal ?? "@beesolve/*";
const cwd = process.cwd();

const oxfmtConfig = {
  trailingComma: "all",
  semi: true,
  singleQuote: false,
  tabWidth: 2,
  printWidth: 100,
  arrowParens: "always",
  sortImports: {
    groups: ["builtin", "external", ["internal", "subpath"], ["parent", "sibling", "index"]],
    internalPattern: [internalPattern],
    newlinesBetween: true,
    ignoreCase: true,
  },
  sortPackageJson: true,
};

const oxlintConfig = {
  extends: [`./node_modules/@beesolve/lint-config/presets/${projectType}.oxlintrc.json`],
};

const nanoStagedConfig = {
  "*": "oxfmt --no-error-on-unmatched-pattern",
  "**/*.{js,ts,jsx,tsx}": "oxlint",
};

async function writeJson(props: { filename: string; data: unknown }) {
  const path = join(cwd, props.filename);
  await Bun.write(path, JSON.stringify(props.data, null, 2) + "\n");
  console.log(`  ✓ ${props.filename}`);
}

console.log(`\n@beesolve/lint-config setup (type: ${projectType}, internal: ${internalPattern})\n`);

await writeJson({ filename: ".oxfmtrc.json", data: oxfmtConfig });
await writeJson({ filename: ".oxlintrc.json", data: oxlintConfig });
await writeJson({ filename: ".nano-staged.json", data: nanoStagedConfig });

// Husky pre-commit
const huskyDir = join(cwd, ".husky");
await Bun.write(join(huskyDir, "pre-commit"), "./node_modules/.bin/nano-staged\n");
console.log("  ✓ .husky/pre-commit");

console.log(`
Done! Next steps:
  1. bun add -D oxlint oxfmt nano-staged husky @beesolve/lint-config
  2. Add to package.json scripts:
     "lint": "oxlint .",
     "fmt": "oxfmt",
     "fmt:check": "oxfmt --check",
     "check": "oxfmt --check && oxlint .",
     "prepare": "husky"
  3. Run: bun run fmt
`);
