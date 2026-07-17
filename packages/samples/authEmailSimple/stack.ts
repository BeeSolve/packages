import { resolve } from "node:path";

import { AuthGateway } from "@beesolve/auth-service/cdk";
import { Nodejs24Function } from "@beesolve/cdk-constructs";
import { EmailAlarms } from "@beesolve/cdk-email-alarms";
import type { App, StackProps } from "aws-cdk-lib";
import { Duration, Fn, Stack } from "aws-cdk-lib";
import { HttpOrigin } from "aws-cdk-lib/aws-cloudfront-origins";
import { Rule } from "aws-cdk-lib/aws-events";
import { LambdaFunction } from "aws-cdk-lib/aws-events-targets";
import { InvokeMode } from "aws-cdk-lib/aws-lambda";
import { SvelteKit } from "kit-on-lambda/cdk";

export class EmailSimpleStack extends Stack {
  constructor(scope: App, id: string, props: StackProps) {
    super(scope, id, props);

    const emailAddress = process.env.SAMPLES_EMAIL_ADDRESS;
    const frontendUri = process.env.SAMPLES_AUTH_EMAIL_SIMPLE_FRONTEND_URI;

    if (emailAddress == null || frontendUri == null) {
      throw new Error(
        "SAMPLES_EMAIL_ADDRESS and SAMPLES_AUTH_EMAIL_SIMPLE_FRONTEND_URI must be set (see mise.toml)",
      );
    }

    const alarms = new EmailAlarms(this, "Alarms", {
      emailAddress,
    });

    const auth = new AuthGateway(this, "Auth", {
      stage: "dev",
      frontendUri,
      allowSignUp: true,
      alarms,
    });

    const site = new SvelteKit(this, "Site", {
      runtime: "node",
      invokeMode: InvokeMode.BUFFERED,
      buildDirectory: resolve(__dirname, "./site/build"),
      toDefaultOrigin: ({ handler }) => {
        auth.addPublicEndpoint({ lambda: handler });
        auth.grantSessionAccess(handler);
        auth.grantSdkAccess(handler);

        if (auth.api.url == null) throw Error(`Unexpected error - missing api url`);

        return new HttpOrigin(Fn.parseDomainName(auth.api.url));
      },
    });

    const authBehaviour = auth.createAuthBehavior(site.distribution);
    site.distribution.addBehavior("/auth/*", authBehaviour.origin, authBehaviour);

    const consumer = new Nodejs24Function(this, "Consumer", {
      entry: `${__dirname}/consumer.ts`,
      handler: "consumer.handler",
      memorySize: 256,
      timeout: Duration.seconds(10),
    });

    new Rule(this, "AuthEventsRule", {
      eventPattern: {
        source: ["beesolve.auth.api"],
        detailType: ["EmailCodeAuth", "UnsuccessfulAuth"],
      },
      targets: [new LambdaFunction(consumer)],
    });
  }
}
