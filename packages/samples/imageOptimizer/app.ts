import { App } from "aws-cdk-lib";

import { ImageOptimizerStack } from "./stack.ts";

const account = process.env.AWS_ACCOUNT ?? process.env.CDK_DEFAULT_ACCOUNT;
const region = process.env.AWS_REGION ?? process.env.CDK_DEFAULT_REGION;
const stackName = process.env.IMAGE_OPTIMIZER_STACK_NAME ?? "SamplesImageOptimizer";

if (account == null || region == null) {
  throw new Error("AWS_ACCOUNT and AWS_REGION (or the CDK defaults) must be set");
}

new ImageOptimizerStack(new App(), stackName, { env: { account, region } });
