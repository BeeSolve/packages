import { fileURLToPath } from "node:url";

import { BunFunction } from "@beesolve/lambda-bun-runtime";
import type { LambdaKeepActive } from "@beesolve/lambda-keep-active";
import { Duration, RemovalPolicy } from "aws-cdk-lib";
import type { DistributionProps } from "aws-cdk-lib/aws-cloudfront";
import {
  AllowedMethods,
  CacheCookieBehavior,
  CacheHeaderBehavior,
  CachePolicy,
  CacheQueryStringBehavior,
  Distribution,
  Function as CloudFrontFunction,
  FunctionCode,
  FunctionEventType,
  FunctionRuntime,
  ViewerProtocolPolicy,
} from "aws-cdk-lib/aws-cloudfront";
import { FunctionUrlOrigin, S3BucketOrigin } from "aws-cdk-lib/aws-cloudfront-origins";
import { FunctionUrlAuthType, InvokeMode } from "aws-cdk-lib/aws-lambda";
import { BlockPublicAccess, Bucket, BucketEncryption } from "aws-cdk-lib/aws-s3";
import type { IBucket } from "aws-cdk-lib/aws-s3";
import { Construct } from "constructs";

import { defaultMinSourceToBucketRatio, defaultSizeBuckets } from "./src/buckets";
import { environmentNames } from "./src/environment";
import { supportedQueryKeys } from "./src/query";

const here = `${fileURLToPath(new URL(".", import.meta.url))}`;
const imageExtensions = ["jpg", "jpeg", "png", "webp"];

const notFoundFunctionCode = `function handler() {
  return {
    statusCode: 404,
    statusDescription: "Not Found",
    headers: {
      "content-type": { value: "text/plain; charset=utf-8" },
      "cache-control": { value: "no-store" },
    },
    body: "Not Found",
  };
}
`;

export interface ImageOptimizerProps {
  /**
   * Bucket with the original images. The image function gets read access, CloudFront reads
   * it through origin access control. Use a bucket created in the same stack.
   */
  readonly bucket: IBucket;
  /**
   * Path prefix under which images are served, `/{assetsPathPrefix}/photos/cat.jpg?w=400`.
   * Requests under the prefix that are not JPEG, PNG or WebP are served from the bucket as they are.
   *
   * @default "assets"
   */
  readonly assetsPathPrefix?: string;
  /**
   * How long CloudFront and browsers cache a processed image (`Cache-Control` max-age and the
   * CloudFront TTLs).
   *
   * @default Duration.days(365)
   */
  readonly cacheTtl?: Duration;
  /**
   * Longest edge, in pixels, of the intermediate copies that bound the cost of requests for many
   * different sizes. Ascending and unique.
   *
   * @default [500, 1000, 1500, 2000, 2500, 3000]
   */
  readonly sizeBuckets?: ReadonlyArray<number>;
  /**
   * Days until intermediate copies expire. They are created again when needed.
   *
   * @default 180
   */
  readonly intermediateRetentionDays?: number;
  /**
   * Originals larger than this are not processed (HTTP 422).
   *
   * @default 52428800
   */
  readonly maxSourceBytes?: number;
  /**
   * Originals with more pixels than this are not processed (HTTP 422).
   *
   * @default 50000000
   */
  readonly maxPixels?: number;
  /**
   * An intermediate is only created when the original is at least this many times larger.
   *
   * @default 1.5
   */
  readonly minSourceToBucketRatio?: number;
  /** @default 2048 */
  readonly memorySize?: number;
  /** @default Duration.seconds(30) */
  readonly timeout?: Duration;
  /**
   * Distribution to add the image behaviors to. `createImageOptimizerDistribution` creates one
   * that answers 404 outside the assets prefix. The behaviors are appended, so behaviors added
   * to the distribution earlier take precedence for overlapping path patterns.
   */
  readonly distribution: Distribution;
  /**
   * Keeps the image function from becoming inactive after weeks without requests.
   */
  readonly keepActive?: LambdaKeepActive;
}

/**
 * Serves resized and re-encoded images from an S3 bucket through CloudFront. The URL protocol
 * is a subset of the imgix Rendering API. Requests for JPEG, PNG and WebP under the assets prefix
 * are canonicalized by a CloudFront Function and processed by a Bun Lambda, everything else
 * under the prefix is served from the bucket.
 */
export class ImageOptimizer extends Construct {
  readonly handler: BunFunction;
  readonly intermediateBucket: Bucket;
  readonly edgeFunction: CloudFrontFunction;

  constructor(scope: Construct, id: string, props: ImageOptimizerProps) {
    super(scope, id);

    const settings = resolveSettings(props);

    this.intermediateBucket = new Bucket(this, "Intermediates", {
      blockPublicAccess: BlockPublicAccess.BLOCK_ALL,
      encryption: BucketEncryption.S3_MANAGED,
      enforceSSL: true,
      removalPolicy: RemovalPolicy.DESTROY,
      autoDeleteObjects: true,
      lifecycleRules: [
        {
          expiration: Duration.days(settings.intermediateRetentionDays),
          abortIncompleteMultipartUploadAfter: Duration.days(1),
        },
      ],
    });

    this.handler = new BunFunction(this, "Handler", {
      description: "Image optimizer",
      entrypoint: `${here}handler/handler.js`,
      memorySize: settings.memorySize,
      timeout: settings.timeout,
      environment: {
        [environmentNames.sourceBucket]: props.bucket.bucketName,
        [environmentNames.intermediateBucket]: this.intermediateBucket.bucketName,
        [environmentNames.assetsPrefix]: settings.assetsPathPrefix,
        [environmentNames.cacheTtlSeconds]: String(settings.cacheTtl.toSeconds()),
        [environmentNames.sizeBuckets]: settings.sizeBuckets.join(","),
        [environmentNames.maxSourceBytes]: String(settings.maxSourceBytes),
        [environmentNames.maxPixels]: String(settings.maxPixels),
        [environmentNames.minSourceToBucketRatio]: String(settings.minSourceToBucketRatio),
      },
    });
    props.bucket.grantRead(this.handler);
    this.intermediateBucket.grantReadWrite(this.handler);
    props.keepActive?.keepActive(this.handler);

    const functionUrl = this.handler.addFunctionUrl({
      authType: FunctionUrlAuthType.AWS_IAM,
      invokeMode: InvokeMode.RESPONSE_STREAM,
    });
    const imageOrigin = FunctionUrlOrigin.withOriginAccessControl(functionUrl, {
      readTimeout: Duration.seconds(Math.min(120, settings.timeout.toSeconds() + 5)),
    });
    const bucketOrigin = S3BucketOrigin.withOriginAccessControl(props.bucket);

    this.edgeFunction = new CloudFrontFunction(this, "EdgeFunction", {
      comment: "Canonicalizes image query strings and normalizes Accept",
      runtime: FunctionRuntime.JS_2_0,
      code: FunctionCode.fromFile({ filePath: `${here}edge/function.js` }),
    });

    const imageCachePolicy = new CachePolicy(this, "CachePolicy", {
      comment: "Image optimizer: supported query parameters and Accept",
      defaultTtl: settings.cacheTtl,
      minTtl: Duration.seconds(0),
      maxTtl: settings.cacheTtl,
      queryStringBehavior: CacheQueryStringBehavior.allowList(...supportedQueryKeys),
      headerBehavior: CacheHeaderBehavior.allowList("Accept"),
      cookieBehavior: CacheCookieBehavior.none(),
      enableAcceptEncodingGzip: false,
      enableAcceptEncodingBrotli: false,
    });

    for (const pattern of imagePathPatterns(settings.assetsPathPrefix)) {
      props.distribution.addBehavior(pattern, imageOrigin, {
        viewerProtocolPolicy: ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
        allowedMethods: AllowedMethods.ALLOW_GET_HEAD,
        cachePolicy: imageCachePolicy,
        compress: false,
        functionAssociations: [
          { function: this.edgeFunction, eventType: FunctionEventType.VIEWER_REQUEST },
        ],
      });
    }
    props.distribution.addBehavior(`/${settings.assetsPathPrefix}/*`, bucketOrigin, {
      viewerProtocolPolicy: ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
      allowedMethods: AllowedMethods.ALLOW_GET_HEAD,
      cachePolicy: CachePolicy.CACHING_OPTIMIZED,
    });
  }
}

export interface ImageOptimizerDistributionProps {
  readonly scope: Construct;
  readonly id: string;
  /** Bucket used as the origin of the default behavior, which never reaches it. */
  readonly bucket: IBucket;
  /** Further distribution settings, for example `domainNames`, `certificate` or `priceClass`. */
  readonly distributionProps?: Omit<DistributionProps, "defaultBehavior">;
}

/**
 * Creates a distribution for `ImageOptimizer` whose default behavior answers 404 from a
 * CloudFront Function, so only the paths `ImageOptimizer` adds are served.
 */
export function createImageOptimizerDistribution(
  props: ImageOptimizerDistributionProps,
): Distribution {
  return new Distribution(props.scope, props.id, {
    comment: "Image optimizer",
    ...props.distributionProps,
    defaultBehavior: {
      origin: S3BucketOrigin.withOriginAccessControl(props.bucket),
      viewerProtocolPolicy: ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
      allowedMethods: AllowedMethods.ALLOW_GET_HEAD,
      cachePolicy: CachePolicy.CACHING_DISABLED,
      functionAssociations: [
        {
          function: new CloudFrontFunction(props.scope, `${props.id}NotFoundFunction`, {
            comment: "Answers 404 outside the image optimizer assets prefix",
            runtime: FunctionRuntime.JS_2_0,
            code: FunctionCode.fromInline(notFoundFunctionCode),
          }),
          eventType: FunctionEventType.VIEWER_REQUEST,
        },
      ],
    },
  });
}

interface Settings {
  assetsPathPrefix: string;
  cacheTtl: Duration;
  sizeBuckets: ReadonlyArray<number>;
  intermediateRetentionDays: number;
  maxSourceBytes: number;
  maxPixels: number;
  minSourceToBucketRatio: number;
  memorySize: number;
  timeout: Duration;
}

function resolveSettings(props: ImageOptimizerProps): Settings {
  const settings: Settings = {
    assetsPathPrefix: (props.assetsPathPrefix ?? "assets").replace(/^\/+/, "").replace(/\/+$/, ""),
    cacheTtl: props.cacheTtl ?? Duration.days(365),
    sizeBuckets: props.sizeBuckets ?? defaultSizeBuckets,
    intermediateRetentionDays: props.intermediateRetentionDays ?? 180,
    maxSourceBytes: props.maxSourceBytes ?? 50 * 1024 * 1024,
    maxPixels: props.maxPixels ?? 50_000_000,
    minSourceToBucketRatio: props.minSourceToBucketRatio ?? defaultMinSourceToBucketRatio,
    memorySize: props.memorySize ?? 2048,
    timeout: props.timeout ?? Duration.seconds(30),
  };

  if (settings.assetsPathPrefix === "") {
    throw new Error("ImageOptimizer: assetsPathPrefix must not be empty");
  }
  if (settings.assetsPathPrefix.includes("*") || settings.assetsPathPrefix.includes("?")) {
    throw new Error("ImageOptimizer: assetsPathPrefix must not contain wildcards");
  }
  if (settings.cacheTtl.toSeconds() < 1) {
    throw new Error("ImageOptimizer: cacheTtl must be at least one second");
  }
  if (settings.timeout.toSeconds() < 1) {
    throw new Error("ImageOptimizer: timeout must be at least one second");
  }
  assertPositiveInteger({
    name: "intermediateRetentionDays",
    value: settings.intermediateRetentionDays,
  });
  assertPositiveInteger({ name: "maxSourceBytes", value: settings.maxSourceBytes });
  assertPositiveInteger({ name: "maxPixels", value: settings.maxPixels });
  assertPositiveInteger({ name: "memorySize", value: settings.memorySize });
  if (!(settings.minSourceToBucketRatio >= 1)) {
    throw new Error("ImageOptimizer: minSourceToBucketRatio must be at least 1");
  }
  assertSizeBuckets(settings.sizeBuckets);
  return settings;
}

interface PositiveIntegerProps {
  name: string;
  value: number;
}

function assertPositiveInteger(props: PositiveIntegerProps): void {
  if (!Number.isInteger(props.value) || props.value < 1) {
    throw new Error(`ImageOptimizer: ${props.name} must be a positive integer`);
  }
}

function assertSizeBuckets(sizeBuckets: ReadonlyArray<number>): void {
  if (sizeBuckets.length === 0) {
    throw new Error("ImageOptimizer: sizeBuckets must not be empty");
  }
  sizeBuckets.forEach((bucket, index) => {
    assertPositiveInteger({ name: "sizeBuckets entries", value: bucket });
    const previous = sizeBuckets[index - 1];
    if (previous != null && bucket <= previous) {
      throw new Error("ImageOptimizer: sizeBuckets must be ascending and unique");
    }
  });
}

function imagePathPatterns(assetsPathPrefix: string): Array<string> {
  return imageExtensions
    .flatMap((extension) => [extension, extension.toUpperCase()])
    .map((extension) => `/${assetsPathPrefix}/*.${extension}`);
}
