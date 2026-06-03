import { describe, expect, test } from "bun:test";

import { App, Stack } from "aws-cdk-lib";
import { Template } from "aws-cdk-lib/assertions";

import { CloudFrontAccessLoggingSettings } from "../src/cloudFrontAccessLoggingSettings";

function makeStack() {
  return new Stack(new App(), "TestStack");
}

describe("CloudFrontAccessLoggingSettings", () => {
  test("creates an S3 bucket for access logs", () => {
    const stack = makeStack();
    new CloudFrontAccessLoggingSettings(stack, "Logging", {});
    Template.fromStack(stack).resourceCountIs("AWS::S3::Bucket", 1);
  });

  test("exposes cloudFrontLoggingSettings with enableLogging true", () => {
    const stack = makeStack();
    const construct = new CloudFrontAccessLoggingSettings(stack, "Logging", {});
    const settings = construct.cloudFrontLoggingSettings;
    // @ts-ignore — enableLogging is a readonly boolean
    expect(settings.enableLogging).toBe(true);
  });

  test("does not create Athena resources when athena prop is omitted", () => {
    const stack = makeStack();
    new CloudFrontAccessLoggingSettings(stack, "Logging", {});
    const template = Template.fromStack(stack);
    template.resourceCountIs("AWS::Glue::Database", 0);
    template.resourceCountIs("AWS::Glue::Table", 0);
    template.resourceCountIs("AWS::Athena::WorkGroup", 0);
  });

  test("creates Glue database, table, and Athena workgroup when athena is configured", () => {
    const stack = makeStack();
    new CloudFrontAccessLoggingSettings(stack, "Logging", {
      athena: { account: "123456789012" },
    });
    const template = Template.fromStack(stack);
    template.resourceCountIs("AWS::Glue::Database", 1);
    template.resourceCountIs("AWS::Glue::Table", 1);
    template.resourceCountIs("AWS::Athena::WorkGroup", 1);
  });

  test("creates a named sample query by default", () => {
    const stack = makeStack();
    new CloudFrontAccessLoggingSettings(stack, "Logging", {
      athena: { account: "123456789012" },
    });
    Template.fromStack(stack).resourceCountIs("AWS::Athena::NamedQuery", 1);
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

  test("respects a subset of columns when provided", () => {
    const stack = makeStack();
    new CloudFrontAccessLoggingSettings(stack, "Logging", {
      athena: {
        account: "123456789012",
        columns: ["date", "c-ip", "sc-status"],
        createSampleQuery: false,
      },
    });
    const template = Template.fromStack(stack);
    template.hasResourceProperties("AWS::Glue::Table", {
      TableInput: {
        StorageDescriptor: {
          Columns: [
            { Name: "date", Type: "date" },
            { Name: "c-ip", Type: "string" },
            { Name: "sc-status", Type: "string" },
          ],
        },
      },
    });
  });
});
