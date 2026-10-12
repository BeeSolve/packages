import { describe, expect, test } from "bun:test";

import { AnalyticsProcessor } from "@beesolve/analytics-processor/cdk";
import { AuthGateway } from "@beesolve/auth-service/cdk";
import { App, Stack } from "aws-cdk-lib";
import { Match, Template } from "aws-cdk-lib/assertions";

import { AnalyticsDashboard } from "../dist/cdk.js";

function makeTemplate(): Template {
  const app = new App();
  const stack = new Stack(app, "TestStack", {
    env: { account: "123456789012", region: "eu-central-1" },
  });

  const auth = new AuthGateway(stack, "Auth", {
    stage: "dev",
    frontendUri: "https://placeholder.cloudfront.net",
    allowSignUp: false,
    authorizerCache: "disabled",
  });

  const processor = new AnalyticsProcessor(stack, "Processor", {
    athenaDatabase: "cf_logs_db",
    athenaV2Table: "cf_logs_v2_table",
    athenaWorkgroup: "cf_workgroup",
    logBucketArn: "arn:aws:s3:::example-log-bucket",
  });

  new AnalyticsDashboard(stack, "Dashboard", {
    auth,
    processor,
    emailSender: { name: "Analytics Dashboard", emailAddress: "no-reply@example.com" },
  });

  return Template.fromStack(stack);
}

describe("AnalyticsDashboard", () => {
  test("provisions a CloudFront distribution for the SvelteKit site", () => {
    makeTemplate().resourceCountIs("AWS::CloudFront::Distribution", 1);
  });

  test("adds an /auth/* cache behavior", () => {
    makeTemplate().hasResourceProperties("AWS::CloudFront::Distribution", {
      DistributionConfig: {
        CacheBehaviors: Match.arrayWith([Match.objectLike({ PathPattern: "/auth/*" })]),
      },
    });
  });

  test("creates a users table with a reverse GSI", () => {
    const template = makeTemplate();
    const tables = template.findResources("AWS::DynamoDB::GlobalTable");
    const usersTables = Object.values(tables).filter((table) =>
      (table.Properties.GlobalSecondaryIndexes ?? []).some(
        (index: { IndexName?: string }) => index.IndexName === "reverse",
      ),
    );
    expect(usersTables.length).toBeGreaterThanOrEqual(1);

    template.hasResourceProperties("AWS::DynamoDB::GlobalTable", {
      GlobalSecondaryIndexes: Match.arrayWith([
        Match.objectLike({
          IndexName: "reverse",
          KeySchema: [
            { AttributeName: "sk", KeyType: "HASH" },
            { AttributeName: "pk", KeyType: "RANGE" },
          ],
        }),
      ]),
    });
  });

  test("creates an auth-events consumer Lambda and EventBridge rule", () => {
    const template = makeTemplate();
    template.hasResourceProperties("AWS::Events::Rule", {
      EventPattern: Match.objectLike({
        "detail-type": ["EmailCodeAuth", "UnsuccessfulAuth"],
      }),
    });
    const consumers = template.findResources("AWS::Lambda::Function", {
      Properties: {
        Description: Match.stringLikeRegexp("auth events consumer"),
      },
    });
    expect(Object.keys(consumers).length).toBeGreaterThanOrEqual(1);
  });
});
