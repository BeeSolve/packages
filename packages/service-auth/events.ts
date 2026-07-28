/**
 * Consumer-facing TypeScript types and helpers for @beesolve/auth-service EventBridge events.
 *
 * Import from "@beesolve/auth-service/events" in any Lambda that processes these events via SQS.
 */

import * as v from "valibot";

const emailCodeAuthSchema = v.object({
  "detail-type": v.literal("EmailCodeAuth"),
  source: v.string(),
  detail: v.object({
    accountId: v.nullable(v.string()),
    code: v.string(),
    expiresAt: v.string(),
    emailAddress: v.string(),
    baseUri: v.string(),
    cookies: v.record(v.string(), v.string()),
    acceptLanguage: v.nullable(v.string()),
    requestOrigin: v.nullable(v.string()),
    referenceCode: v.string(),
  }),
});

const emailAddressVerifiedSchema = v.object({
  "detail-type": v.literal("EmailAddressVerified"),
  source: v.string(),
  detail: v.object({
    accountId: v.string(),
    emailAddress: v.string(),
    verifiedAt: v.string(),
  }),
});

const dataTokenSchema = v.object({
  "detail-type": v.literal("DataToken"),
  source: v.string(),
  detail: v.object({
    accountId: v.string(),
    emailAddress: v.string(),
    dataToken: v.string(),
  }),
});

const successfulAuthSchema = v.object({
  "detail-type": v.literal("SuccessfulAuth"),
  source: v.string(),
  detail: v.object({
    userId: v.string(),
  }),
});

const unsuccessfulAuthSchema = v.object({
  "detail-type": v.literal("UnsuccessfulAuth"),
  source: v.string(),
  detail: v.object({
    emailAddress: v.nullable(v.string()),
    reason: v.string(),
  }),
});

const sessionInvalidatedSchema = v.object({
  "detail-type": v.literal("SessionInvalidated"),
  source: v.string(),
  detail: v.object({
    sessionId: v.string(),
  }),
});

const emailInvitationSchema = v.object({
  "detail-type": v.literal("EmailInvitation"),
  source: v.string(),
  detail: v.object({
    emailAddress: v.string(),
    baseUri: v.string(),
  }),
});

const authEventSchema = v.variant("detail-type", [
  emailCodeAuthSchema,
  emailAddressVerifiedSchema,
  dataTokenSchema,
  successfulAuthSchema,
  unsuccessfulAuthSchema,
  sessionInvalidatedSchema,
  emailInvitationSchema,
]);

export type EmailCodeAuthEvent = v.InferOutput<typeof emailCodeAuthSchema>;
export type EmailAddressVerifiedEvent = v.InferOutput<typeof emailAddressVerifiedSchema>;
export type DataTokenEvent = v.InferOutput<typeof dataTokenSchema>;
export type SuccessfulAuthEvent = v.InferOutput<typeof successfulAuthSchema>;
export type UnsuccessfulAuthEvent = v.InferOutput<typeof unsuccessfulAuthSchema>;
export type SessionInvalidatedEvent = v.InferOutput<typeof sessionInvalidatedSchema>;
export type EmailInvitationEvent = v.InferOutput<typeof emailInvitationSchema>;

export type EmailCodeAuthDetail = EmailCodeAuthEvent["detail"];
export type EmailAddressVerifiedDetail = EmailAddressVerifiedEvent["detail"];
export type DataTokenDetail = DataTokenEvent["detail"];
export type SuccessfulAuthDetail = SuccessfulAuthEvent["detail"];
export type UnsuccessfulAuthDetail = UnsuccessfulAuthEvent["detail"];
export type SessionInvalidatedDetail = SessionInvalidatedEvent["detail"];
export type EmailInvitationDetail = EmailInvitationEvent["detail"];

export type AuthEvent = v.InferOutput<typeof authEventSchema>;

/**
 * Parses an EventBridge event from an SQS record body string.
 * Returns `null` when the body is not a recognised auth event.
 */
export function parseAuthEvent(body: string): AuthEvent | null {
  const result = v.safeParse(v.pipe(v.string(), v.parseJson(), authEventSchema), body);
  return result.success ? result.output : null;
}

export function isEmailCodeAuth(event: unknown): event is EmailCodeAuthEvent {
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion
  return (event as Record<string, unknown> | null)?.["detail-type"] === "EmailCodeAuth";
}

export function isEmailAddressVerified(event: unknown): event is EmailAddressVerifiedEvent {
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion
  return (event as Record<string, unknown> | null)?.["detail-type"] === "EmailAddressVerified";
}

export function isDataToken(event: unknown): event is DataTokenEvent {
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion
  return (event as Record<string, unknown> | null)?.["detail-type"] === "DataToken";
}

export function isSuccessfulAuth(event: unknown): event is SuccessfulAuthEvent {
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion
  return (event as Record<string, unknown> | null)?.["detail-type"] === "SuccessfulAuth";
}

export function isUnsuccessfulAuth(event: unknown): event is UnsuccessfulAuthEvent {
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion
  return (event as Record<string, unknown> | null)?.["detail-type"] === "UnsuccessfulAuth";
}

export function isSessionInvalidated(event: unknown): event is SessionInvalidatedEvent {
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion
  return (event as Record<string, unknown> | null)?.["detail-type"] === "SessionInvalidated";
}

export function isEmailInvitation(event: unknown): event is EmailInvitationEvent {
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion
  return (event as Record<string, unknown> | null)?.["detail-type"] === "EmailInvitation";
}
