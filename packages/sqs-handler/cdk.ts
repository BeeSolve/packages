import {
  Nodejs24Function,
  type Nodejs24FunctionProps,
  SqsWithDlq,
  type SqsWithDlqLambdaInputProps,
} from "@beesolve/cdk-constructs";
import type { EmailAlarms } from "@beesolve/cdk-email-alarms";
import { capitalizeFirstLetter } from "@beesolve/helpers";
import type { IKey } from "aws-cdk-lib/aws-kms";
import type { Function } from "aws-cdk-lib/aws-lambda";
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
   *   reservedConcurrentExecutions: 2
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

  /**
   * Optional KMS key for server-side encryption of the SQS queues.
   * When provided, uses KMS encryption instead of SQS-managed encryption.
   */
  readonly encryptionKey?: IKey;
}

const mainQueueLabel = "main";

export class SqsHandler extends Construct {
  private readonly configurations: Record<
    string,
    {
      readonly queue: SqsWithDlq;
      readonly handler: Nodejs24Function;
    }
  > = {};

  constructor(scope: Construct, id: string, props: SqsHandlerProps) {
    super(scope, id);

    const {
      handlerProps,
      queueProps,
      additionalConfigurations: additionalHandlerConfigurations = {},
      alarms,
      encryptionKey,
    } = props;

    const { description, memorySize, timeout, reservedConcurrentExecutions, ...mainConfig } =
      handlerProps;

    const configurations: Record<string, Pick<Nodejs24FunctionProps, "memorySize" | "timeout">> = {
      ...additionalHandlerConfigurations,
      [mainQueueLabel]: {
        memorySize,
        timeout,
      },
    };

    for (const [name, config] of Object.entries(configurations)) {
      const prefix = capitalizeFirstLetter(name);
      const handlerId = `${prefix}Handler`;
      const handler = new Nodejs24Function(this, handlerId, {
        description: `${description ?? "Tasks queue handler"} - ${name}`,
        reservedConcurrentExecutions: reservedConcurrentExecutions ?? 2,
        ...mainConfig,
        ...config,
      });

      const queue = SqsWithDlq.asLambdaInput({
        lambda: handler,
        encryptionKey,
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

  readonly forEachHandler = (callback: (handler: Nodejs24Function) => void): void => {
    Object.values(this.configurations).forEach(({ handler }) => callback(handler));
  };

  private readonly toEnvironmentVariables = () => {
    const { [mainQueueLabel]: main, ...rest } = this.configurations;
    if (main == null) throw Error(`Unexpected error. Main queue and handler not set.`);

    return [
      {
        key: "BEESOLVE_TASKS_MAIN_QUEUE_URL",
        value: main.queue.queue.queueUrl,
      },
      {
        key: "BEESOLVE_TASKS_ADDITIONAL_QUEUE_URLS",
        value: JSON.stringify(
          Object.fromEntries(
            Object.entries(rest).map(([key, { queue }]) => [key, queue.queue.queueUrl]),
          ),
        ),
      },
    ];
  };
}
