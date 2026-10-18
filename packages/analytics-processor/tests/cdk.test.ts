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
    template.resourceCountIs("AWS::Events::Rule", 3);
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

  it("does not create a sitemap Lambda or a second rate schedule", () => {
    const template = makeTemplate();
    const sitemapFunctions = template.findResources("AWS::Lambda::Function", {
      Properties: { Handler: "sitemap.handler" },
    });
    expect(Object.keys(sitemapFunctions).length).toBe(0);

    const rateRules = template.findResources("AWS::Events::Rule", {
      Properties: { ScheduleExpression: "rate(1 hour)" },
    });
    expect(Object.keys(rateRules).length).toBe(1);
  });

  it("gives the SDK Lambda the table and reverse index environment", () => {
    const template = makeTemplate();
    template.hasResourceProperties("AWS::Lambda::Function", {
      Handler: "sdkHandler.handler",
      Environment: {
        Variables: Match.objectLike({
          TABLE_NAME: Match.anyValue(),
          REVERSE_INDEX_NAME: "reverse",
        }),
      },
    });
  });

  it("gives the daily rollup Lambda the Athena environment", () => {
    const template = makeTemplate();
    template.hasResourceProperties("AWS::Lambda::Function", {
      Handler: "dailyRollup.handler",
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

  it("gives the monthly rollup Lambda the Athena environment", () => {
    const template = makeTemplate();
    template.hasResourceProperties("AWS::Lambda::Function", {
      Handler: "monthlyRollup.handler",
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

  it("publishes config outputs for CLI --stack resolution", () => {
    const template = makeTemplate();
    template.hasOutput("AnalyticsTableName", { Value: Match.anyValue() });
    template.hasOutput("AnalyticsReverseIndexName", { Value: "reverse" });
    template.hasOutput("AnalyticsAthenaDatabase", { Value: "cf_logs" });
    template.hasOutput("AnalyticsAthenaTable", { Value: "cf_logs_v2_table" });
    template.hasOutput("AnalyticsAthenaWorkgroup", { Value: "cf_analytics" });
  });
});
