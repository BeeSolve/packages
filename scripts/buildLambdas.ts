#!/usr/bin/env bun
import { join } from "node:path";

const root = join(import.meta.dir, "..");

interface PkgJson {
  name: string;
  scripts?: Record<string, string>;
}

const pkgJsonPaths = [...new Bun.Glob("packages/*/package.json").scanSync(root)].sort();

for (const pkgJsonPath of pkgJsonPaths) {
  const pkg: PkgJson = await Bun.file(join(root, pkgJsonPath)).json();

  if (pkg.scripts?.prepublishOnly == null) continue;

  const dir = join(root, pkgJsonPath.replace("/package.json", ""));
  console.log(`Building lambdas: ${pkg.name}`);

  const result = Bun.spawnSync(["bun", "run", "prepublishOnly"], {
    cwd: dir,
    stdio: ["inherit", "inherit", "inherit"],
  });

  if (result.exitCode !== 0) {
    throw new Error(`Lambda build failed for ${pkg.name}`);
  }
}
