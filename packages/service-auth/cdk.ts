import { fileURLToPath } from "node:url";

import { ActionTokens } from "@beesolve/action-tokens/cdk";
import { Nodejs24Function } from "@beesolve/cdk-constructs";
import type { EmailAlarms } from "@beesolve/cdk-email-alarms";
import type { LambdaKeepActive } from "@beesolve/lambda-keep-active";
import { SqsHandler } from "@beesolve/sqs-handler/cdk";
import { Annotations, Duration, RemovalPolicy } from "aws-cdk-lib";
import { CfnStage, HttpApi, HttpMethod } from "aws-cdk-lib/aws-apigatewayv2";
import { HttpLambdaAuthorizer } from "aws-cdk-lib/aws-apigatewayv2-authorizers";
import { HttpLambdaIntegration } from "aws-cdk-lib/aws-apigatewayv2-integrations";
import {
  AllowedMethods,
  type BehaviorOptions,
  CachePolicy,
  FunctionUrlOriginAccessControl,
  type IOrigin,
  LambdaEdgeEventType,
  OriginRequestPolicy,
  ViewerProtocolPolicy,
  experimental,
} from "aws-cdk-lib/aws-cloudfront";
import { FunctionUrlOrigin } from "aws-cdk-lib/aws-cloudfront-origins";
import {
  AttributeType,
  Billing,
  ProjectionType,
  TableEncryptionV2,
  TableV2,
} from "aws-cdk-lib/aws-dynamodb";
import { EventBus } from "aws-cdk-lib/aws-events";
import type { IKey } from "aws-cdk-lib/aws-kms";
import {
  Architecture,
  Code,
  type Function,
  type FunctionUrl,
  FunctionUrlAuthType,
  InvokeMode,
  Runtime,
} from "aws-cdk-lib/aws-lambda";
import { LogGroup, type LogGroupProps, RetentionDays } from "aws-cdk-lib/aws-logs";
import { CfnRuleGroup } from "aws-cdk-lib/aws-wafv2";
import { Construct } from "constructs";

const distDir = `${fileURLToPath(new URL(".", import.meta.url))}`;

export class Auth extends Construct {
  /**
   * Unauthorized endpoint which should be used for unauthorized actions:
   * - signInRequest
   * - signInComplete
   * - signOut
   */
  readonly authUrl: FunctionUrl;

  /**
   * HttpApi which contains authorized endpoints
   */
  readonly api: HttpApi;

  /**
   * Intentionally private to prevent attaching it to a different HttpApi
   * without also granting the required DynamoDB table permissions.
   * Promote to `readonly` if multi-API use is needed in the future.
   */
  private readonly authorizer: HttpLambdaAuthorizer;
  private readonly sdkHandler: Function;

  /**
   * WAF rule group for rate limiting auth endpoints. Only set when `waf` prop
   * is provided. Add this to your existing WebACL as a rule group reference,
   * or create a new WebACL with it. See docs/waf.md for usage examples.
   */
  readonly wafRuleGroup?: CfnRuleGroup;

  /**
   * CloudFront behavior options for the auth function URL.
   * Add this as a behavior in your CloudFront distribution for the `/auth/*` path.
   * Includes OAC-signed origin and Lambda@Edge for POST body hashing.
   *
   * IMPORTANT: When using this across stacks, prefer `createAuthBehavior()` instead
   * to avoid CloudFormation cross-stack export issues with Lambda@Edge versions.
   */
  readonly authBehavior: BehaviorOptions;

  /**
   * OAC-signed origin for the auth function URL.
   * Use with `createAuthBehavior()` when creating the behavior in a different stack.
   */
  readonly authOrigin: IOrigin;

  /**
   * Path to the edgeBodyHash asset zip.
   * Use with `createAuthBehavior()` when the distribution lives in a different stack.
   */
  readonly edgeBodyHashAssetPath: string;

  constructor(
    scope: Construct,
    id: string,
    props: {
      readonly stage: string;
      readonly frontendUri: string;
      readonly allowSignUp: boolean;
      readonly alarms?: EmailAlarms;
      readonly eventBusArn?: string;
      readonly warmer?: LambdaKeepActive;
      /**
       * EventBridge source for all auth events.
       *
       * @default "beesolve.auth.api"
       */
      readonly eventSource?: string;
      /**
       * When true, the auth handler reads the __Host-DataToken cookie on sign-in
       * and fires a DataToken EventBridge event with the accountId and token value.
       *
       * @default false
       */
      readonly dataToken?: boolean;
      /**
       * How long sessions remain valid after creation.
       *
       * @default Duration.days(30)
       */
      readonly sessionDuration?: Duration;
      /**
       * Controls how long API Gateway caches authorizer decisions.
       *
       * Presets:
       * - `"immediate"` — no cache (0s). Sign-out takes effect instantly.
       * - `"balanced"` — short cache (45s). Sign-out effective within ~45s.
       * - `"relaxed"` — long cache (1h). Lowest cost, sign-out delayed up to 1h.
       *
       * Or pass a `Duration` directly to override presets.
       *
       * @default "balanced"
       */
      readonly authorizerCache?: "immediate" | "balanced" | "relaxed" | Duration;
      /**
       * How long the OTP email code is valid for sign-in.
       *
       * @default Duration.minutes(10)
       */
      readonly otpExpiry?: Duration;
      /**
       * Sessions younger than this are not rotated on authorizer refresh,
       * preventing churn on back-to-back requests.
       *
       * @default Duration.seconds(15)
       */
      readonly sessionRefreshDrift?: Duration;
      /**
       * Adjusts logging for Lambda functions.
       *
       * @default
       *
       * {
       *   removalPolicy: RemovalPolicy.DESTROY,
       *   retention: RetentionDays.TWO_WEEKS
       * }
       */
      readonly logGroupProps?: LogGroupProps;
      /**
       * Optional WAF configuration for rate limiting on the auth function URL.
       * Creates a WebACL with a rate-based rule. Disabled by default due to
       * additional cost. The WebACL must be attached to your CloudFront
       * distribution manually (WAF for CloudFront requires us-east-1).
       *
       * @default undefined (no WAF)
       */
      readonly waf?: {
        /**
         * Maximum requests per IP in a 5-minute window.
         * @default 100
         */
        readonly rateLimit?: number;
      };
      /**
       * Optional KMS key for server-side encryption of all data-at-rest resources
       * (DynamoDB tables and SQS queues). When provided, uses customer-managed
       * encryption instead of AWS-managed/SQS-managed encryption.
       */
      readonly encryptionKey?: IKey;
      /**
       * Enable CloudWatch Contributor Insights on DynamoDB tables.
       * Helps detect access pattern anomalies such as hot partition keys.
       *
       * @default true when stage is "prod"
       */
      readonly contributorInsights?: boolean;
      /**
       * Enable access logging on the HTTP API (API Gateway).
       * Creates a CloudWatch Log Group for request/response audit trails.
       *
       * @default true when stage is "prod"
       */
      readonly accessLogging?: boolean;
      /**
       * Reserved concurrent executions for the authorizer Lambda.
       * Caps concurrency to prevent a traffic spike from exhausting the
       * account-wide Lambda concurrency pool.
       *
       * @default undefined (no reservation)
       */
      readonly authorizerReservedConcurrency?: number;
      /**
       * Reserved concurrent executions for the SDK handler Lambda.
       * Caps concurrency to prevent a traffic spike from exhausting the
       * account-wide Lambda concurrency pool.
       *
       * @default undefined (no reservation)
       */
      readonly sdkHandlerReservedConcurrency?: number;
    },
  ) {
    super(scope, id);

    const isProd = props.stage === "prod";
    const deletionProtection = isProd;
    const removalPolicy: RemovalPolicy = isProd ? RemovalPolicy.RETAIN : RemovalPolicy.DESTROY;
    const contributorInsights = props.contributorInsights ?? isProd;

    const actionTokens = new ActionTokens(this, "ActionTokens", {
      deletionProtection,
      removalPolicy,
      pointInTimeRecoveryEnabled: isProd,
      encryptionKey: props.encryptionKey,
      contributorInsights,
    });

    const eventBus = props.eventBusArn
      ? EventBus.fromEventBusArn(this, "CustomEventBus", props.eventBusArn)
      : EventBus.fromEventBusName(this, "DefaultEventBus", "default");

    const sessionsTable = new TableV2(this, "Sessions", {
      partitionKey: {
        name: "id",
        type: AttributeType.STRING,
      },
      billing: Billing.onDemand(),
      deletionProtection,
      encryption: props.encryptionKey
        ? TableEncryptionV2.customerManagedKey(props.encryptionKey)
        : TableEncryptionV2.awsManagedKey(),
      removalPolicy,
      timeToLiveAttribute: "expiresAt",
      pointInTimeRecoverySpecification: {
        pointInTimeRecoveryEnabled: isProd,
      },
      contributorInsightsSpecification: contributorInsights ? { enabled: true } : undefined,
    });
    const sessionsByUserIdIndexName = "userIdGsi";
    sessionsTable.addGlobalSecondaryIndex({
      indexName: sessionsByUserIdIndexName,
      partitionKey: {
        name: "userId",
        type: AttributeType.STRING,
      },
      sortKey: {
        name: "id",
        type: AttributeType.STRING,
      },
      projectionType: ProjectionType.KEYS_ONLY,
    });

    const accountsTable = new TableV2(this, "Accounts", {
      partitionKey: {
        name: "id",
        type: AttributeType.STRING,
      },
      sortKey: {
        name: "username",
        type: AttributeType.STRING,
      },
      billing: Billing.onDemand(),
      deletionProtection,
      encryption: props.encryptionKey
        ? TableEncryptionV2.customerManagedKey(props.encryptionKey)
        : TableEncryptionV2.awsManagedKey(),
      removalPolicy,
      pointInTimeRecoverySpecification: {
        pointInTimeRecoveryEnabled: isProd,
      },
      contributorInsightsSpecification: contributorInsights ? { enabled: true } : undefined,
    });
    const accountsReverseIndexName = "reverseGsi";
    accountsTable.addGlobalSecondaryIndex({
      indexName: accountsReverseIndexName,
      partitionKey: {
        name: "username",
        type: AttributeType.STRING,
      },
      sortKey: {
        name: "id",
        type: AttributeType.STRING,
      },
      projectionType: ProjectionType.ALL,
    });

    const apiAuthorizer = new Nodejs24Function(this, "ApiAuthorizerHandler", {
      description: "API authorizer",
      entry: `${distDir}authorizer.zip`,
      handler: "authorizer.handler",
      memorySize: 256,
      timeout: Duration.seconds(5),
      reservedConcurrentExecutions: props.authorizerReservedConcurrency,
      environment: {
        SESSIONS_TABLE_NAME: sessionsTable.tableName,
        SESSIONS_USER_ID_INDEX_NAME: sessionsByUserIdIndexName,
        SESSION_MAX_AGE: String(
          Math.round((props.sessionDuration ?? Duration.days(30)).toSeconds()),
        ),
        SESSION_REFRESH_DRIFT: String(
          Math.round((props.sessionRefreshDrift ?? Duration.seconds(15)).toMilliseconds()),
        ),
      },
      logGroupProps: props.logGroupProps,
    });
    sessionsTable.grantReadWriteData(apiAuthorizer);
    props.alarms?.reportLambdaErrors(apiAuthorizer);
    props.warmer?.keepActive(apiAuthorizer);

    this.authorizer = new HttpLambdaAuthorizer("ApiAuthorizer", apiAuthorizer, {
      identitySource: ["$request.header.Cookie"],
      resultsCacheTtl: resolveAuthorizerCacheTtl(props.authorizerCache),
    });

    const accessLogging = props.accessLogging ?? isProd;

    this.api = new HttpApi(this, "Api", {
      apiName: `${this.node.path}/api`,
      description: "API",
    });

    if (accessLogging) {
      const accessLogGroup = new LogGroup(this, "ApiAccessLogs", {
        retention: RetentionDays.ONE_MONTH,
        removalPolicy: RemovalPolicy.DESTROY,
      });
      const stage = this.api.defaultStage!.node.defaultChild as CfnStage;
      stage.accessLogSettings = {
        destinationArn: accessLogGroup.logGroupArn,
        format: JSON.stringify({
          requestId: "$context.requestId",
          ip: "$context.identity.sourceIp",
          method: "$context.httpMethod",
          path: "$context.path",
          status: "$context.status",
          responseLength: "$context.responseLength",
          latency: "$context.responseLatency",
          time: "$context.requestTime",
        }),
      };
    }

    const authHandlerEnv: Record<string, string> = {
      STAGE: props.stage,
      SESSIONS_TABLE_NAME: sessionsTable.tableName,
      SESSIONS_USER_ID_INDEX_NAME: sessionsByUserIdIndexName,
      ACCOUNTS_TABLE_NAME: accountsTable.tableName,
      ACCOUNTS_REVERSE_INDEX_NAME: accountsReverseIndexName,
      EVENT_BUS_ARN: eventBus.eventBusArn,
      BASE_URI: props.frontendUri,
      ALLOW_SIGN_UP: String(props.allowSignUp),
      SESSION_MAX_AGE: String(Math.round((props.sessionDuration ?? Duration.days(30)).toSeconds())),
      OTP_EXPIRY: String(Math.round((props.otpExpiry ?? Duration.minutes(10)).toSeconds())),
    };
    if (props.eventSource != null) {
      authHandlerEnv["EVENT_SOURCE"] = props.eventSource;
    }
    if (props.dataToken === true) {
      authHandlerEnv["DATA_TOKEN"] = "true";
    }

    const authHandler = new Nodejs24Function(this, "AuthHandler", {
      entry: `${distDir}api.zip`,
      handler: "api.handler",
      memorySize: 1024,
      timeout: Duration.seconds(10),
      environment: authHandlerEnv,
      logGroupProps: props.logGroupProps,
    });
    sessionsTable.grantReadWriteData(authHandler);
    actionTokens.grantAccess(authHandler);
    accountsTable.grantReadWriteData(authHandler);
    eventBus.grantPutEventsTo(authHandler);
    props.alarms?.reportLambdaErrors(authHandler);
    props.warmer?.keepActive(authHandler);

    this.authUrl = authHandler.addFunctionUrl({
      authType: FunctionUrlAuthType.AWS_IAM,
      invokeMode: InvokeMode.BUFFERED,
    });

    this.edgeBodyHashAssetPath = `${distDir}edgeBodyHash.zip`;

    const oac = new FunctionUrlOriginAccessControl(this, "AuthOAC");
    this.authOrigin = FunctionUrlOrigin.withOriginAccessControl(this.authUrl, {
      originAccessControl: oac,
    });

    // Edge function in same construct — safe when distribution is in the same stack.
    const edgeBodyHash = new experimental.EdgeFunction(this, "EdgeBodyHash", {
      runtime: Runtime.NODEJS_24_X,
      architecture: Architecture.X86_64,
      handler: "edgeBodyHash.handler",
      code: Code.fromAsset(this.edgeBodyHashAssetPath),
      description: "Computes x-amz-content-sha256 for OAC SigV4 signing",
    });

    this.authBehavior = {
      origin: this.authOrigin,
      allowedMethods: AllowedMethods.ALLOW_ALL,
      cachePolicy: CachePolicy.CACHING_DISABLED,
      originRequestPolicy: OriginRequestPolicy.ALL_VIEWER_EXCEPT_HOST_HEADER,
      viewerProtocolPolicy: ViewerProtocolPolicy.HTTPS_ONLY,
      edgeLambdas: [
        {
          functionVersion: edgeBodyHash.currentVersion,
          eventType: LambdaEdgeEventType.ORIGIN_REQUEST,
          includeBody: true,
        },
      ],
    };

    const sqsHandler = new SqsHandler(this, "Tasks", {
      handlerProps: {
        entry: `${distDir}tasks.zip`,
        handler: "tasks.handler",
        memorySize: 256,
        timeout: Duration.seconds(10),
        environment: {
          SESSIONS_TABLE_NAME: sessionsTable.tableName,
          SESSIONS_USER_ID_INDEX_NAME: sessionsByUserIdIndexName,
        },
        logGroupProps: props.logGroupProps,
      },
      alarms: props.alarms,
      encryptionKey: props.encryptionKey,
    });
    sqsHandler.forEachHandler((h) => sessionsTable.grantReadWriteData(h));
    sqsHandler.grantAccess(authHandler);

    const sdkHandler = new Nodejs24Function(this, "SdkHandler", {
      description: "SDK authorizer",
      entry: `${distDir}sdkHandler.zip`,
      handler: "sdkHandler.handler",
      memorySize: 256,
      timeout: Duration.seconds(5),
      reservedConcurrentExecutions: props.sdkHandlerReservedConcurrency,
      environment: {
        SESSIONS_TABLE_NAME: sessionsTable.tableName,
        SESSIONS_USER_ID_INDEX_NAME: sessionsByUserIdIndexName,
        ACCOUNTS_TABLE_NAME: accountsTable.tableName,
        ACCOUNTS_REVERSE_INDEX_NAME: accountsReverseIndexName,
      },
      logGroupProps: props.logGroupProps,
    });
    sessionsTable.grantReadWriteData(sdkHandler);
    accountsTable.grantReadWriteData(sdkHandler);
    props.alarms?.reportLambdaErrors(sdkHandler);
    props.warmer?.keepActive(sdkHandler);

    this.sdkHandler = sdkHandler;

    if (!props.alarms) {
      Annotations.of(this).addWarningV2(
        "@beesolve/auth-service:noAlarms",
        "No alarms configured. DLQ messages (failed session invalidations) will go unnoticed. Pass `alarms` to enable monitoring.",
      );
    }

    if (props.waf) {
      this.wafRuleGroup = new CfnRuleGroup(this, "WafRuleGroup", {
        capacity: 2,
        scope: "CLOUDFRONT",
        visibilityConfig: {
          cloudWatchMetricsEnabled: true,
          metricName: `${this.node.path}/waf/auth-rate-limit`,
          sampledRequestsEnabled: true,
        },
        rules: [
          {
            name: "AuthRateLimit",
            priority: 1,
            action: { block: {} },
            visibilityConfig: {
              cloudWatchMetricsEnabled: true,
              metricName: `${this.node.path}/waf/auth-rate-limit-rule`,
              sampledRequestsEnabled: true,
            },
            statement: {
              rateBasedStatement: {
                limit: props.waf.rateLimit ?? 100,
                aggregateKeyType: "IP",
              },
            },
          },
        ],
      });
    }
  }

  /**
   * Creates auth behavior options with the edge function scoped to the provided construct.
   * Use this when the CloudFront distribution lives in a different stack than the Auth construct
   * to avoid CloudFormation cross-stack export issues with Lambda@Edge version ARNs.
   */
  readonly createAuthBehavior = (scope: Construct): BehaviorOptions => {
    const edgeBodyHash = new experimental.EdgeFunction(scope, "AuthEdgeBodyHash", {
      runtime: Runtime.NODEJS_24_X,
      architecture: Architecture.X86_64,
      handler: "edgeBodyHash.handler",
      code: Code.fromAsset(this.edgeBodyHashAssetPath),
      description: "Computes x-amz-content-sha256 for OAC SigV4 signing",
    });

    return {
      origin: this.authOrigin,
      allowedMethods: AllowedMethods.ALLOW_ALL,
      cachePolicy: CachePolicy.CACHING_DISABLED,
      originRequestPolicy: OriginRequestPolicy.ALL_VIEWER_EXCEPT_HOST_HEADER,
      viewerProtocolPolicy: ViewerProtocolPolicy.HTTPS_ONLY,
      edgeLambdas: [
        {
          functionVersion: edgeBodyHash.currentVersion,
          eventType: LambdaEdgeEventType.ORIGIN_REQUEST,
          includeBody: true,
        },
      ],
    };
  };

  /**
   * Adds provided Lambda function behind API Gateway with authorizer.
   */
  readonly addAuthorizedEndpoint = (props: {
    /**
     * Lambda function handling APIV1 requests
     */
    lambda: Function;
    /**
     * Proxy path for your function (optional)
     * @default "/api/{proxy+}"
     */
    path?: string;
    /**
     * Methods which will be handled by this endpoint (optional)
     * @default [HttpMethod.ANY]
     */
    methods?: HttpMethod[];
  }) => {
    this.api.addRoutes({
      integration: new HttpLambdaIntegration(props.path ?? "ApiIntegration", props.lambda),
      path: props.path ?? "/api/{proxy+}",
      methods: props.methods ?? [HttpMethod.ANY],
      authorizer: this.authorizer,
    });
  };

  readonly grantSdkAccess = (handler: Function) => {
    this.sdkHandler.grantInvoke(handler);
    handler.addEnvironment("BEESOLVE_AUTH_SDK_HANDLER_ARN", this.sdkHandler.functionArn);
  };
}

function resolveAuthorizerCacheTtl(
  cache: "immediate" | "balanced" | "relaxed" | Duration = "balanced",
): Duration {
  if (cache instanceof Duration) return cache;
  const presets = {
    immediate: Duration.seconds(0),
    balanced: Duration.seconds(45),
    relaxed: Duration.hours(1),
  };
  return presets[cache];
}
