import type { EventBridge } from "@aws-sdk/client-eventbridge";

type Event =
  | EmailCodeAuth
  | EmailAddressVerified
  | UnsuccessfulAuth
  | SuccessfulAuth
  | SessionInvalidated
  | EmailInvitation
  | DataToken
  | PasskeyRegistered
  | PasskeyAuthUsed;

interface EmailInvitation {
  readonly type: "EmailInvitation";
  readonly detail: {
    readonly emailAddress: string;
    readonly baseUri: string;
  };
}

interface EmailCodeAuth {
  readonly type: "EmailCodeAuth";
  readonly detail: {
    /**
     * When accountId is null it means that user is signing up rather than signing in
     */
    readonly accountId: string | null;
    /**
     * Code which should be sent to user for verification of this authorization
     */
    readonly code: string;
    /**
     * Code is valid until `expiresAt`
     */
    readonly expiresAt: string;
    /**
     * Email address which we are trying to verify
     */
    readonly emailAddress: string;
    /**
     * Base URI from where the verification request came
     */
    readonly baseUri: string;
    /**
     * Parsed cookies from the sign-in request, keyed by cookie name.
     * The __Host-SID and __Host-DataToken cookies are stripped.
     */
    readonly cookies: Record<string, string>;
    /**
     * Value of the Accept-Language header from the sign-in request, if present.
     */
    readonly acceptLanguage: string | null;
    /**
     * Value of the Origin header from the sign-in request (e.g. https://fr.example.com).
     * Useful for inferring locale from subdomain or path when Accept-Language is absent.
     */
    readonly requestOrigin: string | null;
    /**
     * Reference code which matches requested code to email for beter UX.
     */
    readonly referenceCode: string;
  };
}

interface EmailAddressVerified {
  readonly type: "EmailAddressVerified";
  readonly detail: {
    /**
     * Account ID linked to email address
     */
    readonly accountId: string;
    /**
     * Email address which has been verified
     */
    readonly emailAddress: string;
    /**
     * ISO date when was email address verified
     */
    readonly verifiedAt: string;
  };
}

interface DataToken {
  readonly type: "DataToken";
  readonly detail: {
    /**
     * Account ID linked to email address
     */
    readonly accountId: string;
    /**
     * Email address which has been verified
     */
    readonly emailAddress: string;
    readonly dataToken: string;
  };
}

interface UnsuccessfulAuth {
  readonly type: "UnsuccessfulAuth";
  readonly detail: {
    readonly emailAddress: string | null;
    readonly reason: string;
  };
}

interface SuccessfulAuth {
  readonly type: "SuccessfulAuth";
  readonly detail: {
    readonly userId: string;
  };
}

interface SessionInvalidated {
  readonly type: "SessionInvalidated";
  readonly detail: {
    readonly sessionId: string;
  };
}

interface PasskeyRegistered {
  readonly type: "PasskeyRegistered";
  readonly detail: {
    readonly userId: string;
    readonly credentialId: string;
  };
}

interface PasskeyAuthUsed {
  readonly type: "PasskeyAuthUsed";
  readonly detail: {
    readonly userId: string;
    readonly credentialId: string;
  };
}

export class Events {
  constructor(
    private readonly props: {
      readonly client: EventBridge;
      readonly eventBusArn?: string;
      readonly eventSource?: string;
    },
  ) {}

  readonly putEvents = async (...events: Array<Event>): Promise<void> => {
    await this.props.client.putEvents({
      Entries: events.map((event) => ({
        DetailType: event.type,
        Detail: JSON.stringify(event.detail),
        Source: this.props.eventSource ?? "beesolve.auth.api",
        EventBusName: this.props.eventBusArn,
      })),
    });
  };
}
