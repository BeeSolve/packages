import { assertUnreachable } from "@beesolve/helpers";
import { Duration, RemovalPolicy, Size } from "aws-cdk-lib";
import { Certificate } from "aws-cdk-lib/aws-certificatemanager";
import {
  AllowedMethods,
  CachePolicy,
  Distribution,
  Function,
  FunctionCode,
  FunctionEventType,
  FunctionRuntime,
  HeadersFrameOption,
  HeadersReferrerPolicy,
  OriginProtocolPolicy,
  PriceClass,
  ResponseHeadersPolicy,
  ViewerProtocolPolicy,
  type DistributionProps,
  type EdgeLambda,
  type FunctionAssociation,
} from "aws-cdk-lib/aws-cloudfront";
import { HttpOrigin } from "aws-cdk-lib/aws-cloudfront-origins";
import { ArnPrincipal, PolicyStatement } from "aws-cdk-lib/aws-iam";
import { ARecord, HostedZone, RecordTarget } from "aws-cdk-lib/aws-route53";
import { CloudFrontTarget } from "aws-cdk-lib/aws-route53-targets";
import {
  BlockPublicAccess,
  Bucket,
  BucketAccessControl,
  BucketEncryption,
  HttpMethods,
} from "aws-cdk-lib/aws-s3";
import { BucketDeployment, type ISource } from "aws-cdk-lib/aws-s3-deployment";
import { Construct } from "constructs";

interface StaticWebsiteProps {
  readonly domain:
    | {
        /**
         * Provide bare domain name.
         */
        readonly name: string;
        /**
         * Either provide certificate ARN as string or instance of Certificate.
         */
        readonly certificate: Certificate | string;
        readonly redirect: "enforceWww" | "enforceNonWww";
        /**
         * By default DNS records for domain are created in Route 53.
         * If you want to disable default behaviour, provide `false` for this value.
         */
        readonly createDnsRecords?: false;
      }
    | undefined;
  readonly source: ISource;
  readonly contentSecurityPolicy: CspProps;
  readonly securityHeaders?: {
    readonly frameOptions?: HeadersFrameOption;
    readonly referrerPolicy?: HeadersReferrerPolicy;
  };
  readonly mode: "singlePageApplication" | "multiPageApplication";
  readonly refererId: string;
  // todo: add errors if multipage application
  // readonly errors: string []
  /**
   * @default 10_240
   */
  readonly deploymentLambdaMemoryLimit?: number;
  /**
   * @default Size.mebibytes(512)
   */
  readonly deploymentLambdaEphemeralStorageSize?: Size;
  /**
   * You can use this alongside with CloudFrontAccessLoggingSettings construct
   */
  readonly logging?: Pick<
    DistributionProps,
    "logBucket" | "logFilePrefix" | "enableLogging" | "logIncludesCookies"
  >;
  /**
   * If you provide `basicHttpAuthentication` config the CloudFront function
   * is deployed which will check your username/password against each request
   */
  readonly basicHttpAuthentication?: {
    readonly username: string;
    readonly password: string;
    /**
     * @default ['/']
     */
    readonly prefixes?: string[];
  };
}

export class StaticWebsite extends Construct {
  readonly distribution: Distribution;

  constructor(scope: Construct, id: string, props: StaticWebsiteProps) {
    super(scope, id);

    const bucket = new Bucket(this, "Bucket", {
      encryption: BucketEncryption.S3_MANAGED,
      websiteIndexDocument: "index.html",
      accessControl: BucketAccessControl.PRIVATE,
      publicReadAccess: false,
      autoDeleteObjects: true,
      blockPublicAccess: BlockPublicAccess.BLOCK_ACLS_ONLY,
      removalPolicy: RemovalPolicy.DESTROY,
      cors: [
        {
          allowedMethods: [HttpMethods.GET, HttpMethods.HEAD],
          allowedOrigins: ["*"],
          allowedHeaders: ["*"],
          maxAge: 300,
        },
      ],
    });

    bucket.addToResourcePolicy(
      new PolicyStatement({
        principals: [new ArnPrincipal("*")],
        actions: ["s3:GetObject"],
        resources: [`${bucket.bucketArn}/*`],
        conditions: {
          StringLike: { "aws:Referer": props.refererId },
        },
      }),
    );

    const functionAssociations: FunctionAssociation[] = [
      {
        eventType: FunctionEventType.VIEWER_RESPONSE,
        function: new Function(this, "SecurityHeaders", {
          runtime: FunctionRuntime.JS_2_0,
          code: FunctionCode.fromInline(`async function handler(event) {
            event.response.headers['permissions-policy'] = {value: "accelerometer=(), camera=(), geolocation=(), gyroscope=(), magnetometer=(), microphone=(), payment=(), usb=()"};
            return event.response;
        }`),
        }),
      },
    ];

    const redirectCode = toRedirectCode();
    if (redirectCode != null)
      functionAssociations.push({
        eventType: FunctionEventType.VIEWER_REQUEST,
        function: new Function(this, "Redirect", {
          runtime: FunctionRuntime.JS_2_0,
          code: FunctionCode.fromInline(redirectCode),
        }),
      });

    if (props.basicHttpAuthentication != null) {
      // Compute the expected auth value at synth time so no user-controlled
      // strings are interpolated into the generated JavaScript source.
      // Base64 output is alphanumeric + '+', '/', '=' — safe in a JS string literal.
      const expectedAuth = `Basic ${Buffer.from(
        `${props.basicHttpAuthentication.username}:${props.basicHttpAuthentication.password}`,
      ).toString("base64")}`;
      const prefixesJson = JSON.stringify(
        props.basicHttpAuthentication.prefixes ?? ["/"],
      );

      functionAssociations.push({
        eventType: FunctionEventType.VIEWER_REQUEST,
        function: new Function(this, "BasicAuth", {
          runtime: FunctionRuntime.JS_2_0,
          code: FunctionCode.fromInline(`async function handler(event) {
                  const request = event.request;
                  var prefixes = ${prefixesJson};
                  if (prefixes.every(function(prefix) { return !request.uri.startsWith(prefix); })) {
                      return request;
                  }
                  var expected = "${expectedAuth}";
                  if (request.headers.authorization && request.headers.authorization.value === expected) {
                      return request;
                  }
                  return {
                      statusCode: 401,
                      statusDescription: 'Unauthorized',
                      headers: {
                          'www-authenticate': { value: 'Basic realm="Restricted"' },
                          'cache-control': { value: 'no-cache' },
                      },
                  };
              }`),
        }),
      });
    }

    const distribution = new Distribution(this, "Distribution", {
      comment: `${props.domain ? props.domain.name : this.node.path} website`,
      defaultRootObject: "index.html",
      defaultBehavior: {
        origin: new HttpOrigin(bucket.bucketWebsiteDomainName, {
          originPath: "",
          protocolPolicy: OriginProtocolPolicy.HTTP_ONLY,
          customHeaders: {
            Referer: props.refererId,
          },
        }),
        cachePolicy: CachePolicy.CACHING_OPTIMIZED,
        allowedMethods: AllowedMethods.ALLOW_GET_HEAD_OPTIONS,
        compress: true,
        viewerProtocolPolicy: ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
        responseHeadersPolicy: new ResponseHeadersPolicy(
          this,
          "ResponseSecurityHeaders",
          {
            securityHeadersBehavior: {
              contentSecurityPolicy: {
                contentSecurityPolicy: csp(props.contentSecurityPolicy),
                override: false,
              },
              contentTypeOptions: {
                override: false,
              },
              frameOptions: {
                frameOption:
                  props.securityHeaders?.frameOptions ??
                  HeadersFrameOption.SAMEORIGIN,
                override: false,
              },
              referrerPolicy: {
                referrerPolicy:
                  props.securityHeaders?.referrerPolicy ??
                  HeadersReferrerPolicy.NO_REFERRER,
                override: false,
              },
              strictTransportSecurity: {
                accessControlMaxAge: Duration.seconds(63072000),
                preload: true,
                includeSubdomains: true,
                override: false,
              },
              xssProtection: {
                protection: true,
                modeBlock: true,
                override: false,
              },
            },
          },
        ),
        functionAssociations,
      },
      errorResponses: [
        {
          httpStatus: 404,
          // CloudFront will automatically return 304 if the content was not modified.
          responseHttpStatus: 200,
          responsePagePath: "/index.html",
          ttl: Duration.days(365),
        },
      ],
      priceClass: PriceClass.PRICE_CLASS_100,
      certificate: toCertificate(this),
      domainNames: toDomainNames(),
      ...(props.logging ?? {}),
    });
    this.distribution = distribution;

    new BucketDeployment(this, "Deployment", {
      destinationBucket: bucket,
      distribution,
      sources: [props.source],
      memoryLimit: props.deploymentLambdaMemoryLimit ?? 10_240,
      ephemeralStorageSize:
        props.deploymentLambdaEphemeralStorageSize ?? Size.mebibytes(512),
    });

    if (props.domain != null && props.domain.createDnsRecords !== false) {
      const hostedZone = HostedZone.fromLookup(this, "HostedZone", {
        domainName: props.domain.name,
      });

      new ARecord(this, "NonWwwARecord", {
        target: RecordTarget.fromAlias(new CloudFrontTarget(distribution)),
        zone: hostedZone,
        recordName: props.domain.name,
      });

      new ARecord(this, "WwwARecord", {
        target: RecordTarget.fromAlias(new CloudFrontTarget(distribution)),
        zone: hostedZone,
        recordName: `www.${props.domain.name}`,
      });
    }

    function toRedirectCode() {
      if (props.domain == null) return undefined;
      if (props.domain.redirect === "enforceNonWww") {
        return `async function handler(event) {
                  if (event.request.headers.host.value.startsWith('www.')) {
                      return {
                          statusCode: 301,
                          statusDescription: 'Moved Permanently',
                          headers: {
                              "location": { "value": "https://" + event.request.headers.host.value.replace("www.", "") + event.request.uri },
                              "cache-control": { value: 'max-age=3600' }
                          }
                      };
                  }

                  return event.request;
              }`;
      }

      if (props.domain.redirect === "enforceWww") {
        return `async function handler(event) {
                  if (!event.request.headers.host.value.startsWith('www.')) {
                      return {
                          statusCode: 301,
                          statusDescription: 'Moved Permanently',
                          headers: {
                              "location": { "value": "https://www." + event.request.headers.host.value + event.request.uri },
                              "cache-control": { value: 'max-age=3600' }
                          }
                      };
                  }

                  return event.request;
              }`;
      }

      assertUnreachable(props.domain.redirect);
    }

    function toDomainNames() {
      if (props.domain == null) return undefined;

      return [props.domain.name, `www.${props.domain.name}`];
    }

    function toCertificate(scope: Construct) {
      if (props.domain == null) return undefined;
      if (typeof props.domain.certificate === "string") {
        return Certificate.fromCertificateArn(
          scope,
          "Certificate",
          props.domain.certificate,
        );
      }

      return props.domain.certificate;
    }
  }
}

/**
 * Recommended CSP header props.
 *
 * Use empty array to disable any of these directives.
 *
 * Test your CSP rules at https://csp-evaluator.withgoogle.com
 */
interface CspProps {
  readonly childSrc?: string[];
  readonly connectSrc?: string[];
  readonly defaultSrc?: string[];
  readonly fontSrc?: string[];
  readonly frameSrc?: string[];
  readonly imgSrc?: string[];
  readonly manifestSrc?: string[];
  readonly mediaSrc?: string[];
  readonly objectSrc?: string[];
  readonly prefetchSrc?: string[];
  readonly scriptSrc?: string[];
  readonly scriptSrcElem?: string[];
  readonly scriptSrcAttr?: string[];
  readonly styleSrc?: string[];
  readonly styleSrcElem?: string[];
  readonly styleSrcAttr?: string[];
  readonly workerSrc?: string[];
  readonly baseUri?: string[];
  readonly sandbox?: string[];
  readonly formAction?: string[];
  readonly frameAncestors?: string[];
  readonly navigateTo?: string[];
  readonly reportTo?: string[];
  readonly requireTrustedTypesFor?: string[];
  readonly trustedTypes?: string[];
  readonly upgradeInsecureRequests?: boolean;
}

function csp(props: CspProps): string {
  const defaultSrc = props.defaultSrc ?? [`'self'`];
  const scriptSrc = props.scriptSrc ?? [`'self'`];
  const imgSrc = props.imgSrc ?? [`'self'`, "data:"];
  const styleSrc = props.styleSrc ?? [
    `'self'`,
    `'unsafe-inline'`,
    "fonts.googleapis.com",
  ];
  const fontSrc = props.fontSrc ?? [`'self'`, "fonts.gstatic.com"];

  // By default, disallow any API calls.
  const connectSrc = props.connectSrc ?? [`'none'`];

  // By default, make sure every innerHTML call is trusted & sanitized.
  const requireTrustedTypesFor = props.requireTrustedTypesFor ?? [`'script'`];

  // By default, do not allow the page to be framed.
  const frameAncestors = props.frameAncestors ?? [`'none'`];

  // By default, disable browser's build-in <Form> submit.
  const formAction = props.formAction ?? [`'none'`];

  // By default, make sure base tag can point only to the same origin.
  const baseUri = props.baseUri ?? [`'self'`];

  // By default, disable legacy HTML elements like <object>, <embed> and <applet>.
  const objectSrc = props.objectSrc ?? [`'none'`];

  // By default, disable non-HTTPs requests.
  const upgradeInsecureRequests = props.upgradeInsecureRequests ?? true;

  const has = (value: string[] | undefined): value is string[] => {
    return value != null && value.length > 0;
  };

  return [
    has(props.childSrc) && `child-src ${props.childSrc.join(" ")}`,
    has(connectSrc) && `connect-src ${connectSrc.join(" ")}`,
    has(defaultSrc) && `default-src ${defaultSrc.join(" ")}`,
    has(fontSrc) && `font-src ${fontSrc.join(" ")}`,
    has(props.frameSrc) && `frame-src ${props.frameSrc.join(" ")}`,
    has(imgSrc) && `img-src ${imgSrc.join(" ")}`,
    has(props.manifestSrc) && `manifest-src ${props.manifestSrc.join(" ")}`,
    has(props.mediaSrc) && `media-src ${props.mediaSrc.join(" ")}`,
    has(objectSrc) && `object-src ${objectSrc.join(" ")}`,
    has(props.prefetchSrc) && `prefetch-src ${props.prefetchSrc.join(" ")}`,
    has(scriptSrc) && `script-src ${scriptSrc.join(" ")}`,
    has(props.scriptSrcElem) &&
      `script-src-elem ${props.scriptSrcElem.join(" ")}`,
    has(props.scriptSrcAttr) &&
      `script-src-attr ${props.scriptSrcAttr.join(" ")}`,
    has(styleSrc) && `style-src ${styleSrc.join(" ")}`,
    has(props.styleSrcElem) && `style-src-elem ${props.styleSrcElem.join(" ")}`,
    has(props.styleSrcAttr) && `style-src-attr ${props.styleSrcAttr.join(" ")}`,
    has(props.workerSrc) && `worker-src ${props.workerSrc.join(" ")}`,
    has(baseUri) && `base-uri ${baseUri.join(" ")}`,
    has(props.sandbox) && `sandbox ${props.sandbox.join(" ")}`,
    has(formAction) && `form-action ${formAction.join(" ")}`,
    has(frameAncestors) && `frame-ancestors ${frameAncestors.join(" ")}`,
    has(props.navigateTo) && `navigate-to ${props.navigateTo.join(" ")}`,
    has(props.reportTo) && `report-to ${props.reportTo.join(" ")}`,
    has(requireTrustedTypesFor) &&
      `require-trusted-types-for ${requireTrustedTypesFor.join(" ")}`,
    has(props.trustedTypes) && `trusted-types ${props.trustedTypes.join(" ")}`,
    upgradeInsecureRequests && "upgrade-insecure-requests",
  ]
    .filter(Boolean)
    .join(";");
}
