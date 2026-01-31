import { SendMessageCommand, SQSClient } from "@aws-sdk/client-sqs";
import {
  decodeFromStringifiable,
  encodeToStringifiable,
} from "@beesolve/helpers";
import type { SQSEvent } from "aws-lambda";
import * as v from "valibot";

type Functions = Record<string, (...args: any[]) => Promise<void>>;

export function createSqsHandlers<
  TFunctions extends Functions,
  Fifo extends boolean,
>(props: {
  readonly functions: TFunctions;
  readonly queueUrl: string;
  readonly localInvocation?: true;
  readonly sqsClient: Pick<SQSClient, "send">;
  readonly fifo: Fifo;
}): [
  (event: SQSEvent) => Promise<{
    batchItemFailures: {
      itemIdentifier: string;
    }[];
  }>,
  QueuedFunctions<TFunctions, Fifo>,
] {
  const handler = async (event: SQSEvent) => {
    const batchItemFailures = new Array<{ itemIdentifier: string }>();

    for (const { body, messageId } of event.Records) {
      try {
        const result = v.safeParse(
          v.pipe(
            v.string(),
            v.parseJson(),
            v.object({
              fName: v.picklist(Object.keys(props.functions)),
              fArgs: v.array(v.any()),
            }),
          ),
          body,
        );

        if (!result.success)
          throw new Error(
            `Wrong message format: ${JSON.stringify(v.flatten(result.issues), null, 2)}`,
          );

        const { fName, fArgs } = result.output;

        console.info({
          function: fName,
          arguments: JSON.stringify(fArgs, null, 2),
        });

        await props.functions[fName]?.(
          ...fArgs.map((args) => decodeFromStringifiable(args)),
        );
      } catch (error) {
        console.error(error);
        batchItemFailures.push({ itemIdentifier: messageId });
      }
    }

    return { batchItemFailures };
  };

  const functions = Object.entries(props.functions).reduce(
    (result, [functionName]) => ({
      ...result,
      [functionName](...args) {
        const originalFunction = props.functions[functionName];
        if (originalFunction == null)
          throw Error(
            `Cannot invoke "${functionName}". Make sure the function is defined.`,
          );
        const functionArgs: any[] = args.slice(0, originalFunction.length);
        const fifoOptions:
          | { readonly deduplicationId?: string; readonly groupId?: string }
          | undefined = args[originalFunction.length];

        if (props.localInvocation) {
          originalFunction(...functionArgs);
        } else {
          props.sqsClient.send(
            new SendMessageCommand({
              QueueUrl: props.queueUrl,
              MessageBody: JSON.stringify({
                fName: functionName,
                fArgs: functionArgs.map((args) => encodeToStringifiable(args)),
              }),
              MessageDeduplicationId: fifoOptions?.deduplicationId,
              MessageGroupId: fifoOptions?.groupId,
            }),
          );
        }
      },
    }),
    {} as TFunctions,
  );

  return [handler, functions];
}

type QueuedFunctions<T extends Functions, Fifo extends boolean> = {
  [key in keyof T]: AddParameters<
    T[key],
    [
      fifoOptions?: Fifo extends true
        ? {
            readonly deduplicationId?: string;
            readonly groupId?: string;
          }
        : never,
    ]
  >;
};

type AddParameters<
  TFunction extends (...args: any) => any,
  TParameters extends [...args: any],
> = (...args: [...Parameters<TFunction>, ...TParameters]) => Promise<void>;
