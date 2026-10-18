import { fileURLToPath } from "node:url";

import { Nodejs24Function } from "@beesolve/cdk-constructs";
import { CfnOutput, Duration, RemovalPolicy, Stack } from "aws-cdk-lib";
import { AttributeType, Billing, ProjectionType, TableV2 } from "aws-cdk-lib/aws-dynamodb";
import { Rule, Schedule } from "aws-cdk-lib/aws-events";
import { LambdaFunction as LambdaFunctionTarget } from "aws-cdk-lib/aws-events-targets";
import { Effect, PolicyStatement } from "aws-cdk-lib/aws-iam";
import type { Function as LambdaFunction, FunctionOptions } from "aws-cdk-lib/aws-lambda";
import { Construct } from "constructs";

export interface AnalyticsProcessorProps {
  readonly athenaDatabase: string;
  readonly athenaV2Table: string;
  readonly athenaV1Table?: string;
  readonly athenaWorkgroup: string;
  readonly athenaOutputLocation?: string;
  readonly logBucketArn: string;
  readonly athenaResultsBucketArn?: string;
  readonly ipInfoApiKey?: string;
  /**
   * Maximum number of top IP rows retained per hour to resolve into the country
   * breakdown.
   * @default 100
   */
  readonly topPaths?: number;
  /**
   * TTL in days for hourly totals, breakdowns, and markers.
   * @default 90
   */
  readonly hourlyTtlDays?: number;
  /**
   * Hours to lag the hourly schedule behind wall-clock so v2 delivery has
   * settled before an hour is processed.
   * @default 2
   */
  readonly processingLagHours?: number;
  /**
   * DynamoDB table removal policy.
   * @default RemovalPolicy.RETAIN
   */
  readonly removalPolicy?: RemovalPolicy;
  /**
   * Override Lambda function properties (memorySize, timeout) for the three
   * processing functions.
   * @default {memorySize: 256, timeout: Duration.minutes(5)}
   */
  readonly processorProps?: Pick<FunctionOptions, "memorySize" | "timeout">;
}

const defaultTopPaths = 100;
const defaultHourlyTtlDays = 90;
const defaultProcessingLagHours = 2;

export class AnalyticsProcessor extends Construct {
  readonly table: TableV2;
  readonly reverseIndexName = "reverse";
  readonly processingLagHours: number;
  readonly hourlyTtlDays: number;
  readonly topPaths: number;

  private readonly sdkHandler: LambdaFunction;

  constructor(scope: Construct, id: string, props: AnalyticsProcessorProps) {
    super(scope, id);

    const topPaths = props.topPaths ?? defaultTopPaths;
    const hourlyTtlDays = props.hourlyTtlDays ?? defaultHourlyTtlDays;
    const processingLagHours = props.processingLagHours ?? defaultProcessingLagHours;
    this.hourlyTtlDays = hourlyTtlDays;
    this.processingLagHours = processingLagHours;
    this.topPaths = topPaths;
    const memorySize = props.processorProps?.memorySize ?? 256;
    const timeout = props.processorProps?.timeout ?? Duration.minutes(5);

    this.table = new TableV2(this, "Table", {
      partitionKey: { name: "pk", type: AttributeType.STRING },
      sortKey: { name: "sk", type: AttributeType.STRING },
      billing: Billing.onDemand(),
      removalPolicy: props.removalPolicy ?? RemovalPolicy.RETAIN,
      timeToLiveAttribute: "ttl",
    });

    this.table.addGlobalSecondaryIndex({
      indexName: this.reverseIndexName,
      partitionKey: { name: "sk", type: AttributeType.STRING },
      sortKey: { name: "pk", type: AttributeType.STRING },
      projectionType: ProjectionType.ALL,
    });

    const sharedEnvironment: Record<string, string> = {
      TABLE_NAME: this.table.tableName,
      REVERSE_INDEX_NAME: this.reverseIndexName,
      HOURLY_TTL_DAYS: hourlyTtlDays.toString(),
      TOP_PATHS: topPaths.toString(),
      PROCESSING_LAG_HOURS: processingLagHours.toString(),
    };

    const athenaEnvironment: Record<string, string> = {
      ATHENA_DATABASE: props.athenaDatabase,
      ATHENA_V2_TABLE: props.athenaV2Table,
      ATHENA_WORKGROUP: props.athenaWorkgroup,
      ...(props.athenaOutputLocation != null
        ? { ATHENA_OUTPUT_LOCATION: props.athenaOutputLocation }
        : {}),
    };

    const grantAthena = (fn: LambdaFunction): void => {
      fn.addToRolePolicy(
        new PolicyStatement({
          effect: Effect.ALLOW,
          actions: [
            "athena:StartQueryExecution",
            "athena:GetQueryExecution",
            "athena:GetQueryResults",
            "athena:StopQueryExecution",
          ],
          resources: ["*"],
        }),
      );

      fn.addToRolePolicy(
        new PolicyStatement({
          effect: Effect.ALLOW,
          actions: ["glue:GetTable", "glue:GetDatabase", "glue:GetPartitions"],
          resources: ["*"],
        }),
      );

      fn.addToRolePolicy(
        new PolicyStatement({
          effect: Effect.ALLOW,
          actions: ["s3:GetObject", "s3:ListBucket", "s3:GetBucketLocation"],
          resources: [props.logBucketArn, `${props.logBucketArn}/*`],
        }),
      );

      if (props.athenaResultsBucketArn != null) {
        fn.addToRolePolicy(
          new PolicyStatement({
            effect: Effect.ALLOW,
            // Athena verifies the results bucket (GetBucketLocation/ListBucket) before
            // writing query output; PutObject/GetObject alone cause a startQueryExecution
            // failure with "Unable to verify/create output bucket" / INSUFFICIENT_PERMISSIONS.
            actions: ["s3:PutObject", "s3:GetObject", "s3:GetBucketLocation", "s3:ListBucket"],
            resources: [props.athenaResultsBucketArn, `${props.athenaResultsBucketArn}/*`],
          }),
        );
      }
    };

    const builtDir = fileURLToPath(new URL(".", import.meta.url));

    const hourly = new Nodejs24Function(this, "Hourly", {
      description: "CloudFront analytics hourly processor — Athena query to DynamoDB totals",
      entry: `${builtDir}hourly/`,
      handler: "hourly.handler",
      memorySize,
      timeout,
      environment: {
        ...sharedEnvironment,
        ...athenaEnvironment,
        ...(props.ipInfoApiKey != null ? { IPINFO_API_KEY: props.ipInfoApiKey } : {}),
      },
    });

    this.table.grantReadWriteData(hourly);
    grantAthena(hourly);

    const dailyRollup = new Nodejs24Function(this, "DailyRollup", {
      description: "CloudFront analytics daily rollup — sums hourly items, URL directory, uniques",
      entry: `${builtDir}dailyRollup/`,
      handler: "dailyRollup.handler",
      memorySize,
      timeout,
      environment: {
        ...sharedEnvironment,
        ...athenaEnvironment,
      },
    });

    this.table.grantReadWriteData(dailyRollup);
    grantAthena(dailyRollup);

    const monthlyRollup = new Nodejs24Function(this, "MonthlyRollup", {
      description: "CloudFront analytics monthly rollup — sums daily items, month uniques",
      entry: `${builtDir}monthlyRollup/`,
      handler: "monthlyRollup.handler",
      memorySize,
      timeout,
      environment: {
        ...sharedEnvironment,
        ...athenaEnvironment,
      },
    });

    this.table.grantReadWriteData(monthlyRollup);
    grantAthena(monthlyRollup);

    const sdk = new Nodejs24Function(this, "Sdk", {
      description: "CloudFront analytics SDK handler — privileged writes to the analytics table",
      entry: `${builtDir}sdkHandler/`,
      handler: "sdkHandler.handler",
      memorySize,
      timeout,
      environment: {
        TABLE_NAME: this.table.tableName,
        REVERSE_INDEX_NAME: this.reverseIndexName,
      },
    });

    this.table.grantReadWriteData(sdk);
    this.sdkHandler = sdk;

    new Rule(this, "HourlySchedule", {
      schedule: Schedule.rate(Duration.hours(1)),
      targets: [new LambdaFunctionTarget(hourly)],
    });

    new Rule(this, "DailyRollupSchedule", {
      schedule: Schedule.cron({ minute: "15", hour: "0" }),
      targets: [new LambdaFunctionTarget(dailyRollup)],
    });

    new Rule(this, "MonthlyRollupSchedule", {
      schedule: Schedule.cron({ minute: "30", hour: "1", day: "1" }),
      targets: [new LambdaFunctionTarget(monthlyRollup)],
    });

    this.publishConfigOutputs(props);
  }

  /**
   * Publish the resolved processor configuration as CloudFormation outputs with
   * stable keys, so the shipped operational CLIs (`analytics-backfill`,
   * `analytics-watch-backfill`, `analytics-compact`) can resolve everything they
   * need from `--stack <name>` via DescribeStacks instead of requiring the
   * caller to pass each value as an environment variable.
   */
  private publishConfigOutputs(props: AnalyticsProcessorProps): void {
    const stack = Stack.of(this);

    const outputs: Record<string, string | undefined> = {
      AnalyticsTableName: this.table.tableName,
      AnalyticsReverseIndexName: this.reverseIndexName,
      AnalyticsAthenaDatabase: props.athenaDatabase,
      AnalyticsAthenaTable: props.athenaV2Table,
      AnalyticsAthenaV1Table: props.athenaV1Table,
      AnalyticsAthenaWorkgroup: props.athenaWorkgroup,
      AnalyticsAthenaOutputLocation: props.athenaOutputLocation,
      AnalyticsTopPaths: this.topPaths.toString(),
      AnalyticsHourlyTtlDays: this.hourlyTtlDays.toString(),
    };

    for (const [key, value] of Object.entries(outputs)) {
      if (value == null) continue;
      new CfnOutput(stack, `${this.node.id}${key}`, { key, value });
    }
  }

  grantAccess(handler: LambdaFunction): void {
    this.table.grantReadData(handler);
    handler.addEnvironment("ANALYTICS_TABLE_NAME", this.table.tableName);
    handler.addEnvironment("ANALYTICS_REVERSE_INDEX", this.reverseIndexName);
    this.sdkHandler.grantInvoke(handler);
    handler.addEnvironment("BEESOLVE_ANALYTICS_SDK_HANDLER_ARN", this.sdkHandler.functionArn);
    handler.addEnvironment("ANALYTICS_PROCESSING_LAG_HOURS", this.processingLagHours.toString());
    handler.addEnvironment("ANALYTICS_HOURLY_TTL_DAYS", this.hourlyTtlDays.toString());
  }
}
