import { RemovalPolicy } from "aws-cdk-lib";
import {
  AttributeType,
  Billing,
  ProjectionType,
  TableEncryptionV2,
  TableV2,
} from "aws-cdk-lib/aws-dynamodb";
import type { IKey } from "aws-cdk-lib/aws-kms";
import type { Function } from "aws-cdk-lib/aws-lambda";
import { Construct } from "constructs";

export class ActionTokens extends Construct {
  private table: TableV2;
  private indexName = "valueGsi";

  constructor(
    scope: Construct,
    id: string,
    props: {
      readonly removalPolicy?: RemovalPolicy;
      /**
       * @default true when removalPolicy is RETAIN (or unset), false otherwise
       */
      readonly deletionProtection?: boolean;
      /**
       * @default true when deletionProtection is true, false otherwise
       */
      readonly pointInTimeRecoveryEnabled?: boolean;
      /**
       * Optional KMS key for server-side encryption of the DynamoDB table.
       * When provided, uses customer-managed encryption instead of AWS-managed.
       */
      readonly encryptionKey?: IKey;
      /**
       * Enable CloudWatch Contributor Insights on the table.
       * Helps detect access pattern anomalies such as hot partition keys.
       *
       * @default false
       */
      readonly contributorInsights?: boolean;
    } = {},
  ) {
    super(scope, id);

    const removalPolicy = props.removalPolicy ?? RemovalPolicy.RETAIN;
    const deletionProtection = props.deletionProtection ?? removalPolicy === RemovalPolicy.RETAIN;
    const pointInTimeRecoveryEnabled = props.pointInTimeRecoveryEnabled ?? deletionProtection;

    this.table = new TableV2(this, "ActionTokens", {
      partitionKey: {
        name: "owner",
        type: AttributeType.STRING,
      },
      sortKey: {
        name: "action",
        type: AttributeType.STRING,
      },
      billing: Billing.onDemand(),
      deletionProtection,
      encryption: props.encryptionKey
        ? TableEncryptionV2.customerManagedKey(props.encryptionKey)
        : TableEncryptionV2.awsManagedKey(),
      removalPolicy,
      timeToLiveAttribute: "expiresAt",
      pointInTimeRecoverySpecification: pointInTimeRecoveryEnabled
        ? { pointInTimeRecoveryEnabled }
        : undefined,
      contributorInsightsSpecification: props.contributorInsights ? { enabled: true } : undefined,
    });

    this.table.addGlobalSecondaryIndex({
      indexName: this.indexName,
      partitionKey: {
        name: "value",
        type: AttributeType.STRING,
      },
      sortKey: {
        name: "action",
        type: AttributeType.STRING,
      },
      projectionType: ProjectionType.ALL,
    });
  }

  readonly grantAccess = (grantee: Function) => {
    this.table.grantReadWriteData(grantee);

    grantee.addEnvironment("BEESOLVE_ACTION_TOKENS_TABLE_NAME", this.table.tableName);
    grantee.addEnvironment("BEESOLVE_ACTION_TOKENS_INDEX_NAME", this.indexName);
  };
}
