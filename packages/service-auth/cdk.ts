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
  Function as CloudFrontFunction,
  FunctionCode,
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
  type TableV2 as TableV2Type,
} from "aws-cdk-lib/aws-dynamodb";
import { EventBus, type IEventBus } from "aws-cdk-lib/aws-events";
import type { IKey } from "aws-cdk-lib/aws-kms";
import {
  Architecture,
  CfnPermission,
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

interface CoreProps {
  readonly stage: string;
  readonly frontendUri: string;
  readonly allowSignUp: boolean;
  readonly alarms?: EmailAlarms;
  readonly eventBusArn?: string;
  readonly warmer?: LambdaKeepActive;
  /**
   * Application identifier used to scope auth EventBridge events to this
   * deployment. When set, the event `source` becomes `beesolve.auth.<appId>`
   * (otherwise `beesolve.auth.api`), so consumers of another app sharing the
   * same event bus do not receive this app's events (e.g. a sign-in for one app
   * must not email a code for another).
   *
   * Consumers subscribe to the matching source via the construct's resolved
   * `eventSource` field.
   */
  readonly appId?: string;
  /** @default false */
  readonly dataToken?: boolean;
  /** @default Duration.days(30) */
  readonly sessionDuration?: Duration;
  /** @default Duration.minutes(10) */
  readonly otpExpiry?: Duration;
  /** @default Duration.seconds(60) */
  readonly resendCooldown?: Duration;
  /** @default true */
  readonly drainOnResend?: boolean;
  /** @default Duration.seconds(15) */
  readonly sessionRefreshDrift?: Duration;
  /**
   * Minimum time between session rotations. When the authorizer runs and the
   * current session record is younger than this interval, rotation is skipped.
   *
   * This is independent of authorizer cache — the authorizer can run on every
   * request, but the session is only rotated at this interval.
   *
   * @default Duration.hours(1)
   */
  readonly sessionRefreshInterval?: Duration;
  readonly logGroupProps?: LogGroupProps;
  readonly waf?: { readonly rateLimit?: number };
  readonly encryptionKey?: IKey;
  /** @default true when stage is "prod" */
  readonly contributorInsights?: boolean;
  readonly sdkHandlerReservedConcurrency?: number;
  /**
   * Maximum allowed impersonation session duration. SDK callers can request up
   * to this value; the SDK handler caps requests at this limit.
   *
   * @default Duration.hours(4)
   */
  readonly maxImpersonationDuration?: Duration;
  /** Relying Party ID for passkeys (typically the domain without port, e.g. "example.com"). When set, passkey endpoints are enabled. */
  readonly rpId?: string;
  /** Relying Party display name for passkeys. @default "Auth" */
  readonly rpName?: string;
}

export class AuthGateway extends Construct {
  /**
   * Unauthorized endpoint for sign-in/sign-out actions.
   */
  readonly authUrl: FunctionUrl;

  /**
   * HttpApi which contains authorized endpoints.
   */
  readonly api: HttpApi;

  /**
   * WAF rule group for rate limiting auth endpoints. Only set when `waf` prop
   * is provided.
   */
  readonly wafRuleGroup?: CfnRuleGroup;

  /**
   * CloudFront behavior options for the auth function URL.
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

  /**
   * CloudFront Function that injects a placeholder `__Host-SID=anonym` cookie
   * on viewer requests when the cookie is absent.
   *
   * Attach this to the viewer-request event of your default behavior so that
   * API Gateway's `identitySource` requirement is always satisfied — enabling
   * SSR apps to use `addAuthorizedEndpoint` with authorizer caching.
   */
  readonly ensureCookieFunction: CloudFrontFunction;

  /**
   * Resolved EventBridge `source` used for auth events published by this
   * deployment. Consumers should subscribe to this exact value.
   */
  readonly eventSource: string;

  /**
   * The EventBridge bus this deployment publishes auth events to (the custom bus
   * when `eventBusArn` is set, otherwise the account `default` bus). Bind
   * consumer rules for auth events to this bus so they match regardless of which
   * bus the deployment uses.
   */
  readonly eventBus: IEventBus;

  private readonly authorizer: HttpLambdaAuthorizer;
  private readonly sdkHandler: Function;
  private readonly sessionsTable: TableV2Type;
  private readonly sessionsByUserIdIndexName: string;
  private readonly sessionMaxAge: string;
  private readonly sessionRefreshDrift: string;
  private readonly sessionRefreshInterval: string;

  constructor(
    scope: Construct,
    id: string,
    props: CoreProps & {
      /**
       * Controls how long API Gateway caches authorizer decisions.
       *
       * Presets:
       * - `"immediate"` — no cache (0s). Sign-out takes effect instantly.
       * - `"balanced"` — short cache (45s). Sign-out effective within ~45s.
       * - `"relaxed"` — long cache (1h). Lowest cost, sign-out delayed up to 1h.
       * - `"disabled"` — no cache AND no identity source. Required for SSR apps
       *   where requests without cookies must still reach the Lambda authorizer.
       *
       * Or pass a `Duration` directly to override presets.
       *
       * @default "balanced"
       */
      readonly authorizerCache?: "immediate" | "balanced" | "relaxed" | "disabled" | Duration;
      /**
       * Enable access logging on the HTTP API (API Gateway).
       *
       * @default true when stage is "prod"
       */
      readonly accessLogging?: boolean;
      /**
       * Reserved concurrent executions for the authorizer Lambda.
       *
       * @default undefined (no reservation)
       */
      readonly authorizerReservedConcurrency?: number;
    },
  ) {
    super(scope, id);

    const isProd = props.stage === "prod";
    const deletionProtection = isProd;
    const removalPolicy: RemovalPolicy = isProd ? RemovalPolicy.RETAIN : RemovalPolicy.DESTROY;
    const contributorInsights = props.contributorInsights ?? isProd;

    const sessionMaxAge = String(
      Math.round((props.sessionDuration ?? Duration.days(30)).toSeconds()),
    );
    const sessionRefreshDrift = String(
      Math.round((props.sessionRefreshDrift ?? Duration.seconds(15)).toMilliseconds()),
    );
    const sessionRefreshInterval = String(
      Math.round((props.sessionRefreshInterval ?? Duration.hours(1)).toMilliseconds()),
    );

    const tables = createTables(this, {
      deletionProtection,
      removalPolicy,
      encryptionKey: props.encryptionKey,
      contributorInsights,
      isProd,
    });

    this.sessionMaxAge = sessionMaxAge;
    this.sessionRefreshDrift = sessionRefreshDrift;
    this.sessionRefreshInterval = sessionRefreshInterval;
    this.sessionsTable = tables.sessionsTable;
    this.sessionsByUserIdIndexName = tables.sessionsByUserIdIndexName;

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

    this.eventSource = `beesolve.auth.${props.appId ?? "api"}`;
    this.eventBus = eventBus;

    const { authHandler, authUrl } = createAuthHandler(this, {
      ...tables,
      eventBus,
      eventSource: this.eventSource,
      actionTokens,
      coreProps: props,
      logGroupProps: props.logGroupProps,
      encryptionKey: props.encryptionKey,
      alarms: props.alarms,
      warmer: props.warmer,
    });

    this.authUrl = authUrl;

    const behaviorResources = createAuthBehaviorResources(this, { authUrl, authHandler });
    this.authOrigin = behaviorResources.authOrigin;
    this.authBehavior = behaviorResources.authBehavior;
    this.edgeBodyHashAssetPath = behaviorResources.edgeBodyHashAssetPath;

    this.ensureCookieFunction = createEnsureCookieFunction(this);

    const apiAuthorizer = new Nodejs24Function(this, "ApiAuthorizerHandler", {
      description: "API authorizer",
      entry: `${distDir}authorizer.zip`,
      handler: "authorizer.handler",
      memorySize: 256,
      timeout: Duration.seconds(5),
      reservedConcurrentExecutions: props.authorizerReservedConcurrency,
      environment: {
        SESSIONS_TABLE_NAME: tables.sessionsTable.tableName,
        SESSIONS_USER_ID_INDEX_NAME: tables.sessionsByUserIdIndexName,
        SESSION_MAX_AGE: sessionMaxAge,
        SESSION_REFRESH_DRIFT: sessionRefreshDrift,
        SESSION_REFRESH_INTERVAL: sessionRefreshInterval,
      },
      logGroupProps: props.logGroupProps,
    });
    tables.sessionsTable.grantReadWriteData(apiAuthorizer);
    props.alarms?.reportLambdaErrors(apiAuthorizer);
    props.warmer?.keepActive(apiAuthorizer);

    this.authorizer = new HttpLambdaAuthorizer("ApiAuthorizer", apiAuthorizer, {
      identitySource: props.authorizerCache === "disabled" ? [] : ["$request.header.Cookie"],
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

      const stage = this.api.defaultStage?.node.defaultChild;
      if (stage == null) throw Error(`Cannot set access logging - missing default stage.`);
      if (!(stage instanceof CfnStage))
        throw Error(`Cannot set access logging - stage not instance of CfnStage.`);

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

    const sdkHandler = createSdkHandler(this, {
      ...tables,
      eventBus,
      eventSource: this.eventSource,
      maxImpersonationDuration: props.maxImpersonationDuration,
      logGroupProps: props.logGroupProps,
      alarms: props.alarms,
      warmer: props.warmer,
      reservedConcurrency: props.sdkHandlerReservedConcurrency,
    });
    this.sdkHandler = sdkHandler;

    if (!props.alarms) {
      Annotations.of(this).addWarningV2(
        "@beesolve/auth-service:noAlarms",
        "No alarms configured. DLQ messages (failed session invalidations) will go unnoticed. Pass `alarms` to enable monitoring.",
      );
    }

    if (props.waf) {
      this.wafRuleGroup = createWafRuleGroup(this, props.waf.rateLimit ?? 100);
    }

    this.createAuthBehavior = makeCreateAuthBehavior(
      this.authOrigin,
      behaviorResources.edgeBodyHash,
    );
  }

  /**
   * Creates auth behavior options with the edge function scoped to the provided construct.
   * Use this when the CloudFront distribution lives in a different stack than the Auth construct
   * to avoid CloudFormation cross-stack export issues with Lambda@Edge version ARNs.
   */
  readonly createAuthBehavior: (scope: Construct) => BehaviorOptions;

  /**
   * Adds provided Lambda function behind API Gateway with authorizer.
   */
  readonly addAuthorizedEndpoint = (props: {
    /**
     * Lambda function handling API requests.
     */
    lambda: Function;
    /**
     * Proxy path for your function.
     * @default "/api/{proxy+}"
     */
    path?: string;
    /**
     * Methods which will be handled by this endpoint.
     * @default [HttpMethod.ANY]
     */
    methods?: Array<HttpMethod>;
  }) => {
    this.api.addRoutes({
      integration: new HttpLambdaIntegration(props.path ?? "ApiIntegration", props.lambda),
      path: props.path ?? "/api/{proxy+}",
      methods: props.methods ?? [HttpMethod.ANY],
      authorizer: this.authorizer,
    });
  };

  /**
   * Adds provided Lambda function behind API Gateway without authorizer.
   */
  readonly addPublicEndpoint = (props: {
    /**
     * Lambda function handling API requests.
     */
    lambda: Function;
    /**
     * Proxy path for your function.
     * @default "/{proxy+}"
     */
    path?: string;
    /**
     * Methods which will be handled by this endpoint.
     * @default [HttpMethod.ANY]
     */
    methods?: Array<HttpMethod>;
  }) => {
    this.api.addRoutes({
      integration: new HttpLambdaIntegration(props.path ?? "PublicIntegration", props.lambda),
      path: props.path ?? "/{proxy+}",
      methods: props.methods ?? [HttpMethod.ANY],
    });
  };

  /**
   * Grants a Lambda function direct access to the sessions table for
   * in-process session resolution via `createInProcessSessionHandle()`.
   *
   * Use this instead of `addAuthorizedEndpoint` for SSR apps where a single
   * Lambda invocation per request is preferred over the authorizer pattern.
   */
  readonly grantSessionAccess = (handler: Function) => {
    this.sessionsTable.grantReadWriteData(handler);
    handler.addEnvironment("BEESOLVE_AUTH_SESSIONS_TABLE_NAME", this.sessionsTable.tableName);
    handler.addEnvironment(
      "BEESOLVE_AUTH_SESSIONS_USER_ID_INDEX_NAME",
      this.sessionsByUserIdIndexName,
    );
    handler.addEnvironment("BEESOLVE_AUTH_SESSION_MAX_AGE", this.sessionMaxAge);
    handler.addEnvironment("BEESOLVE_AUTH_SESSION_REFRESH_DRIFT", this.sessionRefreshDrift);
    handler.addEnvironment("BEESOLVE_AUTH_SESSION_REFRESH_INTERVAL", this.sessionRefreshInterval);
  };

  readonly grantSdkAccess = (handler: Function) => {
    this.sdkHandler.grantInvoke(handler);
    handler.addEnvironment("BEESOLVE_AUTH_SDK_HANDLER_ARN", this.sdkHandler.functionArn);
  };
}

export class AuthService extends Construct {
  /**
   * Unauthorized endpoint for sign-in/sign-out actions.
   */
  readonly authUrl: FunctionUrl;

  /**
   * WAF rule group for rate limiting auth endpoints. Only set when `waf` prop
   * is provided.
   */
  readonly wafRuleGroup?: CfnRuleGroup;

  /**
   * CloudFront behavior options for the auth function URL.
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

  /**
   * CloudFront Function that injects a placeholder `__Host-SID=anonym` cookie
   * on viewer requests when the cookie is absent.
   *
   * Attach this to the viewer-request event of your default behavior so that
   * API Gateway's `identitySource` requirement is always satisfied — enabling
   * SSR apps to use `addAuthorizedEndpoint` with authorizer caching.
   */
  readonly ensureCookieFunction: CloudFrontFunction;

  /**
   * Resolved EventBridge `source` used for auth events published by this
   * deployment. Consumers should subscribe to this exact value.
   */
  readonly eventSource: string;

  /**
   * The EventBridge bus this deployment publishes auth events to (the custom bus
   * when `eventBusArn` is set, otherwise the account `default` bus). Bind
   * consumer rules for auth events to this bus so they match regardless of which
   * bus the deployment uses.
   */
  readonly eventBus: IEventBus;

  private readonly sessionsTable: TableV2Type;
  private readonly sessionsByUserIdIndexName: string;
  private readonly sessionMaxAge: string;
  private readonly sessionRefreshDrift: string;
  private readonly sessionRefreshInterval: string;
  private readonly sdkHandler: Function;

  constructor(scope: Construct, id: string, props: CoreProps) {
    super(scope, id);

    const isProd = props.stage === "prod";
    const deletionProtection = isProd;
    const removalPolicy: RemovalPolicy = isProd ? RemovalPolicy.RETAIN : RemovalPolicy.DESTROY;
    const contributorInsights = props.contributorInsights ?? isProd;

    this.sessionMaxAge = String(
      Math.round((props.sessionDuration ?? Duration.days(30)).toSeconds()),
    );
    this.sessionRefreshDrift = String(
      Math.round((props.sessionRefreshDrift ?? Duration.seconds(15)).toMilliseconds()),
    );
    this.sessionRefreshInterval = String(
      Math.round((props.sessionRefreshInterval ?? Duration.hours(1)).toMilliseconds()),
    );

    const tables = createTables(this, {
      deletionProtection,
      removalPolicy,
      encryptionKey: props.encryptionKey,
      contributorInsights,
      isProd,
    });
    this.sessionsTable = tables.sessionsTable;
    this.sessionsByUserIdIndexName = tables.sessionsByUserIdIndexName;

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

    this.eventSource = `beesolve.auth.${props.appId ?? "api"}`;
    this.eventBus = eventBus;

    const { authHandler, authUrl } = createAuthHandler(this, {
      ...tables,
      eventBus,
      eventSource: this.eventSource,
      actionTokens,
      coreProps: props,
      logGroupProps: props.logGroupProps,
      encryptionKey: props.encryptionKey,
      alarms: props.alarms,
      warmer: props.warmer,
    });

    this.authUrl = authUrl;

    const behaviorResources = createAuthBehaviorResources(this, { authUrl, authHandler });
    this.authOrigin = behaviorResources.authOrigin;
    this.authBehavior = behaviorResources.authBehavior;
    this.edgeBodyHashAssetPath = behaviorResources.edgeBodyHashAssetPath;

    this.ensureCookieFunction = createEnsureCookieFunction(this);

    const sdkHandler = createSdkHandler(this, {
      ...tables,
      eventBus,
      eventSource: this.eventSource,
      maxImpersonationDuration: props.maxImpersonationDuration,
      logGroupProps: props.logGroupProps,
      alarms: props.alarms,
      warmer: props.warmer,
      reservedConcurrency: props.sdkHandlerReservedConcurrency,
    });
    this.sdkHandler = sdkHandler;

    if (!props.alarms) {
      Annotations.of(this).addWarningV2(
        "@beesolve/auth-service:noAlarms",
        "No alarms configured. DLQ messages (failed session invalidations) will go unnoticed. Pass `alarms` to enable monitoring.",
      );
    }

    if (props.waf) {
      this.wafRuleGroup = createWafRuleGroup(this, props.waf.rateLimit ?? 100);
    }

    this.createAuthBehavior = makeCreateAuthBehavior(
      this.authOrigin,
      behaviorResources.edgeBodyHash,
    );
  }

  /**
   * Creates auth behavior options with the edge function scoped to the provided construct.
   * Use this when the CloudFront distribution lives in a different stack than the Auth construct
   * to avoid CloudFormation cross-stack export issues with Lambda@Edge version ARNs.
   */
  readonly createAuthBehavior: (scope: Construct) => BehaviorOptions;

  /**
   * Grants a Lambda function direct access to the sessions table for in-process
   * session verification and rotation via `SessionAuthorizer`.
   */
  readonly grantSessionAuthorizerAccess = (handler: Function) => {
    this.sessionsTable.grantReadWriteData(handler);
    handler.addEnvironment("BEESOLVE_AUTH_SESSIONS_TABLE_NAME", this.sessionsTable.tableName);
    handler.addEnvironment(
      "BEESOLVE_AUTH_SESSIONS_USER_ID_INDEX_NAME",
      this.sessionsByUserIdIndexName,
    );
    handler.addEnvironment("BEESOLVE_AUTH_SESSION_MAX_AGE", this.sessionMaxAge);
    handler.addEnvironment("BEESOLVE_AUTH_SESSION_REFRESH_DRIFT", this.sessionRefreshDrift);
    handler.addEnvironment("BEESOLVE_AUTH_SESSION_REFRESH_INTERVAL", this.sessionRefreshInterval);
  };

  readonly grantSdkAccess = (handler: Function) => {
    this.sdkHandler.grantInvoke(handler);
    handler.addEnvironment("BEESOLVE_AUTH_SDK_HANDLER_ARN", this.sdkHandler.functionArn);
  };
}

function createTables(
  scope: Construct,
  props: {
    deletionProtection: boolean;
    removalPolicy: RemovalPolicy;
    encryptionKey?: IKey;
    contributorInsights: boolean;
    isProd: boolean;
  },
) {
  const sessionsTable = new TableV2(scope, "Sessions", {
    partitionKey: { name: "id", type: AttributeType.STRING },
    billing: Billing.onDemand(),
    deletionProtection: props.deletionProtection,
    encryption: props.encryptionKey
      ? TableEncryptionV2.customerManagedKey(props.encryptionKey)
      : TableEncryptionV2.awsManagedKey(),
    removalPolicy: props.removalPolicy,
    timeToLiveAttribute: "expiresAt",
    pointInTimeRecoverySpecification: { pointInTimeRecoveryEnabled: props.isProd },
    contributorInsightsSpecification: props.contributorInsights ? { enabled: true } : undefined,
  });
  const sessionsByUserIdIndexName = "userIdGsi";
  sessionsTable.addGlobalSecondaryIndex({
    indexName: sessionsByUserIdIndexName,
    partitionKey: { name: "userId", type: AttributeType.STRING },
    sortKey: { name: "id", type: AttributeType.STRING },
    projectionType: ProjectionType.KEYS_ONLY,
  });

  const accountsTable = new TableV2(scope, "Accounts", {
    partitionKey: { name: "id", type: AttributeType.STRING },
    sortKey: { name: "username", type: AttributeType.STRING },
    billing: Billing.onDemand(),
    deletionProtection: props.deletionProtection,
    encryption: props.encryptionKey
      ? TableEncryptionV2.customerManagedKey(props.encryptionKey)
      : TableEncryptionV2.awsManagedKey(),
    removalPolicy: props.removalPolicy,
    pointInTimeRecoverySpecification: { pointInTimeRecoveryEnabled: props.isProd },
    contributorInsightsSpecification: props.contributorInsights ? { enabled: true } : undefined,
  });
  const accountsReverseIndexName = "reverseGsi";
  accountsTable.addGlobalSecondaryIndex({
    indexName: accountsReverseIndexName,
    partitionKey: { name: "username", type: AttributeType.STRING },
    sortKey: { name: "id", type: AttributeType.STRING },
    projectionType: ProjectionType.ALL,
  });

  return { sessionsTable, sessionsByUserIdIndexName, accountsTable, accountsReverseIndexName };
}

function createAuthHandler(
  scope: Construct,
  props: {
    sessionsTable: TableV2Type;
    sessionsByUserIdIndexName: string;
    accountsTable: TableV2Type;
    accountsReverseIndexName: string;
    eventBus: ReturnType<typeof EventBus.fromEventBusArn>;
    eventSource: string;
    actionTokens: ActionTokens;
    coreProps: CoreProps;
    logGroupProps?: LogGroupProps;
    encryptionKey?: IKey;
    alarms?: EmailAlarms;
    warmer?: LambdaKeepActive;
  },
) {
  const { coreProps } = props;
  const sessionMaxAge = String(
    Math.round((coreProps.sessionDuration ?? Duration.days(30)).toSeconds()),
  );

  const authHandlerEnv: Record<string, string> = {
    STAGE: coreProps.stage,
    SESSIONS_TABLE_NAME: props.sessionsTable.tableName,
    SESSIONS_USER_ID_INDEX_NAME: props.sessionsByUserIdIndexName,
    ACCOUNTS_TABLE_NAME: props.accountsTable.tableName,
    ACCOUNTS_REVERSE_INDEX_NAME: props.accountsReverseIndexName,
    EVENT_BUS_ARN: props.eventBus.eventBusArn,
    EVENT_SOURCE: props.eventSource,
    BASE_URI: coreProps.frontendUri,
    ALLOW_SIGN_UP: String(coreProps.allowSignUp),
    SESSION_MAX_AGE: sessionMaxAge,
    OTP_EXPIRY: String(Math.round((coreProps.otpExpiry ?? Duration.minutes(10)).toSeconds())),
    RESEND_COOLDOWN: String(
      Math.round((coreProps.resendCooldown ?? Duration.seconds(60)).toSeconds()),
    ),
    DRAIN_ON_RESEND: String(coreProps.drainOnResend ?? true),
  };
  if (coreProps.dataToken === true) {
    authHandlerEnv["DATA_TOKEN"] = "true";
  }
  if (coreProps.rpId != null) {
    authHandlerEnv["RP_ID"] = coreProps.rpId;
  }
  if (coreProps.rpName != null) {
    authHandlerEnv["RP_NAME"] = coreProps.rpName;
  }

  const authHandler = new Nodejs24Function(scope, "AuthHandler", {
    entry: `${distDir}api.zip`,
    handler: "api.handler",
    memorySize: 1024,
    timeout: Duration.seconds(10),
    environment: authHandlerEnv,
    logGroupProps: props.logGroupProps,
  });
  props.sessionsTable.grantReadWriteData(authHandler);
  props.actionTokens.grantAccess(authHandler);
  props.accountsTable.grantReadWriteData(authHandler);
  props.eventBus.grantPutEventsTo(authHandler);
  props.alarms?.reportLambdaErrors(authHandler);
  props.warmer?.keepActive(authHandler);

  const sqsHandler = new SqsHandler(scope, "Tasks", {
    handlerProps: {
      entry: `${distDir}tasks.zip`,
      handler: "tasks.handler",
      memorySize: 256,
      timeout: Duration.seconds(10),
      environment: {
        SESSIONS_TABLE_NAME: props.sessionsTable.tableName,
        SESSIONS_USER_ID_INDEX_NAME: props.sessionsByUserIdIndexName,
      },
      logGroupProps: props.logGroupProps,
    },
    alarms: props.alarms,
    encryptionKey: props.encryptionKey,
  });
  sqsHandler.forEachHandler((handler) => props.sessionsTable.grantReadWriteData(handler));
  sqsHandler.grantAccess(authHandler);

  const authUrl = authHandler.addFunctionUrl({
    authType: FunctionUrlAuthType.AWS_IAM,
    invokeMode: InvokeMode.BUFFERED,
  });

  return { authHandler, authUrl };
}

function createAuthBehaviorResources(
  scope: Construct,
  props: { authUrl: FunctionUrl; authHandler: Function },
) {
  const edgeBodyHashAssetPath = `${distDir}edgeBodyHash.zip`;

  const oac = new FunctionUrlOriginAccessControl(scope, "AuthOAC");
  const authOrigin = FunctionUrlOrigin.withOriginAccessControl(props.authUrl, {
    originAccessControl: oac,
  });

  // Since October 2025, AWS requires both lambda:InvokeFunctionUrl (added by
  // withOriginAccessControl above) AND lambda:InvokeFunction for Function URLs
  // with AWS_IAM auth. Pre-existing Function URLs are grandfathered, but any
  // newly created ones will fail with 403 without this second permission.
  new CfnPermission(scope, "AuthHandlerCloudFrontInvoke", {
    action: "lambda:InvokeFunction",
    functionName: props.authHandler.functionArn,
    principal: "cloudfront.amazonaws.com",
  });

  const edgeBodyHash = new experimental.EdgeFunction(scope, "EdgeBodyHash", {
    runtime: Runtime.NODEJS_24_X,
    architecture: Architecture.X86_64,
    handler: "edgeBodyHash.handler",
    code: Code.fromAsset(edgeBodyHashAssetPath),
    description: "Computes x-amz-content-sha256 for OAC SigV4 signing",
  });

  const authBehavior: BehaviorOptions = {
    origin: authOrigin,
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

  return { authOrigin, authBehavior, edgeBodyHashAssetPath, edgeBodyHash };
}

function createSdkHandler(
  scope: Construct,
  props: {
    sessionsTable: TableV2Type;
    sessionsByUserIdIndexName: string;
    accountsTable: TableV2Type;
    accountsReverseIndexName: string;
    eventBus: IEventBus;
    eventSource: string;
    maxImpersonationDuration?: Duration;
    logGroupProps?: LogGroupProps;
    alarms?: EmailAlarms;
    warmer?: LambdaKeepActive;
    reservedConcurrency?: number;
  },
) {
  const sdkHandler = new Nodejs24Function(scope, "SdkHandler", {
    description: "SDK handler",
    entry: `${distDir}sdkHandler.zip`,
    handler: "sdkHandler.handler",
    memorySize: 256,
    timeout: Duration.seconds(5),
    reservedConcurrentExecutions: props.reservedConcurrency,
    environment: {
      SESSIONS_TABLE_NAME: props.sessionsTable.tableName,
      SESSIONS_USER_ID_INDEX_NAME: props.sessionsByUserIdIndexName,
      ACCOUNTS_TABLE_NAME: props.accountsTable.tableName,
      ACCOUNTS_REVERSE_INDEX_NAME: props.accountsReverseIndexName,
      EVENT_BUS_ARN: props.eventBus.eventBusArn,
      EVENT_SOURCE: props.eventSource,
      MAX_IMPERSONATION_DURATION: String(
        Math.floor((props.maxImpersonationDuration ?? Duration.hours(4)).toSeconds()),
      ),
    },
    logGroupProps: props.logGroupProps,
  });
  props.sessionsTable.grantReadWriteData(sdkHandler);
  props.accountsTable.grantReadWriteData(sdkHandler);
  props.eventBus.grantPutEventsTo(sdkHandler);
  props.alarms?.reportLambdaErrors(sdkHandler);
  props.warmer?.keepActive(sdkHandler);

  return sdkHandler;
}

function createWafRuleGroup(scope: Construct, rateLimit: number) {
  return new CfnRuleGroup(scope, "WafRuleGroup", {
    capacity: 2,
    scope: "CLOUDFRONT",
    visibilityConfig: {
      cloudWatchMetricsEnabled: true,
      metricName: `${scope.node.path}/waf/auth-rate-limit`,
      sampledRequestsEnabled: true,
    },
    rules: [
      {
        name: "AuthRateLimit",
        priority: 1,
        action: { block: {} },
        visibilityConfig: {
          cloudWatchMetricsEnabled: true,
          metricName: `${scope.node.path}/waf/auth-rate-limit-rule`,
          sampledRequestsEnabled: true,
        },
        statement: {
          rateBasedStatement: {
            limit: rateLimit,
            aggregateKeyType: "IP",
          },
        },
      },
    ],
  });
}

function makeCreateAuthBehavior(authOrigin: IOrigin, edgeBodyHash: experimental.EdgeFunction) {
  return (_scope: Construct): BehaviorOptions => {
    return {
      origin: authOrigin,
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
}

function resolveAuthorizerCacheTtl(
  cache: "immediate" | "balanced" | "relaxed" | "disabled" | Duration = "balanced",
): Duration {
  if (cache instanceof Duration) return cache;
  const presets = {
    immediate: Duration.seconds(0),
    balanced: Duration.seconds(45),
    relaxed: Duration.hours(1),
    disabled: Duration.seconds(0),
  };
  return presets[cache];
}

function createEnsureCookieFunction(scope: Construct): CloudFrontFunction {
  return new CloudFrontFunction(scope, "EnsureCookieFunction", {
    comment: "Injects placeholder __Host-SID cookie when absent for authorizer identity source",
    code: FunctionCode.fromInline(`\
function handler(event) {
  var request = event.request;
  if (!request.cookies['__Host-SID']) {
    request.cookies['__Host-SID'] = { value: 'anonym' };
  }
  return request;
}`),
  });
}
