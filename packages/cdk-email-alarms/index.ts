import type { Duration } from "aws-cdk-lib";
import {
  Alarm,
  ComparisonOperator,
  TreatMissingData,
} from "aws-cdk-lib/aws-cloudwatch";
import { SnsAction } from "aws-cdk-lib/aws-cloudwatch-actions";
import type { Function } from "aws-cdk-lib/aws-lambda";
import { Topic } from "aws-cdk-lib/aws-sns";
import { EmailSubscription } from "aws-cdk-lib/aws-sns-subscriptions";
import type { Queue } from "aws-cdk-lib/aws-sqs";
import { Construct } from "constructs";

export class EmailAlarms extends Construct {
  private emailSubscription: EmailSubscription;

  constructor(
    scope: Construct,
    id: string,
    props: {
      readonly emailAddress: string;
    },
  ) {
    super(scope, id);
    this.emailSubscription = new EmailSubscription(props.emailAddress);
  }

  readonly reportLambdaErrors = (handler: Function): void => {
    const topic = new Topic(handler, "ErrorAlarmTopic");
    topic.addSubscription(this.emailSubscription);

    const alarm = new Alarm(handler, `ErrorAlarm`, {
      metric: handler.metricErrors(),
      threshold: 1,
      evaluationPeriods: 1,
      comparisonOperator: ComparisonOperator.GREATER_THAN_OR_EQUAL_TO_THRESHOLD,
      treatMissingData: TreatMissingData.IGNORE,
    });

    alarm.addOkAction(new SnsAction(topic));
    alarm.addAlarmAction(new SnsAction(topic));
  };

  readonly reportSqsErrors = (props: {
    readonly queue: Queue;
    readonly dlq: Queue;
    readonly noMessagesPeriod?: Duration;
    readonly noConsumersPeriod?: Duration;
  }): void => {
    const dlqTopic = new Topic(props.dlq, "DlqAlarmTopic");
    dlqTopic.addSubscription(this.emailSubscription);

    const dlqAlarm = new Alarm(props.dlq, "DlqAlarm", {
      alarmDescription: `DLQ for ${props.queue.queueName} is not empty.`,
      metric: props.dlq.metricApproximateNumberOfMessagesVisible(),
      threshold: 1,
      evaluationPeriods: 1,
      comparisonOperator: ComparisonOperator.GREATER_THAN_OR_EQUAL_TO_THRESHOLD,
      treatMissingData: TreatMissingData.IGNORE,
    });

    dlqAlarm.addAlarmAction(new SnsAction(dlqTopic));

    if (props.noMessagesPeriod || props.noConsumersPeriod) {
      const queueTopic = new Topic(props.queue, "QueueAlarmTopic");
      queueTopic.addSubscription(this.emailSubscription);

      if (props.noMessagesPeriod) {
        const noMessages = new Alarm(props.queue, "NoMessagesAlarm", {
          alarmDescription: `Queue received no messages for ${props.noMessagesPeriod.toHumanString()}.`,
          metric: props.queue.metric("NumberOfMessagesSent", {
            statistic: "Sum",
            period: props.noMessagesPeriod,
          }),
          threshold: 0,
          evaluationPeriods: 1,
          comparisonOperator:
            ComparisonOperator.LESS_THAN_OR_EQUAL_TO_THRESHOLD,
          treatMissingData: TreatMissingData.BREACHING,
        });

        noMessages.addAlarmAction(new SnsAction(queueTopic));
      }

      if (props.noConsumersPeriod) {
        const noConsumers = new Alarm(props.queue, "NoConsumersAlarm", {
          alarmDescription: `Queue had no consumers for ${props.noConsumersPeriod.toHumanString()}.`,
          metric: props.queue.metric("NumberOfMessagesReceived", {
            statistic: "Sum",
            period: props.noConsumersPeriod,
          }),
          threshold: 0,
          evaluationPeriods: 1,
          comparisonOperator:
            ComparisonOperator.LESS_THAN_OR_EQUAL_TO_THRESHOLD,
          treatMissingData: TreatMissingData.BREACHING,
        });

        noConsumers.addAlarmAction(new SnsAction(queueTopic));
      }
    }
  };
}
