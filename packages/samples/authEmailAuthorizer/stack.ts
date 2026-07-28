import { resolve } from "node:path";

import { AuthGateway } from "@beesolve/auth-service/cdk";
import { Nodejs24Function } from "@beesolve/cdk-constructs";
import { EmailAlarms } from "@beesolve/cdk-email-alarms";
import type { App, StackProps } from "aws-cdk-lib";
import { Duration, Fn, Stack } from "aws-cdk-lib";
import type { CfnDistribution } from "aws-cdk-lib/aws-cloudfront";
import { HttpOrigin } from "aws-cdk-lib/aws-cloudfront-origins";
import { Rule } from "aws-cdk-lib/aws-events";
import { LambdaFunction } from "aws-cdk-lib/aws-events-targets";
import { InvokeMode } from "aws-cdk-lib/aws-lambda";
import { SvelteKit } from "kit-on-lambda/cdk";

export class EmailAuthorizerStack extends Stack {
  constructor(scope: App, id: string, props: StackProps) {
    super(scope, id, props);

    const emailAddress = process.env.SAMPLES_EMAIL_ADDRESS;
    const frontendUri = process.env.SAMPLES_AUTH_EMAIL_AUTHORIZER_FRONTEND_URI;

    if (emailAddress == null || frontendUri == null) {
      throw new Error(
        "SAMPLES_EMAIL_ADDRESS and SAMPLES_AUTH_EMAIL_AUTHORIZER_FRONTEND_URI must be set (see mise.toml)",
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
        auth.addAuthorizedEndpoint({ lambda: handler, path: "/{proxy+}" });
        auth.grantSdkAccess(handler);

        if (auth.api.url == null) throw Error(`Unexpected error - missing api url`);
        return new HttpOrigin(Fn.parseDomainName(auth.api.url));
      },
    });

    // Attach ensureCookieFunction to the default behavior via L1 escape hatch.
    // kit-on-lambda manages the default behavior internally, so we add the
    // function association on the underlying CfnDistribution.
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion
    const cfnDist = site.distribution.node.defaultChild as CfnDistribution;
    cfnDist.addPropertyOverride("DistributionConfig.DefaultCacheBehavior.FunctionAssociations", [
      {
        EventType: "viewer-request",
        FunctionARN: auth.ensureCookieFunction.functionArn,
      },
    ]);

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
