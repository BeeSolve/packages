import { resolve } from "node:path";

import { ActionTokens } from "@beesolve/action-tokens/cdk";
import { Emails } from "@beesolve/email-service/cdk";
import type { App, StackProps } from "aws-cdk-lib";
import { RemovalPolicy, Stack } from "aws-cdk-lib";
import { SvelteKit } from "kit-on-lambda/cdk";

export class EmailVerifyStack extends Stack {
  constructor(scope: App, id: string, props: StackProps) {
    super(scope, id, props);

    const recipientEmail = process.env.SAMPLES_EMAIL_VERIFY_RECIPIENT_EMAIL;

    if (recipientEmail == null) {
      throw new Error("SAMPLES_EMAIL_VERIFY_RECIPIENT_EMAIL must be set (see mise.toml)");
    }

    const actionTokens = new ActionTokens(this, "ActionTokens", {
      removalPolicy: RemovalPolicy.DESTROY,
      deletionProtection: false,
    });

    const emails = new Emails(this, "Emails", {
      defaultSender: {
        name: "Email Verify Sample",
        emailAddress: "no-reply@dev.beesolve.com",
      },
      removalPolicy: RemovalPolicy.DESTROY,
      deletionProtection: false,
    });

    const site = new SvelteKit(this, "Site", {
      runtime: "node",
      buildDirectory: resolve(__dirname, "./site/build"),
    });

    site.handler.addEnvironment("RECIPIENT_EMAIL", recipientEmail);
    site.handler.addEnvironment("OTP_EXPIRY_SECONDS", "600");
    site.handler.addEnvironment("THROTTLE_WINDOW_SECONDS", "60");

    actionTokens.grantAccess(site.handler);
    emails.grantAccess(site.handler);
  }
}
