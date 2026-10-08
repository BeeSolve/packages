import type { Duration } from "aws-cdk-lib";
import { Alarm, ComparisonOperator, TreatMissingData } from "aws-cdk-lib/aws-cloudwatch";
import { SnsAction } from "aws-cdk-lib/aws-cloudwatch-actions";
import type { Function } from "aws-cdk-lib/aws-lambda";
import { Topic } from "aws-cdk-lib/aws-sns";
import { EmailSubscription } from "aws-cdk-lib/aws-sns-subscriptions";
import type { Queue } from "aws-cdk-lib/aws-sqs";
import { Construct } from "constructs";

export class EmailAlarms extends Construct {
  private readonly topic: Topic;
  private readonly action: SnsAction;

  constructor(
    scope: Construct,
    id: string,
    props: {
      readonly emailAddress: string;
    },
  ) {
    super(scope, id);
    // A single topic + email subscription shared by every alarm. One topic
    // means one subscription confirmation email, far fewer resources to
    // create/update, and the firing alarm's name/description still identifies
    // what broke. Topics and the subscription live under this construct's
    // scope rather than under each handler/queue.
    this.topic = new Topic(this, "AlarmTopic");
    this.topic.addSubscription(new EmailSubscription(props.emailAddress));
    this.action = new SnsAction(this.topic);
  }

  readonly reportLambdaErrors = (handler: Function): void => {
    const alarm = new Alarm(handler, `ErrorAlarm`, {
      metric: handler.metricErrors(),
      threshold: 1,
      evaluationPeriods: 1,
      comparisonOperator: ComparisonOperator.GREATER_THAN_OR_EQUAL_TO_THRESHOLD,
      treatMissingData: TreatMissingData.IGNORE,
    });

    alarm.addOkAction(this.action);
    alarm.addAlarmAction(this.action);
  };

  readonly reportSqsErrors = (props: {
    readonly queue: Queue;
    readonly dlq: Queue;
    readonly noMessagesPeriod?: Duration;
    readonly noConsumersPeriod?: Duration;
  }): void => {
    const dlqAlarm = new Alarm(props.dlq, "DlqAlarm", {
      alarmDescription: `DLQ for ${props.queue.queueName} is not empty.`,
      metric: props.dlq.metricApproximateNumberOfMessagesVisible(),
      threshold: 1,
      evaluationPeriods: 1,
      comparisonOperator: ComparisonOperator.GREATER_THAN_OR_EQUAL_TO_THRESHOLD,
      treatMissingData: TreatMissingData.IGNORE,
    });

    dlqAlarm.addAlarmAction(this.action);

    if (props.noMessagesPeriod) {
      const noMessages = new Alarm(props.queue, "NoMessagesAlarm", {
        alarmDescription: `Queue received no messages for ${props.noMessagesPeriod.toHumanString()}.`,
        metric: props.queue.metric("NumberOfMessagesSent", {
          statistic: "Sum",
          period: props.noMessagesPeriod,
        }),
        threshold: 0,
        evaluationPeriods: 1,
        comparisonOperator: ComparisonOperator.LESS_THAN_OR_EQUAL_TO_THRESHOLD,
        treatMissingData: TreatMissingData.BREACHING,
      });

      noMessages.addAlarmAction(this.action);
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
        comparisonOperator: ComparisonOperator.LESS_THAN_OR_EQUAL_TO_THRESHOLD,
        treatMissingData: TreatMissingData.BREACHING,
      });

      noConsumers.addAlarmAction(this.action);
    }
  };
}
