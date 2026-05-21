import { fileURLToPath } from "node:url";
import { ActionTokens } from "@beesolve/action-tokens/cdk";
import { Nodejs24Function } from "@beesolve/cdk-constructs";
import type { EmailAlarms } from "@beesolve/cdk-email-alarms";
import type { LambdaKeepActive } from "@beesolve/lambda-keep-active";
import { Duration, RemovalPolicy } from "aws-cdk-lib";
import { HttpApi, HttpMethod } from "aws-cdk-lib/aws-apigatewayv2";
import { HttpLambdaAuthorizer } from "aws-cdk-lib/aws-apigatewayv2-authorizers";
import { HttpLambdaIntegration } from "aws-cdk-lib/aws-apigatewayv2-integrations";
import {
  AttributeType,
  Billing,
  ProjectionType,
  TableEncryptionV2,
  TableV2,
} from "aws-cdk-lib/aws-dynamodb";
import { EventBus } from "aws-cdk-lib/aws-events";
import type { LogGroupProps } from "aws-cdk-lib/aws-logs";
import {
  Function,
  FunctionUrl,
  FunctionUrlAuthType,
  InvokeMode,
  HttpMethod as LambdaHttpMethod,
} from "aws-cdk-lib/aws-lambda";
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
       * How long the API Gateway caches authorizer results.
       * Set to Duration.seconds(0) to disable caching.
       *
       * @default Duration.hours(1)
       */
      readonly authorizerCacheTtl?: Duration;
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
    },
  ) {
    super(scope, id);

    const isProd = props.stage === "prod";
    const deletionProtection = isProd;
    const removalPolicy: RemovalPolicy = isProd
      ? RemovalPolicy.RETAIN
      : RemovalPolicy.DESTROY;

    const actionTokens = new ActionTokens(this, "ActionTokens", {
      deletionProtection,
      removalPolicy,
      pointInTimeRecoveryEnabled: isProd,
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
      encryption: TableEncryptionV2.awsManagedKey(),
      removalPolicy,
      timeToLiveAttribute: "expiresAt",
      pointInTimeRecoverySpecification: {
        pointInTimeRecoveryEnabled: isProd,
      },
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
      encryption: TableEncryptionV2.awsManagedKey(),
      removalPolicy,
      pointInTimeRecoverySpecification: {
        pointInTimeRecoveryEnabled: isProd,
      },
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
      environment: {
        SESSIONS_TABLE_NAME: sessionsTable.tableName,
        SESSIONS_USER_ID_INDEX_NAME: sessionsByUserIdIndexName,
        SESSION_MAX_AGE: String(
          Math.round((props.sessionDuration ?? Duration.days(30)).toSeconds()),
        ),
        SESSION_REFRESH_DRIFT: String(
          Math.round(
            (
              props.sessionRefreshDrift ?? Duration.seconds(15)
            ).toMilliseconds(),
          ),
        ),
      },
      logGroupProps: props.logGroupProps,
    });
    sessionsTable.grantReadWriteData(apiAuthorizer);
    props.alarms?.reportLambdaErrors(apiAuthorizer);
    props.warmer?.keepActive(apiAuthorizer);

    this.authorizer = new HttpLambdaAuthorizer("ApiAuthorizer", apiAuthorizer, {
      identitySource: ["$request.header.Cookie"],
      resultsCacheTtl: props.authorizerCacheTtl ?? Duration.hours(1),
    });

    this.api = new HttpApi(this, "Api", {
      apiName: `${this.node.path}/api`,
      description: "API",
    });

    const authHandlerEnv: Record<string, string> = {
      STAGE: props.stage,
      SESSIONS_TABLE_NAME: sessionsTable.tableName,
      SESSIONS_USER_ID_INDEX_NAME: sessionsByUserIdIndexName,
      ACCOUNTS_TABLE_NAME: accountsTable.tableName,
      ACCOUNTS_REVERSE_INDEX_NAME: accountsReverseIndexName,
      EVENT_BUS_ARN: eventBus.eventBusArn,
      BASE_URI: props.frontendUri,
      ALLOW_SIGN_UP: String(props.allowSignUp),
      SESSION_MAX_AGE: String(
        Math.round((props.sessionDuration ?? Duration.days(30)).toSeconds()),
      ),
      OTP_EXPIRY: String(
        Math.round((props.otpExpiry ?? Duration.minutes(10)).toSeconds()),
      ),
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
      authType: FunctionUrlAuthType.NONE,
      cors: {
        allowedOrigins: ["*"],
        allowedMethods: [LambdaHttpMethod.POST],
        allowedHeaders: ["*"],
      },
      invokeMode: InvokeMode.BUFFERED,
    });

    const sdkHandler = new Nodejs24Function(this, "SdkHandler", {
      description: "SDK authorizer",
      entry: `${distDir}sdkHandler.zip`,
      handler: "sdkHandler.handler",
      memorySize: 256,
      timeout: Duration.seconds(5),
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
  }

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
      integration: new HttpLambdaIntegration(
        props.path ?? "ApiIntegration",
        props.lambda,
      ),
      path: props.path ?? "/api/{proxy+}",
      methods: props.methods ?? [HttpMethod.ANY],
      authorizer: this.authorizer,
    });
  };

  readonly grantSdkAccess = (handler: Function) => {
    this.sdkHandler.grantInvoke(handler);
    handler.addEnvironment(
      "BEESOLVE_AUTH_SDK_HANDLER_ARN",
      this.sdkHandler.functionArn,
    );
  };
}
