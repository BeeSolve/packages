import { resolve } from "node:path";

import { AuthGateway } from "@beesolve/auth-service/cdk";
import { Nodejs24Function } from "@beesolve/cdk-constructs";
import type { App, StackProps } from "aws-cdk-lib";
import { Duration, Fn, RemovalPolicy, Stack } from "aws-cdk-lib";
import type { CfnDistribution } from "aws-cdk-lib/aws-cloudfront";
import { HttpOrigin } from "aws-cdk-lib/aws-cloudfront-origins";
import { AttributeType, BillingMode, ProjectionType, Table } from "aws-cdk-lib/aws-dynamodb";
import { Rule } from "aws-cdk-lib/aws-events";
import { LambdaFunction } from "aws-cdk-lib/aws-events-targets";
import { InvokeMode } from "aws-cdk-lib/aws-lambda";
import { SvelteKit } from "kit-on-lambda/cdk";

const reverseIndexName = "reverse";

/**
 * Demonstrates operator-less session impersonation with @beesolve/auth-service.
 *
 * The frontend is a SvelteKit app served via kit-on-lambda (SSR Lambda behind
 * CloudFront), authorized by the session authorizer. The sample owns its own
 * DynamoDB user-directory table so it can enumerate impersonatable accounts —
 * auth-service authenticates identities but does not enumerate them.
 *
 * Key concepts:
 * - App-owned user directory (single-table: pk `user#<email>`, sk `user`) with a
 *   reverse GSI keyed on `sk` for listing all users, injected into the SSR handler
 * - `impersonate` SDK command mutates the impersonator's own session in place;
 *   `grantSdkAccess` injects the SDK handler ARN so the SSR handler can invoke it
 * - The session authorizer exposes `impersonating` / `impersonatedBy` so the app
 *   can project the effective identity
 * - `POST /auth/endImpersonation` (handled by the auth service) stops impersonation
 * - An EventBridge consumer audits `ImpersonationStarted` / `ImpersonationEnded`
 * - No email delivery — uses dev code (000000)
 */
export class ImpersonationStack extends Stack {
  constructor(scope: App, id: string, props: StackProps) {
    super(scope, id, props);

    const frontendUri = process.env.SAMPLES_AUTH_IMPERSONATION_FRONTEND_URI;

    if (frontendUri == null) {
      throw new Error("SAMPLES_AUTH_IMPERSONATION_FRONTEND_URI must be set (see mise.toml)");
    }

    const auth = new AuthGateway(this, "Auth", {
      stage: "dev",
      frontendUri,
      allowSignUp: true,
      authorizerCache: "disabled",
    });

    const table = new Table(this, "Users", {
      partitionKey: { name: "pk", type: AttributeType.STRING },
      sortKey: { name: "sk", type: AttributeType.STRING },
      billingMode: BillingMode.PAY_PER_REQUEST,
      removalPolicy: RemovalPolicy.DESTROY,
    });

    table.addGlobalSecondaryIndex({
      indexName: reverseIndexName,
      partitionKey: { name: "sk", type: AttributeType.STRING },
      sortKey: { name: "pk", type: AttributeType.STRING },
      projectionType: ProjectionType.ALL,
    });

    const site = new SvelteKit(this, "Site", {
      runtime: "node",
      invokeMode: InvokeMode.BUFFERED,
      buildDirectory: resolve(__dirname, "./site/build"),
      toDefaultOrigin: ({ handler }) => {
        auth.addAuthorizedEndpoint({ lambda: handler, path: "/{proxy+}" });
        auth.grantSdkAccess(handler);
        table.grantReadWriteData(handler);
        handler.addEnvironment("SAMPLE_USERS_TABLE_NAME", table.tableName);
        handler.addEnvironment("SAMPLE_USERS_REVERSE_INDEX", reverseIndexName);

        if (auth.api.url == null) throw Error(`Unexpected error - missing api url`);
        return new HttpOrigin(Fn.parseDomainName(auth.api.url));
      },
    });

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
        detailType: ["ImpersonationStarted", "ImpersonationEnded"],
      },
      targets: [new LambdaFunction(consumer)],
    });
  }
}
