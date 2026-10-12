import { fileURLToPath } from "node:url";

import { Nodejs24Function } from "@beesolve/cdk-constructs";
import { Duration, RemovalPolicy } from "aws-cdk-lib";
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
   * Number of top paths retained per period before the rest collapse into a
   * single `__other__` bucket.
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

  constructor(scope: Construct, id: string, props: AnalyticsProcessorProps) {
    super(scope, id);

    const topPaths = props.topPaths ?? defaultTopPaths;
    const hourlyTtlDays = props.hourlyTtlDays ?? defaultHourlyTtlDays;
    const processingLagHours = props.processingLagHours ?? defaultProcessingLagHours;
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

    const builtDir = fileURLToPath(new URL(".", import.meta.url));

    const hourly = new Nodejs24Function(this, "Hourly", {
      description: "CloudFront analytics hourly processor — Athena query to DynamoDB totals",
      entry: `${builtDir}hourly/`,
      handler: "hourly.handler",
      memorySize,
      timeout,
      environment: {
        ...sharedEnvironment,
        ATHENA_DATABASE: props.athenaDatabase,
        ATHENA_V2_TABLE: props.athenaV2Table,
        ATHENA_WORKGROUP: props.athenaWorkgroup,
        ...(props.athenaOutputLocation != null
          ? { ATHENA_OUTPUT_LOCATION: props.athenaOutputLocation }
          : {}),
        ...(props.ipInfoApiKey != null ? { IPINFO_API_KEY: props.ipInfoApiKey } : {}),
      },
    });

    this.table.grantReadWriteData(hourly);

    hourly.addToRolePolicy(
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

    hourly.addToRolePolicy(
      new PolicyStatement({
        effect: Effect.ALLOW,
        actions: ["glue:GetTable", "glue:GetDatabase", "glue:GetPartitions"],
        resources: ["*"],
      }),
    );

    hourly.addToRolePolicy(
      new PolicyStatement({
        effect: Effect.ALLOW,
        actions: ["s3:GetObject", "s3:ListBucket", "s3:GetBucketLocation"],
        resources: [props.logBucketArn, `${props.logBucketArn}/*`],
      }),
    );

    if (props.athenaResultsBucketArn != null) {
      hourly.addToRolePolicy(
        new PolicyStatement({
          effect: Effect.ALLOW,
          actions: ["s3:PutObject", "s3:GetObject"],
          resources: [props.athenaResultsBucketArn, `${props.athenaResultsBucketArn}/*`],
        }),
      );
    }

    const dailyRollup = new Nodejs24Function(this, "DailyRollup", {
      description: "CloudFront analytics daily rollup — sums hourly DynamoDB items",
      entry: `${builtDir}dailyRollup/`,
      handler: "dailyRollup.handler",
      memorySize,
      timeout,
      environment: sharedEnvironment,
    });

    this.table.grantReadWriteData(dailyRollup);

    const monthlyRollup = new Nodejs24Function(this, "MonthlyRollup", {
      description: "CloudFront analytics monthly rollup — sums daily DynamoDB items",
      entry: `${builtDir}monthlyRollup/`,
      handler: "monthlyRollup.handler",
      memorySize,
      timeout,
      environment: sharedEnvironment,
    });

    this.table.grantReadWriteData(monthlyRollup);

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
  }

  grantRead(handler: LambdaFunction): void {
    this.table.grantReadData(handler);
    handler.addEnvironment("ANALYTICS_TABLE_NAME", this.table.tableName);
    handler.addEnvironment("ANALYTICS_REVERSE_INDEX", this.reverseIndexName);
  }
}
