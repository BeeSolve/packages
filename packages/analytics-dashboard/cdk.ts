import { fileURLToPath } from "node:url";

import type { AnalyticsProcessor } from "@beesolve/analytics-processor/cdk";
import type { AuthGateway } from "@beesolve/auth-service/cdk";
import { Nodejs24Function } from "@beesolve/cdk-constructs";
import { Emails } from "@beesolve/email-service/cdk";
import { Duration, Fn, RemovalPolicy } from "aws-cdk-lib";
import type { CfnDistribution, Distribution } from "aws-cdk-lib/aws-cloudfront";
import { HttpOrigin } from "aws-cdk-lib/aws-cloudfront-origins";
import { AttributeType, Billing, ProjectionType, TableV2 } from "aws-cdk-lib/aws-dynamodb";
import { Rule } from "aws-cdk-lib/aws-events";
import { LambdaFunction } from "aws-cdk-lib/aws-events-targets";
import { InvokeMode } from "aws-cdk-lib/aws-lambda";
import { Construct } from "constructs";
import { SvelteKit } from "kit-on-lambda/cdk";

export interface AnalyticsDashboardProps {
  readonly auth: AuthGateway;
  readonly processor: AnalyticsProcessor;
  readonly emailSender: {
    readonly name: string;
    readonly emailAddress: string;
  };
}

export class AnalyticsDashboard extends Construct {
  readonly distribution: Distribution;

  constructor(scope: Construct, id: string, props: AnalyticsDashboardProps) {
    super(scope, id);

    const dir = fileURLToPath(new URL(".", import.meta.url));
    const buildDirectory = `${dir}build`;

    const usersReverseIndexName = "reverse";
    const usersTable = new TableV2(this, "UsersTable", {
      partitionKey: { name: "pk", type: AttributeType.STRING },
      sortKey: { name: "sk", type: AttributeType.STRING },
      billing: Billing.onDemand(),
      removalPolicy: RemovalPolicy.RETAIN,
    });

    usersTable.addGlobalSecondaryIndex({
      indexName: usersReverseIndexName,
      partitionKey: { name: "sk", type: AttributeType.STRING },
      sortKey: { name: "pk", type: AttributeType.STRING },
      projectionType: ProjectionType.ALL,
    });

    const site = new SvelteKit(this, "Site", {
      runtime: "node",
      invokeMode: InvokeMode.BUFFERED,
      buildDirectory,
      toDefaultOrigin: ({ handler }) => {
        props.auth.addAuthorizedEndpoint({ lambda: handler, path: "/{proxy+}" });
        props.auth.grantSdkAccess(handler);
        props.processor.grantAccess(handler);

        usersTable.grantReadWriteData(handler);
        handler.addEnvironment("ANALYTICS_USERS_TABLE", usersTable.tableName);
        handler.addEnvironment("ANALYTICS_USERS_REVERSE_INDEX", usersReverseIndexName);

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
      description: "Analytics dashboard auth events consumer — sends OTP emails",
      entry: `${dir}authConsumer/`,
      handler: "authConsumer.handler",
      memorySize: 256,
      timeout: Duration.seconds(10),
    });

    emails.grantAccess(authConsumer);

    new Rule(this, "AuthEventsRule", {
      eventBus: props.auth.eventBus,
      eventPattern: {
        source: [props.auth.eventSource],
        detailType: ["EmailCodeAuth", "UnsuccessfulAuth"],
      },
      targets: [new LambdaFunction(authConsumer)],
    });

    this.distribution = site.distribution;
  }
}
