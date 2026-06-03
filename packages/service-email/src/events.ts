import type { EventBridge } from "@aws-sdk/client-eventbridge";
import * as v from "valibot";

const emailSentSuccessSchema = v.object({
  type: v.literal("EmailSentSuccess"),
  detail: v.object({
    requestId: v.string(),
    messageId: v.string(),
  }),
});

const emailSentFailureSchema = v.object({
  type: v.literal("EmailSentFailure"),
  detail: v.object({
    requestId: v.string(),
  }),
});

export const eventSchema = v.variant("type", [emailSentSuccessSchema, emailSentFailureSchema]);

export type Event = v.InferOutput<typeof eventSchema>;

export class Events {
  constructor(
    private readonly props: {
      readonly client: EventBridge;
      readonly eventBusArn?: string;
    },
  ) {}

  readonly putEvents = async (...events: Array<Event>): Promise<void> => {
    await this.props.client
      .putEvents({
        Entries: events.map((event) => ({
          DetailType: event.type,
          Detail: JSON.stringify(event.detail),
          Source: "beesolve.email.api",
          EventBusName: this.props.eventBusArn,
        })),
      })
      .catch((error) => console.error("EventBridge putEvents failed", error));
  };
}
