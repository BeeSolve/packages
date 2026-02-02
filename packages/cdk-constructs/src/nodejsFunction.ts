import { RemovalPolicy } from "aws-cdk-lib";
import { Architecture, LoggingFormat, Runtime } from "aws-cdk-lib/aws-lambda";
import {
  Charset,
  OutputFormat,
  SourceMapMode,
  type NodejsFunctionProps,
} from "aws-cdk-lib/aws-lambda-nodejs";
import {
  LogGroup,
  RetentionDays,
  type LogGroupProps,
} from "aws-cdk-lib/aws-logs";
import type { Construct } from "constructs";

export const nodejsFunctionDefaultConfig: {
  runtime: Pick<NodejsFunctionProps, "architecture" | "runtime">;
  bundling: NodejsFunctionProps["bundling"];
  logging: (
    scope: Construct,
    id: string,
    props?: LogGroupProps,
  ) => Pick<NodejsFunctionProps, "logFormat" | "logGroup">;
} = {
  runtime: {
    architecture: Architecture.ARM_64,
    runtime: Runtime.NODEJS_24_X,
  },
  bundling: {
    banner: `/* CommonJS polyfills */import { fileURLToPath } from 'node:url';import { createRequire } from 'node:module';const __filename = fileURLToPath(import.meta.url);const __dirname = fileURLToPath(new URL('.', import.meta.url));const require = createRequire(import.meta.url);/* end of CommonJS polyfills */`,
    charset: Charset.UTF8,
    bundleAwsSDK: true,
    externalModules: [],
    format: OutputFormat.ESM,
    keepNames: true,
    mainFields: ["module", "main"],
    minify: true,
    sourceMap: true,
    sourceMapMode: SourceMapMode.EXTERNAL,
    sourcesContent: false,
    target: "node24",
    esbuildArgs: {
      "--resolve-extensions": ".ts,.js,.mjs,.json",
      "--bundle": "",
      "--legal-comments": "none",
      "--splitting": "",
      "--tree-shaking": "true",
    },
  },
  logging: (scope, id, props) => ({
    logGroup: new LogGroup(scope, `${id}LogGroup`, {
      retention: RetentionDays.TWO_WEEKS,
      removalPolicy: RemovalPolicy.DESTROY,
      ...props,
    }),
    loggingFormat: LoggingFormat.JSON,
  }),
} as const;
