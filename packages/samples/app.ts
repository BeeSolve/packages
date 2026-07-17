import { App } from "aws-cdk-lib";

import { EmailAuthorizerStack } from "./authEmailAuthorizer/stack.ts";
import { EmailSimpleStack } from "./authEmailSimple/stack.ts";

const account = process.env.AWS_ACCOUNT;
const region = process.env.AWS_REGION;

if (account == null || region == null) {
  throw new Error("AWS_ACCOUNT and AWS_REGION must be set (see mise.toml)");
}

const app = new App();

new EmailSimpleStack(app, "SamplesAuthEmailSimple", {
  env: { account, region },
});

new EmailAuthorizerStack(app, "SamplesAuthEmailAuthorizer", {
  env: { account, region },
});
