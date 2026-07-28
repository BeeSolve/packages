#!/usr/bin/env bun
import { join } from "path";

const ROOT = join(import.meta.dir, "..");

type PkgJson = {
  name: string;
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
  peerDependencies?: Record<string, string>;
};

const pkgJsonPaths = [...new Bun.Glob("packages/*/package.json").scanSync(ROOT)].sort(ascending);
const packageDirs = pkgJsonPaths.map((p) => p.replace("/package.json", ""));

const nameToDir = new Map<string, string>();
const packages: Array<{ dir: string; pkg: PkgJson }> = [];

for (const dir of packageDirs) {
  const pkg: PkgJson = await Bun.file(join(ROOT, dir, "package.json")).json();
  nameToDir.set(pkg.name, dir);
  packages.push({ dir, pkg });
}

const inDegree = new Map<string, number>(packageDirs.map((d) => [d, 0]));
const reverseDeps = new Map<string, Set<string>>(packageDirs.map((d) => [d, new Set()]));

for (const { dir, pkg } of packages) {
  const allDeps = Object.keys({
    ...pkg.dependencies,
    ...pkg.devDependencies,
    ...pkg.peerDependencies,
  });
  for (const depName of allDeps) {
    const depDir = nameToDir.get(depName);
    if (depDir && depDir !== dir) {
      inDegree.set(dir, (inDegree.get(dir) ?? 0) + 1);
      reverseDeps.get(depDir)?.add(dir);
    }
  }
}

const queue = packageDirs.filter((d) => inDegree.get(d) === 0).sort(ascending);
const result: Array<string> = [];

while (queue.length > 0) {
  queue.sort(ascending);
  const current = queue.shift();
  if (current == null) continue;
  result.push(current);

  for (const dependent of reverseDeps.get(current) ?? []) {
    const deg = (inDegree.get(dependent) ?? 0) - 1;
    inDegree.set(dependent, deg);
    if (deg === 0) queue.push(dependent);
  }
}

if (result.length !== packages.length) {
  const cyclic = packageDirs.filter((d) => !result.includes(d));
  throw new Error(`Circular dependency detected among: ${cyclic.join(", ")}`);
}

await Bun.write(join(ROOT, "dependencies.json"), JSON.stringify(result, null, 2) + "\n");
console.log("Updated dependencies.json:");
for (const dir of result) {
  console.log(`  ${dir}`);
}

function ascending(left: string, right: string) {
  return left.localeCompare(right);
}
