import { RemovalPolicy } from "aws-cdk-lib";
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
import type { Construct } from "constructs";
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
  /**
   * When function is being built the source maps are bundled without content for better performance.
   * You should provide revision which is added to the description automatically for easier debugging.
   *
   * You can use cached `getRevision()` function which is exported in this file in order to get git commit id.
   */
  readonly revision: string;
};

/**
 * This construct provides easy way of deploying Node.js function with opinionated defaults.
 *
 * You need to provide `entry` - TypeScript file which exports `handler` function.
 *
 * Entry file is being transpiled by `esbuild` to ESM format compatible with Node.js 24.
 *
 */
export class Nodejs24Function extends Function {
  constructor(scope: Construct, id: string, props: Nodejs24FunctionProps) {
    const {
      entry,
      handler,
      description = "",
      logGroupProps = {
        retention: RetentionDays.TWO_WEEKS,
        removalPolicy: RemovalPolicy.DESTROY,
      },
      loggingFormat = LoggingFormat.JSON,
      revision = true,
      ...rest
    } = props;

    const shouldBuild = entry.endsWith(".ts");

    const outDir = shouldBuild
      ? resolve(`${cwd()}/cdk.out/bundling.${id}.beesolve-nodejs.${Date.now()}`)
      : entry;

    if (shouldBuild) {
      esmBuildSync({
        entryPoints: [`${cwd()}/${props.entry}`],
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
      description: `${description} (${revision})`,
    });
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
