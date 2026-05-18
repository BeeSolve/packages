import { App, Stack } from "aws-cdk-lib";
import { Template } from "aws-cdk-lib/assertions";
import { Source } from "aws-cdk-lib/aws-s3-deployment";
import { describe, expect, test } from "bun:test";
import { StaticWebsite } from "../src/staticWebsite";

const baseProps = {
  domain: undefined,
  source: Source.data("index.html", "<html></html>"),
  contentSecurityPolicy: {},
  mode: "singlePageApplication" as const,
} satisfies Omit<ConstructorParameters<typeof StaticWebsite>[2], "refererId">;

describe("StaticWebsite refererId validation", () => {
  test("throws for an empty refererId", () => {
    const stack = new Stack(new App(), "TestStack");
    expect(() => {
      new StaticWebsite(stack, "Website", { ...baseProps, refererId: "" });
    }).toThrow("non-empty");
  });

  test("throws for a whitespace-only refererId", () => {
    const stack = new Stack(new App(), "TestStack");
    expect(() => {
      new StaticWebsite(stack, "Website", { ...baseProps, refererId: "   " });
    }).toThrow("non-empty");
  });

  test("throws when refererId contains a wildcard *", () => {
    const stack = new Stack(new App(), "TestStack");
    expect(() => {
      new StaticWebsite(stack, "Website", { ...baseProps, refererId: "secret-*" });
    }).toThrow("wildcards");
  });

  test("throws when refererId contains a wildcard ?", () => {
    const stack = new Stack(new App(), "TestStack");
    expect(() => {
      new StaticWebsite(stack, "Website", { ...baseProps, refererId: "secret?" });
    }).toThrow("wildcards");
  });
});

describe("StaticWebsite synthesis", () => {
  function makeWebsite() {
    const app = new App();
    const stack = new Stack(app, "TestStack");
    new StaticWebsite(stack, "Website", {
      ...baseProps,
      refererId: "my-secret-referer-id",
    });
    return Template.fromStack(stack);
  }

  test("creates a CloudFront distribution", () => {
    makeWebsite().resourceCountIs("AWS::CloudFront::Distribution", 1);
  });

  test("creates an S3 bucket", () => {
    const template = makeWebsite();
    expect(Object.keys(template.findResources("AWS::S3::Bucket")).length).toBeGreaterThanOrEqual(1);
  });

  test("enforces HTTPS via viewer protocol policy", () => {
    makeWebsite().hasResourceProperties("AWS::CloudFront::Distribution", {
      DistributionConfig: {
        DefaultCacheBehavior: {
          ViewerProtocolPolicy: "redirect-to-https",
        },
      },
    });
  });
});
