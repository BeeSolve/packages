#!/usr/bin/env bun
import { rm } from "node:fs/promises";
import { join } from "node:path";

// Removes every package `dist` directory sequentially before bunup runs.
//
// bunup builds workspace packages concurrently. Its own per-package `clean`
// races against sibling builds and fails intermittently with
// `ENOENT: no such file or directory, open '.../dist/*.js'`. We disable
// bunup's `clean` in bunup.config.ts and perform a single, sequential clean
// here instead, which is race-free while still guaranteeing a fresh output.

const root = join(import.meta.dir, "..");

const packageDirs = [...new Bun.Glob("packages/*/package.json").scanSync(root)]
  .map((pkgJsonPath) => pkgJsonPath.replace("/package.json", ""))
  .sort();

for (const packageDir of packageDirs) {
  const distDir = join(root, packageDir, "dist");
  await rm(distDir, { recursive: true, force: true });
}
