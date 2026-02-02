import {
  nodejsFunctionDefaultConfig,
  SqsWithDlq,
} from "@beesolve/cdk-constructs";
import { type EmailAlarms } from "@beesolve/cdk-email-alarms";
import { Duration } from "aws-cdk-lib";
import { Function } from "aws-cdk-lib/aws-lambda";
import {
  NodejsFunction,
  type NodejsFunctionProps,
} from "aws-cdk-lib/aws-lambda-nodejs";
import { Construct } from "constructs";
import { resolve } from "node:path";

export interface SqsHandlerProps {
  /**
   * Path to file where SDK handler is exported.
   */
  readonly entry: string;
  /**
   * When you provide instance of EmailAlarms alarm for your SQS queues and Lambda handler will be set up automatically.
   */
  readonly alarms?: EmailAlarms;
  /**
   * You can change default memorySize and timeout here.
   *
   * @default
   * {
   *    memorySize: 1024,
   *    timeout: Duration.seconds(30)
   * }
   */
  readonly handlerProps?: Pick<NodejsFunctionProps, "memorySize" | "timeout">;
}

export class SqsHandler extends Construct {
  private readonly queue: SqsWithDlq;
  readonly handler: NodejsFunction;

  constructor(scope: Construct, id: string, props: SqsHandlerProps) {
    super(scope, id);

    const { handlerProps = {} } = props;

    this.handler = new NodejsFunction(this, "QueueHandler", {
      description: `${id} queue handler`,
      entry: resolve(__dirname, props.entry),
      handler: "handler",
      memorySize: 1024,
      timeout: Duration.seconds(30),
      bundling: nodejsFunctionDefaultConfig.bundling,
      ...nodejsFunctionDefaultConfig.runtime,
      ...handlerProps,
    });

    this.queue = SqsWithDlq.asLambdaInput({
      lambda: this.handler,
    });

    this.handler.addEnvironment(
      "BEESOLVE_TASKS_QUEUE_URL",
      this.queue.queue.queueUrl,
    );

    props.alarms?.reportSqsErrors(this.queue);
    props.alarms?.reportLambdaErrors(this.handler);
  }

  readonly grantAccess = (grantee: Function): void => {
    this.queue.queue.grantSendMessages(grantee);

    grantee.addEnvironment(
      "BEESOLVE_TASKS_QUEUE_URL",
      this.queue.queue.queueUrl,
    );
  };
}
