import { fileURLToPath } from "node:url";

import { Nodejs24Function } from "@beesolve/cdk-constructs";
import { LambdaKeepActive } from "@beesolve/lambda-keep-active";
import { Duration, RemovalPolicy, Stack } from "aws-cdk-lib";
import { Rule } from "aws-cdk-lib/aws-events";
import { LambdaFunction } from "aws-cdk-lib/aws-events-targets";
import { Effect, PolicyStatement, ServicePrincipal } from "aws-cdk-lib/aws-iam";
import type { FunctionOptions } from "aws-cdk-lib/aws-lambda";
import { BlockPublicAccess, Bucket, BucketEncryption } from "aws-cdk-lib/aws-s3";
import { ReceiptRule, ReceiptRuleSet, TlsPolicy } from "aws-cdk-lib/aws-ses";
import { S3 } from "aws-cdk-lib/aws-ses-actions";
import {
  AwsCustomResource,
  AwsCustomResourcePolicy,
  PhysicalResourceId,
} from "aws-cdk-lib/custom-resources";
import { Construct } from "constructs";

export interface DmarcReportsProps {
  /** The email address that receives DMARC aggregate reports. */
  readonly recipient: string;
  /** Target EventBridge bus ARN. Defaults to the account's default bus. */
  readonly eventBusArn?: string;
  /** Override Lambda function properties (memorySize, timeout). */
  readonly handlerProps?: Pick<FunctionOptions, "memorySize" | "timeout">;
}

export class DmarcReports extends Construct {
  readonly bucket: Bucket;

  constructor(scope: Construct, id: string, props: DmarcReportsProps) {
    super(scope, id);

    const { region, account } = Stack.of(this);

    const eventBusArn =
      props.eventBusArn ?? `arn:aws:events:${region}:${account}:event-bus/default`;

    this.bucket = new Bucket(this, "ReportsBucket", {
      blockPublicAccess: BlockPublicAccess.BLOCK_ALL,
      encryption: BucketEncryption.S3_MANAGED,
      enforceSSL: true,
      eventBridgeEnabled: true,
      lifecycleRules: [
        {
          expiration: Duration.days(90),
          abortIncompleteMultipartUploadAfter: Duration.days(1),
        },
      ],
      removalPolicy: RemovalPolicy.DESTROY,
      autoDeleteObjects: true,
    });

    this.bucket.addToResourcePolicy(
      new PolicyStatement({
        sid: "AllowSESPuts",
        effect: Effect.ALLOW,
        principals: [new ServicePrincipal("ses.amazonaws.com")],
        actions: ["s3:PutObject"],
        resources: [this.bucket.arnForObjects("inbox/*")],
      }),
    );

    const ruleSet = new ReceiptRuleSet(this, "RuleSet");

    new ReceiptRule(this, "ReceiptRule", {
      ruleSet,
      recipients: [props.recipient],
      scanEnabled: true,
      tlsPolicy: TlsPolicy.REQUIRE,
      actions: [
        new S3({
          bucket: this.bucket,
          objectKeyPrefix: "inbox/",
        }),
      ],
    });

    new AwsCustomResource(this, "ActivateRuleSet", {
      onCreate: {
        service: "SES",
        action: "setActiveReceiptRuleSet",
        parameters: { RuleSetName: ruleSet.receiptRuleSetName },
        physicalResourceId: PhysicalResourceId.of("ActivateRuleSet"),
      },
      onDelete: {
        service: "SES",
        action: "setActiveReceiptRuleSet",
        parameters: {},
      },
      policy: AwsCustomResourcePolicy.fromStatements([
        new PolicyStatement({
          effect: Effect.ALLOW,
          actions: ["ses:SetActiveReceiptRuleSet"],
          resources: ["*"],
        }),
      ]),
      installLatestAwsSdk: false,
    });

    const handler = new Nodejs24Function(this, "Handler", {
      description: "DMARC report parser — processes emails from S3 and emits parsed events",
      entry: `${fileURLToPath(new URL(".", import.meta.url))}dist/handler/`,
      handler: "handler.handler",
      memorySize: props.handlerProps?.memorySize ?? 256,
      timeout: props.handlerProps?.timeout ?? Duration.seconds(30),
      environment: {
        EVENT_BUS_ARN: eventBusArn,
      },
    });

    this.bucket.grantRead(handler);

    handler.addToRolePolicy(
      new PolicyStatement({
        effect: Effect.ALLOW,
        actions: ["events:PutEvents"],
        resources: [eventBusArn],
      }),
    );

    new Rule(this, "S3ObjectCreatedRule", {
      eventPattern: {
        source: ["aws.s3"],
        detailType: ["Object Created"],
        detail: {
          bucket: { name: [this.bucket.bucketName] },
        },
      },
      targets: [new LambdaFunction(handler)],
    });

    const keepActive = new LambdaKeepActive(this, "KeepActive");
    keepActive.keepActive(handler);
  }
}
