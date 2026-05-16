import type { EventBridge } from "@aws-sdk/client-eventbridge";

export type Event = EmailSentSuccess | EmailSentFailure;

interface EmailSentSuccess {
  readonly type: "EmailSentSuccess";
  readonly detail: {
    readonly requestId: string;
    readonly messageId: string;
  };
}

interface EmailSentFailure {
  readonly type: "EmailSentFailure";
  readonly detail: {
    readonly requestId: string;
  };
}

export class Events {
  constructor(
    private readonly props: {
      readonly client: EventBridge;
      readonly eventBusArn?: string;
    },
  ) {}

  readonly putEvents = async (...events: Event[]): Promise<void> => {
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
