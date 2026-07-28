import { SendMessageCommand, type SQSClient } from "@aws-sdk/client-sqs";
import { decodeFromStringifiable, encodeToStringifiable } from "@beesolve/helpers";
import type { SQSEvent } from "aws-lambda";
import * as v from "valibot";

// oxlint-disable-next-line typescript/no-explicit-any
type Functions = Record<string, (...args: Array<any>) => Promise<void>>;

export function createSqsHandlers<
  TFunctions extends Functions,
  const TQueueName extends string,
  Fifo extends boolean,
>(props: {
  readonly functions: TFunctions;
  readonly queueUrls: Record<TQueueName | "main", string>;
  readonly queueUrlOverride?: Partial<Record<keyof TFunctions, TQueueName>>;
  readonly localInvocation?: true;
  readonly sqsClient: Pick<SQSClient, "send">;
  readonly fifo: Fifo;
}): [
  (event: SQSEvent) => Promise<{
    batchItemFailures: Array<{
      itemIdentifier: string;
    }>;
  }>,
  QueuedFunctions<TFunctions, Fifo, TQueueName>,
] {
  const handler = async (event: SQSEvent) => {
    const batchItemFailures: Array<{ itemIdentifier: string }> = [];

    for (const { body, messageId } of event.Records) {
      try {
        const result = v.safeParse(
          v.pipe(
            v.string(),
            v.parseJson(),
            v.object({
              fn: v.picklist(Object.keys(props.functions)),
              args: v.array(v.any()),
            }),
          ),
          body,
        );

        if (!result.success)
          throw new Error(
            `Wrong message format: ${JSON.stringify(v.flatten(result.issues), null, 2)}`,
          );

        const { fn, args } = result.output;

        console.info({
          function: fn,
          arguments: JSON.stringify(args),
        });

        const handler = props.functions[fn];
        if (handler == null) throw new Error(`Unknown function: "${fn}"`);
        await handler(...args.map((args) => decodeFromStringifiable(args)));
      } catch (error) {
        console.error(error);
        batchItemFailures.push({ itemIdentifier: messageId });
      }
    }

    return { batchItemFailures };
  };

  const functions = Object.entries(props.functions).reduce(
    (result, [functionName]) => ({
      // oxlint-disable-next-line oxc/no-accumulating-spread
      ...result,
      async [functionName](...args) {
        const originalFunction = props.functions[functionName];
        if (originalFunction == null) {
          throw Error(`Cannot invoke "${functionName}". Make sure the function is defined.`);
        }

        // oxlint-disable-next-line typescript/no-explicit-any
        const functionArgs: Array<any> = args.slice(0, originalFunction.length);
        const options:
          | {
              readonly deduplicationId?: string;
              readonly groupId?: string;
              readonly queueName?: TQueueName;
            }
          | undefined = args[originalFunction.length];

        if (props.localInvocation) {
          await originalFunction(...functionArgs);
        } else {
          const queueUrl =
            options?.queueName ?? props.queueUrls[props.queueUrlOverride?.[functionName] ?? "main"];

          await props.sqsClient.send(
            new SendMessageCommand({
              QueueUrl: queueUrl,
              MessageBody: JSON.stringify({
                fn: functionName,
                args: functionArgs.map((args) => encodeToStringifiable(args)),
              }),
              MessageDeduplicationId: options?.deduplicationId,
              MessageGroupId: options?.groupId,
            }),
          );
        }
      },
    }),
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion
    {} as TFunctions,
  );

  return [handler, functions];
}

type QueuedFunctions<T extends Functions, Fifo extends boolean, QueueName extends string> = {
  [key in keyof T]: AddParameters<
    T[key],
    [
      options?: Fifo extends true
        ? {
            readonly queueName?: QueueName;
            readonly deduplicationId?: string;
            readonly groupId?: string;
          }
        : { readonly queueName?: QueueName },
    ]
  >;
};

// oxlint-disable-next-line typescript/no-explicit-any
type AddParameters<TFunction extends (...args: any) => any, TParameters extends [...args: any]> = (
  ...args: [...Parameters<TFunction>, ...TParameters]
) => Promise<void>;
