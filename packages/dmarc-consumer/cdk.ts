import { fileURLToPath } from "node:url";

import { Nodejs24Function, SqsWithDlq } from "@beesolve/cdk-constructs";
import { detailType, eventSource, statsDetailType } from "@beesolve/dmarc-reports";
import { Duration, RemovalPolicy } from "aws-cdk-lib";
import { AttributeType, Billing, ProjectionType, TableV2 } from "aws-cdk-lib/aws-dynamodb";
import { Rule } from "aws-cdk-lib/aws-events";
import { SqsQueue } from "aws-cdk-lib/aws-events-targets";
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
}

export class DmarcConsumer extends Construct {
  readonly table: TableV2;
  readonly reverseIndexName = "reverse";

  grantReadWrite(handler: LambdaFunction): void {
    this.table.grantReadWriteData(handler);
    handler.addEnvironment("TABLE_NAME", this.table.tableName);
    handler.addEnvironment("REVERSE_INDEX_NAME", this.reverseIndexName);
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
      },
    });

    this.table.grantWriteData(consumer);

    const { queue } = SqsWithDlq.asLambdaInput({ lambda: consumer });

    new Rule(this, "EventRule", {
      eventPattern: {
        source: [eventSource],
        detailType: [detailType, statsDetailType],
      },
      targets: [new SqsQueue(queue)],
    });
  }
}
