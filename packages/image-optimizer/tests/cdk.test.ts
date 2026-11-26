import { beforeAll, describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { LambdaKeepActive } from "@beesolve/lambda-keep-active";
import { App, Duration, Stack } from "aws-cdk-lib";
import { Match, Template } from "aws-cdk-lib/assertions";
import { Distribution, PriceClass } from "aws-cdk-lib/aws-cloudfront";
import { S3BucketOrigin } from "aws-cdk-lib/aws-cloudfront-origins";
import { Bucket } from "aws-cdk-lib/aws-s3";

import { buildAll } from "../build";
import { createImageOptimizerDistribution, ImageOptimizer } from "../dist/cdk.js";
import type { ImageOptimizerProps } from "../dist/cdk.js";
import { supportedQueryKeys } from "../src/query";

const env = { account: "123456789012", region: "eu-central-1" };

function createStack(): Stack {
  return new Stack(new App(), "Test", { env });
}

interface Fixture {
  stack: Stack;
  bucket: Bucket;
  distribution: Distribution;
}

function createFixture(): Fixture {
  const stack = createStack();
  const bucket = new Bucket(stack, "Source");
  const distribution = createImageOptimizerDistribution({
    scope: stack,
    id: "Distribution",
    bucket,
  });
  return { stack, bucket, distribution };
}

function create(props: Partial<ImageOptimizerProps> = {}): { stack: Stack; template: Template } {
  const { stack, bucket, distribution } = createFixture();
  new ImageOptimizer(stack, "Images", { bucket, distribution, ...props });
  return { stack, template: Template.fromStack(stack) };
}

function throws(props: Partial<ImageOptimizerProps>): void {
  const { stack, bucket, distribution } = createFixture();
  expect(() => new ImageOptimizer(stack, "Images", { bucket, distribution, ...props })).toThrow(
    "ImageOptimizer",
  );
}

let template: Template;

beforeAll(async () => {
  await buildAll();
  template = create().template;
}, 60_000);

describe("ImageOptimizer", () => {
  it("routes every image extension in both cases to the image function", () => {
    const distribution = Object.values(template.findResources("AWS::CloudFront::Distribution"))[0];
    const behaviors: Array<{
      PathPattern: string;
      FunctionAssociations?: Array<{ EventType: string }>;
    }> = distribution?.Properties.DistributionConfig.CacheBehaviors;
    const patterns = behaviors.map((behavior) => behavior.PathPattern);

    expect(patterns).toEqual([
      "/assets/*.jpg",
      "/assets/*.JPG",
      "/assets/*.jpeg",
      "/assets/*.JPEG",
      "/assets/*.png",
      "/assets/*.PNG",
      "/assets/*.webp",
      "/assets/*.WEBP",
      "/assets/*",
    ]);
    for (const behavior of behaviors.slice(0, 8)) {
      expect(behavior.FunctionAssociations?.map((association) => association.EventType)).toEqual([
        "viewer-request",
      ]);
    }
    expect(behaviors[8]?.FunctionAssociations).toBeUndefined();
  });

  it("answers 404 outside the assets prefix of a distribution from createImageOptimizerDistribution", () => {
    template.resourceCountIs("AWS::CloudFront::Function", 2);
    template.hasResourceProperties("AWS::CloudFront::Function", {
      FunctionCode: Match.stringLikeRegexp("statusCode: 404"),
    });
    const distribution = Object.values(template.findResources("AWS::CloudFront::Distribution"))[0];
    const defaultBehavior = distribution?.Properties.DistributionConfig.DefaultCacheBehavior;

    expect(defaultBehavior.FunctionAssociations).toHaveLength(1);
    expect(defaultBehavior.FunctionAssociations[0].EventType).toBe("viewer-request");
  });

  it("serves the rest of the prefix from the bucket", () => {
    template.hasResourceProperties("AWS::CloudFront::Distribution", {
      DistributionConfig: Match.objectLike({
        DefaultCacheBehavior: Match.objectLike({ ViewerProtocolPolicy: "redirect-to-https" }),
        Origins: Match.arrayWith([
          Match.objectLike({ S3OriginConfig: Match.anyValue() }),
          Match.objectLike({ CustomOriginConfig: Match.objectLike({ OriginReadTimeout: 35 }) }),
        ]),
      }),
    });
    template.resourceCountIs("AWS::CloudFront::OriginAccessControl", 3);
  });

  it("uses the built edge function code", () => {
    const code = readFileSync(join(import.meta.dir, "..", "dist", "edge", "function.js"), "utf8");

    template.hasResourceProperties("AWS::CloudFront::Function", {
      FunctionCode: code,
      FunctionConfig: Match.objectLike({ Runtime: "cloudfront-js-2.0" }),
    });
  });

  it("keys the cache on the supported query parameters and Accept only", () => {
    template.hasResourceProperties("AWS::CloudFront::CachePolicy", {
      CachePolicyConfig: Match.objectLike({
        DefaultTTL: 31536000,
        MaxTTL: 31536000,
        MinTTL: 0,
        ParametersInCacheKeyAndForwardedToOrigin: {
          EnableAcceptEncodingBrotli: false,
          EnableAcceptEncodingGzip: false,
          CookiesConfig: { CookieBehavior: "none" },
          HeadersConfig: { HeaderBehavior: "whitelist", Headers: ["Accept"] },
          QueryStringsConfig: {
            QueryStringBehavior: "whitelist",
            QueryStrings: [...supportedQueryKeys],
          },
        },
      }),
    });
  });

  it("protects the function URL with IAM and streams responses", () => {
    template.hasResourceProperties("AWS::Lambda::Url", {
      AuthType: "AWS_IAM",
      InvokeMode: "RESPONSE_STREAM",
    });
    template.hasResourceProperties("AWS::CloudFront::OriginAccessControl", {
      OriginAccessControlConfig: Match.objectLike({ OriginAccessControlOriginType: "lambda" }),
    });
  });

  it("passes the configuration to the function", () => {
    template.hasResourceProperties("AWS::Lambda::Function", {
      MemorySize: 2048,
      Timeout: 30,
      Environment: {
        Variables: Match.objectLike({
          ASSETS_PREFIX: "assets",
          CACHE_TTL_SECONDS: "31536000",
          SIZE_BUCKETS: "500,1000,1500,2000,2500,3000",
          MAX_SOURCE_BYTES: "52428800",
          MAX_PIXELS: "50000000",
          MIN_SOURCE_TO_BUCKET_RATIO: "1.5",
          SOURCE_BUCKET: Match.anyValue(),
          INTERMEDIATE_BUCKET: Match.anyValue(),
        }),
      },
    });
  });

  it("creates a private intermediate bucket that expires its objects", () => {
    template.hasResourceProperties("AWS::S3::Bucket", {
      LifecycleConfiguration: {
        Rules: [Match.objectLike({ ExpirationInDays: 180, Status: "Enabled" })],
      },
      PublicAccessBlockConfiguration: {
        BlockPublicAcls: true,
        BlockPublicPolicy: true,
        IgnorePublicAcls: true,
        RestrictPublicBuckets: true,
      },
    });
    template.hasResourceProperties("AWS::S3::BucketPolicy", {
      PolicyDocument: Match.objectLike({
        Statement: Match.arrayWith([
          Match.objectLike({
            Effect: "Deny",
            Condition: { Bool: { "aws:SecureTransport": "false" } },
          }),
        ]),
      }),
    });
  });

  it("gives the function read access to the source and read-write access to the intermediates", () => {
    const policies = Object.values(template.findResources("AWS::IAM::Policy"));
    const statements: Array<{ Action: string | Array<string>; Resource: unknown }> =
      policies.flatMap((policy) => policy.Properties.PolicyDocument.Statement);
    const actions = (match: (resource: string) => boolean) =>
      statements
        .filter((statement) => match(JSON.stringify(statement.Resource)))
        .flatMap((statement) =>
          Array.isArray(statement.Action) ? statement.Action : [statement.Action],
        );

    const sourceActions = actions(
      (resource) => resource.includes("Source") && !resource.includes("Intermediates"),
    );
    const intermediateActions = actions((resource) => resource.includes("Intermediates"));

    expect(sourceActions).toContain("s3:GetObject*");
    expect(sourceActions).toContain("s3:List*");
    expect(
      sourceActions.some((action) => action.startsWith("s3:Put") || action.startsWith("s3:Delete")),
    ).toBe(false);
    expect(intermediateActions).toContain("s3:PutObject");
    expect(intermediateActions).toContain("s3:GetObject*");
  });

  it("creates no distribution and no outputs of its own", () => {
    template.resourceCountIs("AWS::CloudFront::Distribution", 1);
    expect(Object.keys(template.findOutputs("*"))).toHaveLength(0);
  });
});

describe("ImageOptimizer options", () => {
  it("uses a custom prefix, TTL, buckets and retention", () => {
    const custom = create({
      assetsPathPrefix: "/img/",
      cacheTtl: Duration.days(7),
      sizeBuckets: [400, 800],
      intermediateRetentionDays: 30,
      memorySize: 1024,
      timeout: Duration.seconds(10),
    }).template;

    custom.hasResourceProperties("AWS::Lambda::Function", {
      MemorySize: 1024,
      Timeout: 10,
      Environment: {
        Variables: Match.objectLike({
          ASSETS_PREFIX: "img",
          CACHE_TTL_SECONDS: "604800",
          SIZE_BUCKETS: "400,800",
        }),
      },
    });
    custom.hasResourceProperties("AWS::S3::Bucket", {
      LifecycleConfiguration: { Rules: [Match.objectLike({ ExpirationInDays: 30 })] },
    });
    custom.hasResourceProperties("AWS::CloudFront::CachePolicy", {
      CachePolicyConfig: Match.objectLike({ DefaultTTL: 604800, MaxTTL: 604800 }),
    });
    const distribution = Object.values(custom.findResources("AWS::CloudFront::Distribution"))[0];
    expect(distribution?.Properties.DistributionConfig.CacheBehaviors[0].PathPattern).toBe(
      "/img/*.jpg",
    );
  });

  it("tags the function for keep-active when asked", () => {
    const { stack, bucket, distribution } = createFixture();
    const keepActive = new LambdaKeepActive(stack, "KeepActive");
    new ImageOptimizer(stack, "Images", { bucket, distribution, keepActive });

    Template.fromStack(stack).hasResourceProperties("AWS::Lambda::Function", {
      Description: "Image optimizer",
      Tags: Match.arrayWith([{ Key: "keepActive", Value: "true" }]),
    });
  });

  it("does not tag the function without keep-active", () => {
    const tagged = JSON.stringify(
      Object.values(template.findResources("AWS::Lambda::Function")).filter(
        (resource) => resource.Properties.Description === "Image optimizer",
      ),
    );

    expect(tagged).not.toContain("keepActive");
  });

  it("adds the behaviors to a distribution created by the caller", () => {
    const stack = createStack();
    const bucket = new Bucket(stack, "Source");
    const distribution = new Distribution(stack, "Existing", {
      defaultBehavior: { origin: S3BucketOrigin.withOriginAccessControl(bucket) },
    });
    new ImageOptimizer(stack, "Images", { bucket, distribution });

    const existing = Template.fromStack(stack);
    existing.resourceCountIs("AWS::CloudFront::Function", 1);
    const resources = existing.findResources("AWS::CloudFront::Distribution");
    expect(Object.keys(resources)).toHaveLength(1);
    const behaviors = Object.values(resources)[0]?.Properties.DistributionConfig.CacheBehaviors;
    expect(behaviors).toHaveLength(9);
  });
});

describe("ImageOptimizer validation", () => {
  it("rejects size buckets that are not ascending and unique", () => {
    throws({ sizeBuckets: [1000, 500] });
    throws({ sizeBuckets: [500, 500] });
    throws({ sizeBuckets: [] });
    throws({ sizeBuckets: [0, 500] });
    throws({ sizeBuckets: [500.5] });
  });

  it("rejects invalid numbers and durations", () => {
    throws({ intermediateRetentionDays: 0 });
    throws({ cacheTtl: Duration.seconds(0) });
    throws({ timeout: Duration.seconds(0) });
    throws({ maxPixels: 0 });
    throws({ maxSourceBytes: -1 });
    throws({ memorySize: 0 });
    throws({ minSourceToBucketRatio: 0.5 });
  });

  it("rejects an empty or wildcard prefix", () => {
    throws({ assetsPathPrefix: "" });
    throws({ assetsPathPrefix: "/" });
    throws({ assetsPathPrefix: "a/*" });
  });
});

describe("createImageOptimizerDistribution", () => {
  it("passes further distribution settings through", () => {
    const stack = createStack();
    const bucket = new Bucket(stack, "Source");
    createImageOptimizerDistribution({
      scope: stack,
      id: "Distribution",
      bucket,
      distributionProps: { comment: "Photos", priceClass: PriceClass.PRICE_CLASS_100 },
    });

    Template.fromStack(stack).hasResourceProperties("AWS::CloudFront::Distribution", {
      DistributionConfig: Match.objectLike({ Comment: "Photos", PriceClass: "PriceClass_100" }),
    });
  });
});
