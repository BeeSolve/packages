import { Nodejs24Function, SqsWithDlq } from "@beesolve/cdk-constructs";
import { Duration, RemovalPolicy } from "aws-cdk-lib";
import {
  AttributeType,
  Billing,
  TableEncryptionV2,
  TableV2,
} from "aws-cdk-lib/aws-dynamodb";
import { EventBus } from "aws-cdk-lib/aws-events";
import type { LogGroupProps } from "aws-cdk-lib/aws-events-targets";
import { Effect, PolicyStatement } from "aws-cdk-lib/aws-iam";
import { type Function, type FunctionOptions } from "aws-cdk-lib/aws-lambda";
import { RetentionDays } from "aws-cdk-lib/aws-logs";
import {
  BlockPublicAccess,
  Bucket,
  BucketAccessControl,
  BucketEncryption,
} from "aws-cdk-lib/aws-s3";
import {
  ConfigurationSet,
  ConfigurationSetEventDestination,
  EmailSendingEvent,
  EventDestination,
} from "aws-cdk-lib/aws-ses";
import { Queue } from "aws-cdk-lib/aws-sqs";
import { Construct } from "constructs";
import { fileURLToPath } from "node:url";

export class Emails extends Construct {
  private table: TableV2;
  private queue: Queue;
  private bucket: Bucket;

  constructor(
    scope: Construct,
    id: string,
    props: {
      readonly defaultSender: {
        readonly name: string;
        readonly emailAddress: string;
      };
      /**
       * Set this if you want to set specific SES identity which will be used to send emails.
       */
      readonly fromArn?: string;
      readonly defaultConfigurationSet?: ConfigurationSet;
      /**
       * Set this if you want to track other than default events.
       *
       * @default new Set([EmailSendingEvent.SEND, EmailSendingEvent.BOUNCE, EmailSendingEvent.COMPLAINT, EmailSendingEvent.DELIVERY, EmailSendingEvent.REJECT])
       */
      readonly eventsToTrack?: Set<EmailSendingEvent>;
      readonly isProd?: boolean;
      readonly removalPolicy?: RemovalPolicy;
      /**
       * Adjusts logging for SQS handler.
       *
       * @default
       *
       * {
       *   removalPolicy: RemovalPolicy.DESTROY,
       *   retention: RetentionDays.TWO_WEEKS
       * }
       */
      readonly logGroupProps?: LogGroupProps;
      readonly deletionProtection?: boolean;
      /**
       * How long should the attachments be stored in S3 bucket before they are deleted.
       *
       * @default 180
       */
      readonly attachmentsRetentionDays?: number;
      /**
       * How long should the messages be stored in DyanmoDB before they are deleted.
       *
       * If set to 0, messages are not being persisted to DynamoDB.
       *
       * @default 14
       */
      readonly messagesRetentionDays?: number;
      /**
       * Event bus which  notifications about sent emails are emitted to.
       *
       * @default "default"
       */
      readonly eventBusName?: string;
      /**
       * @default
       * {
       *     memorySize: 256,
       *     timeout: Duration.seconds(30),
       *     reservedConcurrentExecutions: 2
       * }
       */
      readonly handler?: Pick<
        FunctionOptions,
        "memorySize" | "timeout" | "reservedConcurrentExecutions"
      >;
    },
  ) {
    super(scope, id);

    const {
      isProd = false,
      attachmentsRetentionDays = 180,
      messagesRetentionDays = 14,
      eventBusName = "default",
      defaultConfigurationSet = new ConfigurationSet(
        this,
        "DefaultConfigurationSet",
      ),
      eventsToTrack = new Set([
        EmailSendingEvent.SEND,
        EmailSendingEvent.BOUNCE,
        EmailSendingEvent.COMPLAINT,
        EmailSendingEvent.DELIVERY,
        EmailSendingEvent.REJECT,
      ]),
    } = props;

    const eventBus = EventBus.fromEventBusName(this, "EventBus", eventBusName);

    new ConfigurationSetEventDestination(this, "SesEventDestination", {
      events: Array.from(eventsToTrack),
      configurationSet: defaultConfigurationSet,
      destination: EventDestination.eventBus(eventBus),
      enabled: true,
    });

    this.table = new TableV2(this, "EmailLog", {
      partitionKey: {
        name: "pk",
        type: AttributeType.STRING,
      },
      sortKey: {
        name: "sk",
        type: AttributeType.STRING,
      },
      billing: Billing.onDemand(),
      deletionProtection: props.deletionProtection ?? false,
      encryption: TableEncryptionV2.awsManagedKey(),
      removalPolicy: props.removalPolicy ?? RemovalPolicy.RETAIN,
      timeToLiveAttribute: "ttl",
      pointInTimeRecoverySpecification: {
        pointInTimeRecoveryEnabled: isProd,
      },
    });

    this.bucket = new Bucket(this, "EmailAttachments", {
      accessControl: BucketAccessControl.PRIVATE,
      blockPublicAccess: BlockPublicAccess.BLOCK_ALL,
      encryption: BucketEncryption.S3_MANAGED,
      enforceSSL: true,
      lifecycleRules: [
        {
          expiration: Duration.days(attachmentsRetentionDays),
          abortIncompleteMultipartUploadAfter: Duration.days(1),
        },
      ],
    });

    const handler = new Nodejs24Function(this, "SqsHandler", {
      description: "Email queue handler",
      entry: `${fileURLToPath(new URL(".", import.meta.url))}handler/`,
      handler: "handler.handler",
      memorySize: props.handler?.memorySize ?? 256,
      timeout: props.handler?.timeout ?? Duration.seconds(30),
      reservedConcurrentExecutions:
        props.handler?.reservedConcurrentExecutions ?? 2,
      environment: {
        BUCKET_NAME: this.bucket.bucketName,
        TABLE_NAME: this.table.tableName,
        DEFAULT_SENDER_NAME: props.defaultSender.name,
        DEFAULT_SENDER_EMAIL_ADDRESS: props.defaultSender.emailAddress,
        MESSAGES_RETENTION_DAYS: String(messagesRetentionDays),
        EVENT_BUS_ARN: eventBus.eventBusArn,
        DEFAULT_CONFIGURATION_SET_NAME:
          defaultConfigurationSet.configurationSetName,
      },
      logGroupProps: {
        removalPolicy: RemovalPolicy.DESTROY,
        retention: RetentionDays.TWO_WEEKS,
        ...props.logGroupProps,
      },
    });
    this.table.grantReadWriteData(handler);
    this.bucket.grantRead(handler);
    eventBus.grantPutEventsTo(handler);

    if (props.fromArn) {
      handler.addEnvironment("FROM_ARN", props.fromArn);
    }

    handler.addToRolePolicy(
      new PolicyStatement({
        actions: ["ses:SendEmail", "ses:SendRawEmail"],
        resources: ["*"],
        effect: Effect.ALLOW,
      }),
    );

    const { queue } = SqsWithDlq.asLambdaInput({
      lambda: handler,
    });
    this.queue = queue;
  }

  readonly grantAccess = (grantee: Function): void => {
    this.table.grantReadData(grantee);
    this.queue.grantSendMessages(grantee);
    this.bucket.grantWrite(grantee);

    grantee.addEnvironment("BEESOLVE_EMAILS_QUEUE_URL", this.queue.queueUrl);
    grantee.addEnvironment("BEESOLVE_EMAILS_TABLE_NAME", this.table.tableName);
    grantee.addEnvironment(
      "BEESOLVE_EMAILS_ATTACHMENTS_BUCKET",
      this.bucket.bucketName,
    );
  };
}
