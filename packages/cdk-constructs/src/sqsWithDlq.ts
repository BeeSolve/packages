import { Duration } from "aws-cdk-lib";
import type { Function } from "aws-cdk-lib/aws-lambda";
import {
  SqsEventSource,
  type SqsEventSourceProps,
} from "aws-cdk-lib/aws-lambda-event-sources";
import { Queue, QueueEncryption, type QueueProps } from "aws-cdk-lib/aws-sqs";
import { Construct } from "constructs";

export interface SqsWithDlqProps {
  readonly queue?: QueueProps;
  readonly dlq?: Partial<
    Omit<
      QueueProps,
      "fifo" | "contentBasedDeduplication" | "deduplicationScope"
    >
  >;
}

export class SqsWithDlq extends Construct {
  readonly queue: Queue;
  readonly dlq: Queue;

  constructor(scope: Construct, id: string, props: SqsWithDlqProps = {}) {
    super(scope, id);

    this.dlq = new Queue(this, "Dlq", {
      fifo: props.queue?.fifo,
      contentBasedDeduplication: props.queue?.contentBasedDeduplication,
      deduplicationScope: props.queue?.deduplicationScope,
      encryption: QueueEncryption.SQS_MANAGED,
      enforceSSL: true,
      retentionPeriod: Duration.days(14),
      ...props?.dlq,
    });

    this.queue = new Queue(this, "Queue", {
      encryption: QueueEncryption.SQS_MANAGED,
      enforceSSL: true,
      retentionPeriod: Duration.days(14),
      ...props.queue,
      deadLetterQueue: {
        queue: this.dlq,
        maxReceiveCount: 5,
        ...props.queue?.deadLetterQueue,
      },
    });
  }

  /**
   * Uses the queue as an input for the given lambda function.
   *
   * Allows to batch and throttle the lambda invocations.
   */
  static asLambdaInput(props: SqsWithDlqLambdaInputProps): SqsWithDlq {
    const { lambda, batching, ...sqsProps } = props;

    const handlerTimeout = lambda.timeout ?? Duration.seconds(3);

    const sqs = new SqsWithDlq(lambda, "Input", {
      ...sqsProps,
      queue: {
        visibilityTimeout: Duration.seconds(
          Math.min(handlerTimeout.toSeconds() * 6, 43200),
        ),
        ...sqsProps.queue,
      },
    });

    lambda.addEventSource(
      new SqsEventSource(sqs.queue, {
        ...batching,
        reportBatchItemFailures: true,
        enabled: props.disabled !== true,
      }),
    );

    return sqs;
  }
}

export interface SqsWithDlqLambdaInputProps extends SqsWithDlqProps {
  /**
   * Lambda function used to handle the SQS messages.
   */
  readonly lambda: Function;

  /**
   * SQS message batching configuration.
   */
  readonly batching?: BatchingConfig;

  /**
   * Set to true to disable the consumption of messages.
   *
   * Useful when the processing needs to be paused during maintenance.
   *
   * @default false
   */
  readonly disabled?: boolean;
}

type BatchingConfig = Pick<
  SqsEventSourceProps,
  "batchSize" | "maxBatchingWindow" | "maxConcurrency"
>;
