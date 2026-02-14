import { build, buildSync, type BuildOptions, type Message } from "esbuild";

interface BuildProps {
  readonly entryPoints: string[];
  readonly outDir: string;
}

export async function esmBuild(props: BuildProps): Promise<void> {
  const buildResult = await build(toBuildConfig(props));
  if (buildResult.errors.length !== 0) {
    throw new BuildError(buildResult.errors);
  }
}

export function esmBuildSync(props: BuildProps): void {
  const buildResult = buildSync(toBuildConfig(props));
  if (buildResult.errors.length !== 0) {
    throw new BuildError(buildResult.errors);
  }
}

function toBuildConfig(props: BuildProps): BuildOptions {
  return {
    entryPoints: props.entryPoints,
    banner: {
      js: `/* CommonJS polyfills */import { fileURLToPath } from 'node:url';import { createRequire } from 'node:module';const __filename = fileURLToPath(import.meta.url);const __dirname = fileURLToPath(new URL('.', import.meta.url));const require = createRequire(import.meta.url);/* end of CommonJS polyfills */`,
    },
    charset: "utf8",
    bundle: true,
    external: [],
    format: "esm",
    keepNames: true,
    mainFields: ["module", "main"],
    minify: true,
    sourcemap: "external",
    target: "node24",
    platform: "node",
    resolveExtensions: [".ts", ".js", ".mjs", ".json"],
    legalComments: "none",
    splitting: true,
    treeShaking: true,
    outdir: props.outDir,
  };
}

export class BuildError extends Error {
  constructor(messages: Message[]) {
    super(
      `Couldn't build the code.\n\n${messages.map((message) => message.text).join("\n")}`,
    );
  }
}
