#!/usr/bin/env bun
import { join } from "path";

import { $ } from "bun";

const ROOT = join(import.meta.dir, "..");

const PACKAGES: string[] = await Bun.file(join(ROOT, "dependencies.json")).json();

type Pkg = { name: string; version: string; scripts?: Record<string, string> };

async function readPkg(dir: string): Promise<Pkg> {
  return Bun.file(join(ROOT, dir, "package.json")).json();
}

async function isPublished(name: string, version: string): Promise<boolean> {
  const result = await $`npm view ${name}@${version} version`.quiet().nothrow();
  return result.exitCode === 0;
}

for (const pkgDir of PACKAGES) {
  const absDir = join(ROOT, pkgDir);
  const pkg = await readPkg(pkgDir);

  if (await isPublished(pkg.name, pkg.version)) {
    console.log(`  skip ${pkg.name}@${pkg.version} (already on npm)`);
    continue;
  }

  console.log(`  publishing ${pkg.name}@${pkg.version}`);

  // Run prepublishOnly manually (bun pm pack does not trigger it)
  if (pkg.scripts?.prepublishOnly) {
    await $`bun run prepublishOnly`.cwd(absDir);
  }

  // Pack with bun — resolves workspace:^ and catalog: references
  await $`bun pm pack`.cwd(absDir);

  // Find the generated tarball
  const [tarball] = [...new Bun.Glob("*.tgz").scanSync(absDir)];
  if (!tarball) throw new Error(`No tarball found in ${pkgDir}`);

  // Publish via npm CLI — triggers OIDC Trusted Publishers auth
  await $`npm publish ${tarball} --access public`.cwd(absDir);

  await $`rm ${tarball}`.cwd(absDir);
}
