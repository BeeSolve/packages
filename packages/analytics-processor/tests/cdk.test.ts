import { describe, expect, it } from "bun:test";

import { App, Stack } from "aws-cdk-lib";
import { Match, Template } from "aws-cdk-lib/assertions";

import { AnalyticsProcessor } from "../dist/cdk.js";

const minimalProps = {
  athenaDatabase: "cf_logs",
  athenaV2Table: "cf_logs_v2_table",
  athenaWorkgroup: "cf_analytics",
  logBucketArn: "arn:aws:s3:::example-log-bucket",
  athenaResultsBucketArn: "arn:aws:s3:::example-athena-results",
};

function makeTemplate(): Template {
  const app = new App();
  const stack = new Stack(app, "TestStack", {
    env: { account: "123456789012", region: "us-east-1" },
  });
  new AnalyticsProcessor(stack, "Analytics", minimalProps);
  return Template.fromStack(stack);
}

describe("AnalyticsProcessor construct", () => {
  it("creates a single table with pk/sk composite key", () => {
    const template = makeTemplate();
    template.resourceCountIs("AWS::DynamoDB::GlobalTable", 1);
    template.hasResourceProperties("AWS::DynamoDB::GlobalTable", {
      KeySchema: [
        { AttributeName: "pk", KeyType: "HASH" },
        { AttributeName: "sk", KeyType: "RANGE" },
      ],
      BillingMode: "PAY_PER_REQUEST",
    });
  });

  it("creates a reverse GSI with sk as partition key and pk as sort key", () => {
    const template = makeTemplate();
    template.hasResourceProperties("AWS::DynamoDB::GlobalTable", {
      GlobalSecondaryIndexes: Match.arrayWith([
        Match.objectLike({
          IndexName: "reverse",
          KeySchema: [
            { AttributeName: "sk", KeyType: "HASH" },
            { AttributeName: "pk", KeyType: "RANGE" },
          ],
          Projection: { ProjectionType: "ALL" },
        }),
      ]),
    });
  });

  it("creates three processing Lambdas", () => {
    const template = makeTemplate();
    const functions = template.findResources("AWS::Lambda::Function");
    expect(Object.keys(functions).length).toBeGreaterThanOrEqual(3);
  });

  it("gives the hourly Lambda the Athena v2 table environment", () => {
    const template = makeTemplate();
    template.hasResourceProperties("AWS::Lambda::Function", {
      Handler: "hourly.handler",
      Environment: {
        Variables: Match.objectLike({
          TABLE_NAME: Match.anyValue(),
          REVERSE_INDEX_NAME: "reverse",
          ATHENA_V2_TABLE: "cf_logs_v2_table",
          ATHENA_DATABASE: "cf_logs",
          ATHENA_WORKGROUP: "cf_analytics",
          PROCESSING_LAG_HOURS: "2",
        }),
      },
    });
  });

  it("creates an hourly rate schedule and two cron rollup schedules", () => {
    const template = makeTemplate();
    template.resourceCountIs("AWS::Events::Rule", 4);
    template.hasResourceProperties("AWS::Events::Rule", {
      ScheduleExpression: "rate(1 hour)",
    });
    template.hasResourceProperties("AWS::Events::Rule", {
      ScheduleExpression: "cron(15 0 * * ? *)",
    });
    template.hasResourceProperties("AWS::Events::Rule", {
      ScheduleExpression: "cron(30 1 1 * ? *)",
    });
  });

  it("grants the hourly Lambda Athena query permissions", () => {
    const template = makeTemplate();
    template.hasResourceProperties("AWS::IAM::Policy", {
      PolicyDocument: {
        Statement: Match.arrayWith([
          Match.objectLike({
            Action: Match.arrayWith(["athena:StartQueryExecution"]),
          }),
        ]),
      },
    });
  });

  it("creates the sitemap Lambda with Athena and table environment", () => {
    const template = makeTemplate();
    template.hasResourceProperties("AWS::Lambda::Function", {
      Handler: "sitemap.handler",
      Environment: {
        Variables: Match.objectLike({
          TABLE_NAME: Match.anyValue(),
          REVERSE_INDEX_NAME: "reverse",
          ATHENA_DATABASE: "cf_logs",
          ATHENA_V2_TABLE: "cf_logs_v2_table",
          ATHENA_WORKGROUP: "cf_analytics",
        }),
      },
    });
  });

  it("schedules the sitemap Lambda hourly alongside the hourly processor", () => {
    const template = makeTemplate();
    const rateRules = template.findResources("AWS::Events::Rule", {
      Properties: { ScheduleExpression: "rate(1 hour)" },
    });
    expect(Object.keys(rateRules).length).toBe(2);

    const sitemapFunctions = Object.keys(
      template.findResources("AWS::Lambda::Function", {
        Properties: { Handler: "sitemap.handler" },
      }),
    );
    expect(sitemapFunctions.length).toBe(1);
    const sitemapLogicalId = sitemapFunctions[0];

    const targetsSitemap = Object.values(rateRules).some((rule) =>
      (rule.Properties?.Targets ?? []).some(
        (target: { Arn?: { "Fn::GetAtt"?: Array<string> } }) =>
          target.Arn?.["Fn::GetAtt"]?.[0] === sitemapLogicalId,
      ),
    );
    expect(targetsSitemap).toBe(true);
  });
});
