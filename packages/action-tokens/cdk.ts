import { RemovalPolicy } from "aws-cdk-lib";
import {
  AttributeType,
  Billing,
  ProjectionType,
  TableEncryptionV2,
  TableV2,
} from "aws-cdk-lib/aws-dynamodb";
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
      readonly deletionProtection?: boolean;
      /**
       * @default false
       */
      readonly pointInTimeRecoveryEnabled?: boolean;
    } = {},
  ) {
    super(scope, id);

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
      deletionProtection: props.deletionProtection ?? false,
      encryption: TableEncryptionV2.awsManagedKey(),
      removalPolicy: props.removalPolicy ?? RemovalPolicy.RETAIN,
      timeToLiveAttribute: "expiresAt",
      pointInTimeRecoverySpecification: props.pointInTimeRecoveryEnabled
        ? {
            pointInTimeRecoveryEnabled: props.pointInTimeRecoveryEnabled,
          }
        : undefined,
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

    grantee.addEnvironment(
      "BEESOLVE_ACTION_TOKENS_TABLE_NAME",
      this.table.tableName,
    );
    grantee.addEnvironment("BEESOLVE_ACTION_TOKENS_INDEX_NAME", this.indexName);
  };
}
