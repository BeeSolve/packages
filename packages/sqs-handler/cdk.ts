import {
  EmailAlarms,
  Nodejs24Function,
  type Nodejs24FunctionProps,
  SqsWithDlq,
  type SqsWithDlqLambdaInputProps,
} from "@beesolve/cdk-constructs";
import { capitalizeFirstLetter } from "@beesolve/helpers";
import { Function } from "aws-cdk-lib/aws-lambda";
import {
  NodejsFunction,
  type NodejsFunctionProps,
} from "aws-cdk-lib/aws-lambda-nodejs";
import { Construct } from "constructs";

export interface SqsHandlerProps {
  /**
   * SqsHandler will deploy NodejsFunction handler.
   *
   * This configuration is reused for all additional configurations.
   * The only required properties are `memorySize`, `timeout` and `entry`.
   * `entry` should point to file where your handler from `createSqsHandlers` is exported.
   *
   * @default
   *
   * {
   *   runtime: Runtime.NODEJS_24_X,
   *   architecture: Architecture.ARM_64,
   *   bundling: {
   *     minify: true,
   *     sourceMap: true,
   *     sourcesContent: false,
   *     target: "es2022",
   *   }
   * }
   *
   */
  readonly handlerProps: Nodejs24FunctionProps &
    Required<Pick<Nodejs24FunctionProps, "memorySize" | "timeout" | "entry">>;

  /**
   * You can set up additional properties through this config.
   *
   * For example you can set up FIFO queue here.
   */
  readonly queueProps?: Omit<SqsWithDlqLambdaInputProps, "lambda">;

  /**
   * You can specify additional handler configurations here.
   *
   * @example
   *
   * {
   *   longRunning: {
   *     // memory from `handlerProps` will be reused here
   *     timeout: Duration.minutes(15)
   *   },
   *   multipleCpu: {
   *     memorySize: 10240,
   *     timeout: Duration.minutes(5)
   *   }
   * }
   */
  readonly additionalConfigurations?: Record<
    string,
    Pick<Nodejs24FunctionProps, "memorySize" | "timeout">
  >;

  /**
   * If you set up EmailAlarms you can pass it here and alarms for SQS and DLQ will be added automatically.
   */
  readonly alarms?: EmailAlarms;
}

const mainQueueLabel = "main";

export class SqsHandler extends Construct {
  private readonly configurations: Record<
    string,
    {
      readonly queue: SqsWithDlq;
      readonly handler: NodejsFunction;
    }
  > = {};

  constructor(scope: Construct, id: string, props: SqsHandlerProps) {
    super(scope, id);

    const {
      handlerProps,
      queueProps,
      additionalConfigurations: additionalHandlerConfigurations = {},
      alarms,
    } = props;

    const configurations: Record<
      string,
      Pick<NodejsFunctionProps, "memorySize" | "timeout">
    > = {
      ...additionalHandlerConfigurations,
      [mainQueueLabel]: {
        memorySize: handlerProps.memorySize,
        timeout: handlerProps.timeout,
      },
    };

    const { description, memorySize, timeout, ...mainConfig } = handlerProps;

    for (const [name, config] of Object.entries(configurations)) {
      const prefix = capitalizeFirstLetter(name);
      const handlerId = `${prefix}Handler`;
      const handler = new Nodejs24Function(this, handlerId, {
        description: `${description ?? "Tasks queue handler"} - ${name}`,
        ...mainConfig,
        ...config,
      });

      const queue = SqsWithDlq.asLambdaInput({
        lambda: handler,
        ...queueProps,
      });

      alarms?.reportSqsErrors(queue);

      this.configurations[name] = {
        handler,
        queue,
      };
    }

    const env = this.toEnvironmentVariables();

    this.forEachHandler((handler) => {
      env.forEach(({ key, value }) => handler.addEnvironment(key, value));
    });
  }

  readonly grantAccess = (grantee: Function): void => {
    Object.values(this.configurations).forEach(({ queue }) => {
      queue.queue.grantSendMessages(grantee);
    });

    const env = this.toEnvironmentVariables();
    env.forEach(({ key, value }) => grantee.addEnvironment(key, value));
  };

  readonly forEachHandler = (
    callback: (handler: NodejsFunction) => void,
  ): void => {
    Object.values(this.configurations).forEach(({ handler }) =>
      callback(handler),
    );
  };

  private readonly toEnvironmentVariables = () => {
    const { [mainQueueLabel]: main, ...rest } = this.configurations;
    if (main == null)
      throw Error(`Unexpected error. Main queue and handler not set.`);

    return [
      {
        key: "BEESOLVE_TASKS_MAIN_QUEUE_URL",
        value: main.queue.queue.queueUrl,
      },
      {
        key: "BEESOLVE_TASKS_ADDITIONAL_QUEUE_URLS",
        value: JSON.stringify(
          Object.fromEntries(
            Object.entries(rest).map(([key, { queue }]) => [
              key,
              queue.queue.queueUrl,
            ]),
          ),
        ),
      },
    ];
  };
}
