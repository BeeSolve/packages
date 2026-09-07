import { fileURLToPath } from "node:url";

import { Nodejs24Function, SqsWithDlq } from "@beesolve/cdk-constructs";
import { detailType, eventSource, statsDetailType } from "@beesolve/dmarc-reports";
import { SqsHandler } from "@beesolve/sqs-handler/cdk";
import { Duration, RemovalPolicy } from "aws-cdk-lib";
import { AttributeType, Billing, ProjectionType, TableV2 } from "aws-cdk-lib/aws-dynamodb";
import { Rule, Schedule } from "aws-cdk-lib/aws-events";
import { LambdaFunction as LambdaFunctionTarget, SqsQueue } from "aws-cdk-lib/aws-events-targets";
import type { Function as LambdaFunction, FunctionOptions } from "aws-cdk-lib/aws-lambda";
import { Construct } from "constructs";

export interface DmarcConsumerProps {
  /**
   * Override Lambda function properties (memorySize, timeout).
   * @default {memorySize: 256, timeout: Duration.seconds(30)}
   */
  readonly consumerProps?: Pick<FunctionOptions, "memorySize" | "timeout">;
  /**
   * Override DynamoDB table removal policy
   * @default RemovalPolicy.RETAIN
   */
  readonly removalPolicy?: RemovalPolicy;
  /**
   * Optional ipinfo.io Lite API key. When provided, the consumer enriches
   * source IPs (ASN + country) into a per-IP cache in the table. When omitted,
   * enrichment is skipped entirely.
   */
  readonly ipInfoApiKey?: string;
}

export class DmarcConsumer extends Construct {
  readonly table: TableV2;
  readonly reverseIndexName = "reverse";
  private readonly backfill: SqsHandler;

  grantReadWrite(handler: LambdaFunction): void {
    this.table.grantReadWriteData(handler);
    handler.addEnvironment("DMARC_TABLE_NAME", this.table.tableName);
    handler.addEnvironment("DMARC_REVERSE_INDEX", this.reverseIndexName);
  }

  grantBackfill(handler: LambdaFunction): void {
    this.backfill.grantAccess(handler);
    handler.addEnvironment("TABLE_NAME", this.table.tableName);
  }

  constructor(scope: Construct, id: string, props?: DmarcConsumerProps) {
    super(scope, id);

    this.table = new TableV2(this, "Table", {
      partitionKey: { name: "pk", type: AttributeType.STRING },
      sortKey: { name: "sk", type: AttributeType.STRING },
      billing: Billing.onDemand(),
      removalPolicy: props?.removalPolicy ?? RemovalPolicy.RETAIN,
      timeToLiveAttribute: "ttl",
    });

    this.table.addGlobalSecondaryIndex({
      indexName: this.reverseIndexName,
      partitionKey: { name: "sk", type: AttributeType.STRING },
      sortKey: { name: "pk", type: AttributeType.STRING },
      projectionType: ProjectionType.ALL,
    });

    const consumer = new Nodejs24Function(this, "Consumer", {
      description: "DMARC dashboard consumer — persists parsed reports to DynamoDB",
      entry: `${fileURLToPath(new URL(".", import.meta.url))}consumer/`,
      handler: "consumer.handler",
      memorySize: props?.consumerProps?.memorySize ?? 256,
      timeout: props?.consumerProps?.timeout ?? Duration.seconds(30),
      environment: {
        TABLE_NAME: this.table.tableName,
        REVERSE_INDEX_NAME: this.reverseIndexName,
        ...(props?.ipInfoApiKey != null ? { IPINFO_API_KEY: props.ipInfoApiKey } : {}),
      },
    });

    this.table.grantReadWriteData(consumer);

    const { queue } = SqsWithDlq.asLambdaInput({ lambda: consumer });

    new Rule(this, "EventRule", {
      eventPattern: {
        source: [eventSource],
        detailType: [detailType, statsDetailType],
      },
      targets: [new SqsQueue(queue)],
    });

    this.backfill = new SqsHandler(this, "Backfill", {
      handlerProps: {
        description: "DMARC backfill worker — enriches source IPs for existing reports",
        entry: `${fileURLToPath(new URL(".", import.meta.url))}tasks/`,
        handler: "tasks.handler",
        memorySize: 256,
        timeout: Duration.minutes(5),
        environment: {
          TABLE_NAME: this.table.tableName,
          REVERSE_INDEX_NAME: this.reverseIndexName,
          ...(props?.ipInfoApiKey != null ? { IPINFO_API_KEY: props.ipInfoApiKey } : {}),
        },
      },
    });

    this.backfill.forEachHandler((handler) => this.table.grantReadWriteData(handler));

    this.backfill.grantAccess(consumer);

    const dnsCron = new Nodejs24Function(this, "DnsCron", {
      description: "DMARC DNS refresh cron — enqueues DNS refresh tasks for stale domains",
      entry: `${fileURLToPath(new URL(".", import.meta.url))}dnsCron/`,
      handler: "dnsCron.handler",
      memorySize: 256,
      timeout: Duration.minutes(1),
      environment: {
        TABLE_NAME: this.table.tableName,
        REVERSE_INDEX_NAME: this.reverseIndexName,
      },
    });

    this.table.grantReadData(dnsCron);
    this.backfill.grantAccess(dnsCron);

    new Rule(this, "DnsCronSchedule", {
      schedule: Schedule.rate(Duration.days(1)),
      targets: [new LambdaFunctionTarget(dnsCron)],
    });
  }
}
