import { App } from "aws-cdk-lib";

import { CookieFunctionStack } from "./authCookieFunction/stack.ts";
import { EmailAuthorizerStack } from "./authEmailAuthorizer/stack.ts";
import { EmailSimpleStack } from "./authEmailSimple/stack.ts";
import { ImpersonationStack } from "./authImpersonation/stack.ts";
import { SpaWithApiStack } from "./authSpaWithApi/stack.ts";
import { AuthWithEmailStack } from "./authWithEmail/stack.ts";
import { AuthWithPasskeysStack } from "./authWithPasskeys/stack.ts";
import { DmarcReportsStack } from "./dmarcReports/stack.ts";
import { EmailVerifyStack } from "./emailVerify/stack.ts";

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

new AuthWithEmailStack(app, "SamplesAuthWithEmail", {
  env: { account, region },
});

new AuthWithPasskeysStack(app, "SamplesAuthWithPasskeys", {
  env: { account, region },
});

new EmailVerifyStack(app, "SamplesEmailVerify", {
  env: { account, region },
});

new CookieFunctionStack(app, "SamplesAuthCookieFunction", {
  env: { account, region },
});

new SpaWithApiStack(app, "SamplesAuthSpaWithApi", {
  env: { account, region },
});

new ImpersonationStack(app, "SamplesAuthImpersonation", {
  env: { account, region },
});

new DmarcReportsStack(app, "SamplesDmarcReports", {
  env: { account, region },
});
