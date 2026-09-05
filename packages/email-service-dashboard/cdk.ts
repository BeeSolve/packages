import { fileURLToPath } from "node:url";

import type { AuthGateway } from "@beesolve/auth-service/cdk";
import { Nodejs24Function, SqsWithDlq } from "@beesolve/cdk-constructs";
import { Emails } from "@beesolve/email-service/cdk";
import { Duration, Fn, type RemovalPolicy } from "aws-cdk-lib";
import type { CfnDistribution, Distribution } from "aws-cdk-lib/aws-cloudfront";
import { HttpOrigin } from "aws-cdk-lib/aws-cloudfront-origins";
import { AttributeType, Billing, ProjectionType, TableV2 } from "aws-cdk-lib/aws-dynamodb";
import { Rule } from "aws-cdk-lib/aws-events";
import { LambdaFunction, SqsQueue } from "aws-cdk-lib/aws-events-targets";
import { InvokeMode } from "aws-cdk-lib/aws-lambda";
import { Construct } from "constructs";
import { SvelteKit } from "kit-on-lambda/cdk";

export interface EmailServiceDashboardProps {
  readonly auth: AuthGateway;
  readonly emailSender: {
    readonly name: string;
    readonly emailAddress: string;
  };
  /** @default "default" */
  readonly eventBusName?: string;
  readonly isProd?: boolean;
  readonly removalPolicy?: RemovalPolicy;
}

export class EmailServiceDashboard extends Construct {
  readonly distribution: Distribution;

  constructor(scope: Construct, id: string, props: EmailServiceDashboardProps) {
    super(scope, id);

    const dir = fileURLToPath(new URL(".", import.meta.url));
    const buildDirectory = `${dir}build`;

    const reverseIndexName = "reverse";

    const table = new TableV2(this, "Table", {
      partitionKey: { name: "pk", type: AttributeType.STRING },
      sortKey: { name: "sk", type: AttributeType.STRING },
      billing: Billing.onDemand(),
      timeToLiveAttribute: "ttl",
      pointInTimeRecoverySpecification:
        props.isProd === true ? { pointInTimeRecoveryEnabled: true } : undefined,
      removalPolicy: props.removalPolicy,
    });

    table.addGlobalSecondaryIndex({
      indexName: reverseIndexName,
      partitionKey: { name: "sk", type: AttributeType.STRING },
      sortKey: { name: "pk", type: AttributeType.STRING },
      projectionType: ProjectionType.INCLUDE,
      nonKeyAttributes: [
        "received",
        "sent",
        "delivered",
        "bounced",
        "complained",
        "rejected",
        "failed",
      ],
    });

    const site = new SvelteKit(this, "Site", {
      runtime: "node",
      invokeMode: InvokeMode.BUFFERED,
      buildDirectory,
      toDefaultOrigin: ({ handler }) => {
        props.auth.addAuthorizedEndpoint({ lambda: handler, path: "/{proxy+}" });
        props.auth.grantSdkAccess(handler);
        table.grantReadWriteData(handler);
        handler.addEnvironment("DASHBOARD_TABLE_NAME", table.tableName);
        handler.addEnvironment("DASHBOARD_REVERSE_INDEX", reverseIndexName);

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
      eventBusName: props.eventBusName,
    });

    emails.grantAccess(site.handler);

    const authConsumer = new Nodejs24Function(this, "AuthConsumer", {
      description: "Email service dashboard auth events consumer — sends OTP emails",
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

    const eventConsumer = new Nodejs24Function(this, "EventConsumer", {
      description: "Email service dashboard email events consumer — persists delivery status",
      entry: `${dir}eventConsumer/`,
      handler: "eventConsumer.handler",
      memorySize: 256,
      timeout: Duration.seconds(30),
    });

    table.grantReadWriteData(eventConsumer);
    eventConsumer.addEnvironment("DASHBOARD_TABLE_NAME", table.tableName);
    eventConsumer.addEnvironment("DASHBOARD_REVERSE_INDEX", reverseIndexName);

    const { queue } = SqsWithDlq.asLambdaInput({ lambda: eventConsumer });

    new Rule(this, "EmailEventsRule", {
      eventPattern: {
        source: ["beesolve.email.api", "aws.ses"],
      },
      targets: [new SqsQueue(queue)],
    });

    this.distribution = site.distribution;
  }
}
