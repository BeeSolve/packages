import { fileURLToPath } from "node:url";

import type { AuthGateway } from "@beesolve/auth-service/cdk";
import { Nodejs24Function } from "@beesolve/cdk-constructs";
import type { DmarcConsumer } from "@beesolve/dmarc-consumer/cdk";
import { Emails } from "@beesolve/email-service/cdk";
import { Duration, Fn } from "aws-cdk-lib";
import type { CfnDistribution, Distribution } from "aws-cdk-lib/aws-cloudfront";
import { HttpOrigin } from "aws-cdk-lib/aws-cloudfront-origins";
import { Rule } from "aws-cdk-lib/aws-events";
import { LambdaFunction } from "aws-cdk-lib/aws-events-targets";
import { InvokeMode } from "aws-cdk-lib/aws-lambda";
import { Construct } from "constructs";
import { SvelteKit } from "kit-on-lambda/cdk";

export interface DmarcDashboardProps {
  readonly auth: AuthGateway;
  readonly consumer: DmarcConsumer;
  readonly emailSender: {
    readonly name: string;
    readonly emailAddress: string;
  };
}

export class DmarcDashboard extends Construct {
  readonly distribution: Distribution;

  constructor(scope: Construct, id: string, props: DmarcDashboardProps) {
    super(scope, id);

    const dir = fileURLToPath(new URL(".", import.meta.url));
    const buildDirectory = `${dir}build`;

    const site = new SvelteKit(this, "Site", {
      runtime: "node",
      invokeMode: InvokeMode.BUFFERED,
      buildDirectory,
      toDefaultOrigin: ({ handler }) => {
        props.auth.addAuthorizedEndpoint({ lambda: handler, path: "/{proxy+}" });
        props.auth.grantSdkAccess(handler);
        props.consumer.grantReadWrite(handler);

        if (props.auth.api.url == null) throw new Error("Unexpected error - missing api url");
        return new HttpOrigin(Fn.parseDomainName(props.auth.api.url));
      },
    });

    // oxlint-disable-next-line typescript/no-unsafe-type-assertion
    const cfnDist = site.distribution.node.defaultChild as CfnDistribution;
    cfnDist.addPropertyOverride("DistributionConfig.DefaultCacheBehavior.FunctionAssociations", [
      {
        EventType: "viewer-request",
        FunctionARN: props.auth.ensureCookieFunction.functionArn,
      },
    ]);

    const authBehaviour = props.auth.createAuthBehavior(site.distribution);
    site.distribution.addBehavior("/auth/*", authBehaviour.origin, authBehaviour);

    const emails = new Emails(this, "Emails", {
      defaultSender: props.emailSender,
    });

    emails.grantAccess(site.handler);

    const authConsumer = new Nodejs24Function(this, "AuthConsumer", {
      description: "DMARC dashboard auth events consumer — sends OTP emails",
      entry: `${dir}authConsumer/`,
      handler: "authConsumer.handler",
      memorySize: 256,
      timeout: Duration.seconds(10),
    });

    emails.grantAccess(authConsumer);

    new Rule(this, "AuthEventsRule", {
      eventPattern: {
        source: ["beesolve.auth.api"],
        detailType: ["EmailCodeAuth", "UnsuccessfulAuth"],
      },
      targets: [new LambdaFunction(authConsumer)],
    });

    this.distribution = site.distribution;
  }
}
