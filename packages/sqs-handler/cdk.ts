import { type EmailAlarms } from "@beesolve/cdk-email-alarms";
import { Duration } from "aws-cdk-lib";
import { Architecture, Function, Runtime } from "aws-cdk-lib/aws-lambda";
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
   * @default false
   */
  readonly isProd?: boolean;
  readonly alarms: EmailAlarms;
  readonly handlerProps?: Pick<NodejsFunctionProps, "memorySize" | "timeout">;
}

export class SqsHandler extends Construct {
  private readonly queue: SqsWithDlq;
  readonly handler: NodejsFunction;

  constructor(scope: Construct, id: string, props: SqsHandlerProps) {
    super(scope, id);

    const { isProd = false, handlerProps = {} } = props;

    this.handler = new NodejsFunction(this, "QueueHandler", {
      description: "Tasks queue handler",
      entry: resolve(__dirname, props.entry),
      handler: "handler",
      bundling: {
        minify: isProd,
        sourceMap: isProd,
        sourcesContent: false,
        target: "es2022",
      },
      memorySize: 1024,
      timeout: Duration.seconds(30),
      runtime: Runtime.NODEJS_24_X,
      architecture: Architecture.ARM_64,
      depsLockFilePath: resolve(`${__dirname}/../../bun.lock`),
      ...handlerProps,
    });

    this.queue = SqsWithDlq.asLambdaInput({
      lambda: this.handler,
    });

    this.handler.addEnvironment(
      "BEESOLVE_TASKS_QUEUE_URL",
      this.queue.queue.queueUrl,
    );

    props.alarms.reportSqsErrors(this.queue);
  }

  readonly grantAccess = (grantee: Function): void => {
    this.queue.queue.grantSendMessages(grantee);

    grantee.addEnvironment(
      "BEESOLVE_TASKS_QUEUE_URL",
      this.queue.queue.queueUrl,
    );
  };
}
