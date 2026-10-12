import { describe, expect, test } from "bun:test";

import { App, Stack } from "aws-cdk-lib";
import { Match, Template } from "aws-cdk-lib/assertions";
import { Distribution } from "aws-cdk-lib/aws-cloudfront";
import { HttpOrigin } from "aws-cdk-lib/aws-cloudfront-origins";

import { CloudFrontAccessLoggingSettings } from "../src/cloudFrontAccessLoggingSettings";

const allFieldCount = 34;

function makeStack() {
  return new Stack(new App(), "TestStack");
}

function glueColumnNames(template: Template): Array<string> {
  const tables = template.findResources("AWS::Glue::Table");
  const names: Array<string> = [];
  for (const table of Object.values(tables)) {
    const columns = table?.Properties?.TableInput?.StorageDescriptor?.Columns;
    if (!Array.isArray(columns)) continue;
    for (const column of columns) {
      if (column != null && typeof column.Name === "string") names.push(column.Name);
    }
  }
  return names;
}

describe("CloudFrontAccessLoggingSettings", () => {
  test("creates an S3 bucket for access logs", () => {
    const stack = makeStack();
    new CloudFrontAccessLoggingSettings(stack, "Logging", {});
    Template.fromStack(stack).resourceCountIs("AWS::S3::Bucket", 1);
  });

  test("pins the log bucket's physical name when logBucketName is provided", () => {
    const stack = makeStack();
    new CloudFrontAccessLoggingSettings(stack, "Logging", {
      athena: { account: "123456789012", createSampleQuery: false },
      logBucketName: "my-existing-bucket",
    });
    const template = Template.fromStack(stack);
    const buckets = template.findResources("AWS::S3::Bucket");
    const bucketNames = Object.values(buckets).map((bucket) => bucket?.Properties?.BucketName);
    // The AccessLogs log bucket is pinned; the AthenaBucket keeps its generated name.
    expect(bucketNames).toContain("my-existing-bucket");
    template.hasResourceProperties("AWS::S3::Bucket", {
      BucketName: "my-existing-bucket",
    });
  });

  test("emits no BucketName on the log bucket when logBucketName is omitted", () => {
    const stack = makeStack();
    new CloudFrontAccessLoggingSettings(stack, "Logging", {});
    const template = Template.fromStack(stack);
    const buckets = template.findResources("AWS::S3::Bucket");
    const logBuckets = Object.values(buckets);
    expect(logBuckets.length).toBe(1);
    // No explicit BucketName (and no GENERATE_IF_NEEDED-derived name) is emitted, so an
    // existing brownfield bucket deployed without a name is never forced into a replacement.
    for (const bucket of logBuckets) {
      expect(bucket?.Properties?.BucketName).toBeUndefined();
    }
  });

  test("exposes cloudFrontLoggingSettings with enableLogging false (v2-only collection)", () => {
    const stack = makeStack();
    const construct = new CloudFrontAccessLoggingSettings(stack, "Logging", {});
    const settings = construct.cloudFrontLoggingSettings;
    // @ts-ignore — enableLogging is a readonly boolean
    expect(settings.enableLogging).toBe(false);
  });

  test("does not create Athena resources when athena prop is omitted", () => {
    const stack = makeStack();
    new CloudFrontAccessLoggingSettings(stack, "Logging", {});
    const template = Template.fromStack(stack);
    template.resourceCountIs("AWS::Glue::Database", 0);
    template.resourceCountIs("AWS::Glue::Table", 0);
    template.resourceCountIs("AWS::Athena::WorkGroup", 0);
  });

  test("creates Glue database, exactly one Parquet table, and Athena workgroup", () => {
    const stack = makeStack();
    new CloudFrontAccessLoggingSettings(stack, "Logging", {
      athena: { account: "123456789012" },
    });
    const template = Template.fromStack(stack);
    template.resourceCountIs("AWS::Glue::Database", 1);
    template.resourceCountIs("AWS::Glue::Table", 1);
    template.resourceCountIs("AWS::Athena::WorkGroup", 1);
    template.hasResourceProperties("AWS::Glue::Table", {
      TableInput: {
        StorageDescriptor: {
          SerdeInfo: {
            SerializationLibrary: "org.apache.hadoop.hive.ql.io.parquet.serde.ParquetHiveSerDe",
          },
        },
      },
    });
  });

  test("creates a sample query targeting the Parquet table by default", () => {
    const stack = makeStack();
    new CloudFrontAccessLoggingSettings(stack, "Logging", {
      athena: { account: "123456789012" },
    });
    const template = Template.fromStack(stack);
    template.resourceCountIs("AWS::Athena::NamedQuery", 1);
    template.hasResourceProperties("AWS::Athena::NamedQuery", {
      QueryString: Match.stringLikeRegexp('"cf_logs_db"\\."cf_logs_table"'),
    });
  });

  test("skips the sample query when createSampleQuery is false", () => {
    const stack = makeStack();
    new CloudFrontAccessLoggingSettings(stack, "Logging", {
      athena: { account: "123456789012", createSampleQuery: false },
    });
    Template.fromStack(stack).resourceCountIs("AWS::Athena::NamedQuery", 0);
  });

  test("uses custom Glue database and table names", () => {
    const stack = makeStack();
    new CloudFrontAccessLoggingSettings(stack, "Logging", {
      athena: {
        account: "123456789012",
        glueDbName: "my_db",
        glueTableName: "my_table",
        createSampleQuery: false,
      },
    });
    const template = Template.fromStack(stack);
    template.hasResourceProperties("AWS::Glue::Database", {
      DatabaseInput: { Name: "my_db" },
    });
    template.hasResourceProperties("AWS::Glue::Table", {
      DatabaseName: "my_db",
      TableInput: { Name: "my_table" },
    });
  });

  test("uses normalized Glue column names, not hyphenated ones", () => {
    const stack = makeStack();
    new CloudFrontAccessLoggingSettings(stack, "Logging", {
      athena: { account: "123456789012", createSampleQuery: false },
    });
    const template = Template.fromStack(stack);
    const columnNames = glueColumnNames(template);
    expect(columnNames).toContain("sc_status");
    expect(columnNames).toContain("cs_user_agent");
    expect(columnNames).not.toContain("sc-status");
    expect(columnNames).not.toContain("cs(User-Agent)");
  });

  test("defaults to all fields when recordFields is omitted", () => {
    const stack = makeStack();
    new CloudFrontAccessLoggingSettings(stack, "Logging", {
      athena: { account: "123456789012", createSampleQuery: false },
    });
    const template = Template.fromStack(stack);
    expect(glueColumnNames(template).length).toBe(allFieldCount);
  });

  test("respects a subset of recordFields on both the Glue table and the delivery", () => {
    const stack = makeStack();
    const logging = new CloudFrontAccessLoggingSettings(stack, "Logging", {
      athena: {
        account: "123456789012",
        recordFields: ["sc_status", "c_ip", "timestamp"],
        createSampleQuery: false,
      },
    });
    new Distribution(stack, "Distribution", {
      defaultBehavior: { origin: new HttpOrigin("example.com") },
      ...logging.cloudFrontLoggingSettings,
    });
    logging.enableV2Logging({
      distributionArn: "arn:aws:cloudfront::123456789012:distribution/E123ABC",
    });
    const template = Template.fromStack(stack);
    template.hasResourceProperties("AWS::Glue::Table", {
      TableInput: {
        StorageDescriptor: {
          Columns: [
            { Name: "sc_status", Type: "int" },
            { Name: "c_ip", Type: "string" },
            { Name: "timestamp", Type: "string" },
          ],
        },
      },
    });
    template.hasResourceProperties("AWS::Logs::Delivery", {
      RecordFields: ["sc-status", "c-ip", "timestamp"],
    });
  });
});

describe("CloudFrontAccessLoggingSettings standard logging v2", () => {
  function makeV2Stack() {
    const stack = makeStack();
    const logging = new CloudFrontAccessLoggingSettings(stack, "Logging", {
      athena: {
        account: "123456789012",
        createSampleQuery: false,
      },
    });
    new Distribution(stack, "Distribution", {
      defaultBehavior: { origin: new HttpOrigin("example.com") },
      ...logging.cloudFrontLoggingSettings,
    });
    logging.enableV2Logging({
      distributionArn: "arn:aws:cloudfront::123456789012:distribution/E123ABC",
    });
    return { stack, logging };
  }

  test("creates exactly one delivery source, destination, and delivery", () => {
    const { stack } = makeV2Stack();
    const template = Template.fromStack(stack);
    template.resourceCountIs("AWS::Logs::DeliverySource", 1);
    template.resourceCountIs("AWS::Logs::DeliveryDestination", 1);
    template.resourceCountIs("AWS::Logs::Delivery", 1);
  });

  test("creates delivery resources in the provided us-east-1 deliveryScope, not the construct stack", () => {
    const app = new App();
    const homeStack = new Stack(app, "HomeStack", {
      env: { account: "123456789012", region: "eu-central-1" },
    });
    const usEast1Stack = new Stack(app, "UsEast1Stack", {
      env: { account: "123456789012", region: "us-east-1" },
    });

    const logging = new CloudFrontAccessLoggingSettings(homeStack, "Logging", {
      athena: { account: "123456789012", createSampleQuery: false },
    });
    new Distribution(homeStack, "Distribution", {
      defaultBehavior: { origin: new HttpOrigin("example.com") },
      ...logging.cloudFrontLoggingSettings,
    });
    logging.enableV2Logging({
      distributionArn: "arn:aws:cloudfront::123456789012:distribution/E123ABC",
      deliveryScope: usEast1Stack,
      logBucketArn: "arn:aws:s3:::my-existing-bucket",
    });

    const usEast1Template = Template.fromStack(usEast1Stack);
    usEast1Template.resourceCountIs("AWS::Logs::DeliverySource", 1);
    usEast1Template.resourceCountIs("AWS::Logs::DeliveryDestination", 1);
    usEast1Template.resourceCountIs("AWS::Logs::Delivery", 1);

    const homeTemplate = Template.fromStack(homeStack);
    homeTemplate.resourceCountIs("AWS::Logs::DeliverySource", 0);
    homeTemplate.resourceCountIs("AWS::Logs::DeliveryDestination", 0);
    homeTemplate.resourceCountIs("AWS::Logs::Delivery", 0);
  });

  test("uses an explicit logBucketArn for the delivery destination across regions", () => {
    const app = new App();
    const homeStack = new Stack(app, "HomeStack", {
      env: { account: "123456789012", region: "eu-central-1" },
    });
    const usEast1Stack = new Stack(app, "UsEast1Stack", {
      env: { account: "123456789012", region: "us-east-1" },
    });

    const logging = new CloudFrontAccessLoggingSettings(homeStack, "Logging", {
      athena: { account: "123456789012", createSampleQuery: false },
    });
    new Distribution(homeStack, "Distribution", {
      defaultBehavior: { origin: new HttpOrigin("example.com") },
      ...logging.cloudFrontLoggingSettings,
    });
    logging.enableV2Logging({
      distributionArn: "arn:aws:cloudfront::123456789012:distribution/E123ABC",
      deliveryScope: usEast1Stack,
      logBucketArn: "arn:aws:s3:::my-existing-bucket",
    });

    const usEast1Template = Template.fromStack(usEast1Stack);
    usEast1Template.hasResourceProperties("AWS::Logs::DeliveryDestination", {
      DestinationResourceArn: "arn:aws:s3:::my-existing-bucket",
    });

    // No delivery resources leak into the home-region stack.
    const homeTemplate = Template.fromStack(homeStack);
    homeTemplate.resourceCountIs("AWS::Logs::DeliverySource", 0);
    homeTemplate.resourceCountIs("AWS::Logs::DeliveryDestination", 0);
    homeTemplate.resourceCountIs("AWS::Logs::Delivery", 0);
  });

  test("delivery destination uses parquet output format", () => {
    const { stack } = makeV2Stack();
    Template.fromStack(stack).hasResourceProperties("AWS::Logs::DeliveryDestination", {
      OutputFormat: "parquet",
    });
  });

  test("delivery enables the hive-compatible path and a v2 suffix path", () => {
    const { stack } = makeV2Stack();
    Template.fromStack(stack).hasResourceProperties("AWS::Logs::Delivery", {
      S3EnableHiveCompatiblePath: true,
      S3SuffixPath: Match.stringLikeRegexp("^v2/"),
    });
  });

  test("delivery source targets access logs for the distribution", () => {
    const { stack } = makeV2Stack();
    Template.fromStack(stack).hasResourceProperties("AWS::Logs::DeliverySource", {
      LogType: "ACCESS_LOGS",
      ResourceArn: "arn:aws:cloudfront::123456789012:distribution/E123ABC",
    });
  });

  test("creates exactly one Parquet Glue table with four partition keys", () => {
    const { stack } = makeV2Stack();
    const template = Template.fromStack(stack);
    template.resourceCountIs("AWS::Glue::Table", 1);
    template.hasResourceProperties("AWS::Glue::Table", {
      TableInput: {
        Name: "cf_logs_table",
        StorageDescriptor: {
          SerdeInfo: {
            SerializationLibrary: "org.apache.hadoop.hive.ql.io.parquet.serde.ParquetHiveSerDe",
          },
        },
        PartitionKeys: [
          { Name: "year", Type: "string" },
          { Name: "month", Type: "string" },
          { Name: "day", Type: "string" },
          { Name: "hour", Type: "string" },
        ],
      },
    });
  });

  test("enables partition projection on the Glue table", () => {
    const { stack } = makeV2Stack();
    Template.fromStack(stack).hasResourceProperties("AWS::Glue::Table", {
      TableInput: {
        Parameters: {
          "projection.enabled": "true",
          "projection.hour.type": "integer",
        },
      },
    });
  });

  test("disables logging on the distribution (v2 delivery writes directly)", () => {
    const { stack } = makeV2Stack();
    const template = Template.fromStack(stack);
    const distributions = template.findResources("AWS::CloudFront::Distribution");
    const loggingConfigs = Object.values(distributions).map(
      (distribution) => distribution.Properties.DistributionConfig.Logging,
    );
    expect(loggingConfigs.every((logging) => logging == null)).toBe(true);
  });

  test("does not create delivery resources before enableV2Logging is called", () => {
    const stack = makeStack();
    new CloudFrontAccessLoggingSettings(stack, "Logging", {
      athena: { account: "123456789012", createSampleQuery: false },
    });
    const template = Template.fromStack(stack);
    template.resourceCountIs("AWS::Logs::DeliverySource", 0);
    template.resourceCountIs("AWS::Logs::Delivery", 0);
    template.resourceCountIs("AWS::Glue::Table", 1);
  });

  test("exposes public members for wiring the processor", () => {
    const { logging } = makeV2Stack();
    expect(logging.glueDatabaseName).toBe("cf_logs_db");
    expect(logging.glueTableName).toBe("cf_logs_table");
    expect(logging.workgroupName).toBe("cf_workgroup");
    expect(logging.logBucket).toBeDefined();
    expect(logging.athenaResultsBucket).toBeDefined();
  });

  test("public members are undefined when athena is not configured", () => {
    const stack = makeStack();
    const logging = new CloudFrontAccessLoggingSettings(stack, "Logging", {});
    expect(logging.glueDatabaseName).toBeUndefined();
    expect(logging.glueTableName).toBeUndefined();
    expect(logging.workgroupName).toBeUndefined();
    expect(logging.athenaResultsBucket).toBeUndefined();
  });
});
