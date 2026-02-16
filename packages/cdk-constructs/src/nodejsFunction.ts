import { Aspects, RemovalPolicy, Stack, Tags, type IAspect } from "aws-cdk-lib";
import {
  Architecture,
  Code,
  Function,
  LoggingFormat,
  Runtime,
} from "aws-cdk-lib/aws-lambda";
import { type NodejsFunctionProps } from "aws-cdk-lib/aws-lambda-nodejs";
import {
  LogGroup,
  RetentionDays,
  type LogGroupProps,
} from "aws-cdk-lib/aws-logs";
import type { Construct, IConstruct } from "constructs";
import { execSync } from "node:child_process";
import { resolve } from "node:path";
import { cwd } from "node:process";
import { esmBuildSync } from "./esbuildBuild";

export type Nodejs24FunctionProps = Omit<
  NodejsFunctionProps,
  | "runtime"
  | "architecture"
  | "logGroup"
  | "entry"
  | "handler"
  | "code"
  | "bundling"
  | "awsSdkConnectionReuse"
> & {
  readonly entry: `${string}.ts` | `${string}/`;
  readonly logGroupProps?: LogGroupProps;
  readonly loggingFormat?: LoggingFormat;
  readonly runtime?: typeof Runtime.NODEJS_24_X;
  readonly architecture?: typeof Architecture.ARM_64;
  readonly handler?: string;
};

/**
 * This construct provides easy way of deploying Node.js function with opinionated defaults.
 *
 * You need to provide `entry` - TypeScript file which exports `handler` function.
 * If your code is already built, you can provide directory ending with `/` as `entry` so the build step is skipped.
 *
 * By default, your code is built with esbuild in ESM format with provided CommonJS polyfills.
 * The code is minified for better performance and exteranl sourcemaps are provided.
 * All the libraries are bundled eg. the default aws-sdk from Nodejs runtime is not being used as it is slower and not always the latest version.
 *
 * @default
 *
 * {
 *    code: Code.fromAsset(esbuildOutputDirectory),
 *    handler: "filename.handler", // where filename is parsed from `entry`
 *    architecture: Architecture.ARM_64,
 *    runtime: Runtime.NODEJS_24_X,
 *    logGroup: new LogGroup(scope, `${id}LogGroup`, {
 *      retention: RetentionDays.TWO_WEEKS,
 *      removalPolicy: RemovalPolicy.DESTROY,
 *    }),
 *    loggingFormat = LoggingFormat.JSON,
 * }
 */
export class Nodejs24Function extends Function {
  constructor(scope: Construct, id: string, props: Nodejs24FunctionProps) {
    const {
      entry,
      handler,
      logGroupProps = {
        retention: RetentionDays.TWO_WEEKS,
        removalPolicy: RemovalPolicy.DESTROY,
      },
      loggingFormat = LoggingFormat.JSON,
      ...rest
    } = props;

    const shouldBuild = entry.endsWith(".ts");
    const outDir = shouldBuild
      ? resolve(`${cwd()}/cdk.out/beesolve-nodejs.bundling.${id}.${Date.now()}`)
      : entry;

    if (shouldBuild) {
      esmBuildSync({
        entryPoints: [props.entry],
        outDir,
      });
    }

    const fileName = shouldBuild
      ? entry.split("/").at(-1)?.replace(".ts", "")
      : "";
    const handlerName = `${fileName}.${handler ?? "handler"}`;

    super(scope, id, {
      ...rest,
      code: Code.fromAsset(outDir),
      architecture: Architecture.ARM_64,
      runtime: Runtime.NODEJS_24_X,
      handler: handlerName,
      logGroup: new LogGroup(scope, `${id}LogGroup`, logGroupProps),
      loggingFormat: loggingFormat,
    });
  }
}

/**
 * When function is being built the source maps are bundled without content for better performance.
 * It is good practice to tag resources with git revision for better debugging.
 *
 * You can use this helper function which tags all `Function` constructs within provided stack with `revision` tag.
 */
export function tagFunctionsWithRevision(
  stack: Stack,
  props: {
    /**
     * If current working directory does not contain git history the `NotAGitRepositoryError` is thrown.
     *
     * @default true
     */
    readonly enforceGit?: false;
  },
): void {
  const revision = getRevision(props.enforceGit ?? true);
  Aspects.of(stack).add(new TagFunctionsWithRevisionAspect({ revision }));
}

class TagFunctionsWithRevisionAspect implements IAspect {
  constructor(private readonly props: { readonly revision: string }) {}

  public visit(node: IConstruct): void {
    if (node instanceof Function) {
      Tags.of(node).add("revision", this.props.revision);
    }
  }
}

let revisionCache: string | undefined;
export function getRevision(enforceGit: boolean): string {
  if (revisionCache == null) {
    revisionCache = _getRevision();
  }

  return revisionCache;

  function _getRevision() {
    try {
      const buffer = execSync("git rev-parse --short HEAD");
      const shortCommitId = buffer.toString("utf-8").trim();

      return `${shortCommitId}${isDirty() ? " - dirty" : ""}`;
    } catch (error) {
      if (enforceGit) {
        throw new NotAGitRepositoryError();
      }
      return "cannot parse revision";
    }
  }

  function isDirty() {
    try {
      execSync("git diff --quiet && git diff --cached --quiet");
      return false;
    } catch (error) {
      return true;
    }
  }
}

class NotAGitRepositoryError extends Error {
  constructor() {
    super(`Cannot deploy without using git.`);
  }
}
