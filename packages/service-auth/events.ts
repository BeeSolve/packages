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

const passkeyRegisteredSchema = v.object({
  "detail-type": v.literal("PasskeyRegistered"),
  source: v.string(),
  detail: v.object({
    userId: v.string(),
    credentialId: v.string(),
  }),
});

const passkeyAuthUsedSchema = v.object({
  "detail-type": v.literal("PasskeyAuthUsed"),
  source: v.string(),
  detail: v.object({
    userId: v.string(),
    credentialId: v.string(),
  }),
});

const impersonationStartedSchema = v.object({
  "detail-type": v.literal("ImpersonationStarted"),
  source: v.string(),
  detail: v.object({
    currentUserId: v.string(),
    targetUserId: v.string(),
    startedAt: v.string(),
  }),
});

const impersonationEndedSchema = v.object({
  "detail-type": v.literal("ImpersonationEnded"),
  source: v.string(),
  detail: v.object({
    currentUserId: v.string(),
    targetUserId: v.string(),
    endedAt: v.string(),
  }),
});

const impersonationExpiredSchema = v.object({
  "detail-type": v.literal("ImpersonationExpired"),
  source: v.string(),
  detail: v.object({
    currentUserId: v.string(),
    targetUserId: v.string(),
    expiredAt: v.string(),
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
  passkeyRegisteredSchema,
  passkeyAuthUsedSchema,
  impersonationStartedSchema,
  impersonationEndedSchema,
  impersonationExpiredSchema,
]);

export type EmailCodeAuthEvent = v.InferOutput<typeof emailCodeAuthSchema>;
export type EmailAddressVerifiedEvent = v.InferOutput<typeof emailAddressVerifiedSchema>;
export type DataTokenEvent = v.InferOutput<typeof dataTokenSchema>;
export type SuccessfulAuthEvent = v.InferOutput<typeof successfulAuthSchema>;
export type UnsuccessfulAuthEvent = v.InferOutput<typeof unsuccessfulAuthSchema>;
export type SessionInvalidatedEvent = v.InferOutput<typeof sessionInvalidatedSchema>;
export type EmailInvitationEvent = v.InferOutput<typeof emailInvitationSchema>;
export type PasskeyRegisteredEvent = v.InferOutput<typeof passkeyRegisteredSchema>;
export type PasskeyAuthUsedEvent = v.InferOutput<typeof passkeyAuthUsedSchema>;
export type ImpersonationStartedEvent = v.InferOutput<typeof impersonationStartedSchema>;
export type ImpersonationEndedEvent = v.InferOutput<typeof impersonationEndedSchema>;
export type ImpersonationExpiredEvent = v.InferOutput<typeof impersonationExpiredSchema>;

export type EmailCodeAuthDetail = EmailCodeAuthEvent["detail"];
export type EmailAddressVerifiedDetail = EmailAddressVerifiedEvent["detail"];
export type DataTokenDetail = DataTokenEvent["detail"];
export type SuccessfulAuthDetail = SuccessfulAuthEvent["detail"];
export type UnsuccessfulAuthDetail = UnsuccessfulAuthEvent["detail"];
export type SessionInvalidatedDetail = SessionInvalidatedEvent["detail"];
export type EmailInvitationDetail = EmailInvitationEvent["detail"];
export type PasskeyRegisteredDetail = PasskeyRegisteredEvent["detail"];
export type PasskeyAuthUsedDetail = PasskeyAuthUsedEvent["detail"];
export type ImpersonationStartedDetail = ImpersonationStartedEvent["detail"];
export type ImpersonationEndedDetail = ImpersonationEndedEvent["detail"];
export type ImpersonationExpiredDetail = ImpersonationExpiredEvent["detail"];

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
  return v.is(emailCodeAuthSchema, event);
}

export function isEmailAddressVerified(event: unknown): event is EmailAddressVerifiedEvent {
  return v.is(emailAddressVerifiedSchema, event);
}

export function isDataToken(event: unknown): event is DataTokenEvent {
  return v.is(dataTokenSchema, event);
}

export function isSuccessfulAuth(event: unknown): event is SuccessfulAuthEvent {
  return v.is(successfulAuthSchema, event);
}

export function isUnsuccessfulAuth(event: unknown): event is UnsuccessfulAuthEvent {
  return v.is(unsuccessfulAuthSchema, event);
}

export function isSessionInvalidated(event: unknown): event is SessionInvalidatedEvent {
  return v.is(sessionInvalidatedSchema, event);
}

export function isEmailInvitation(event: unknown): event is EmailInvitationEvent {
  return v.is(emailInvitationSchema, event);
}

export function isPasskeyRegistered(event: unknown): event is PasskeyRegisteredEvent {
  return v.is(passkeyRegisteredSchema, event);
}

export function isPasskeyAuthUsed(event: unknown): event is PasskeyAuthUsedEvent {
  return v.is(passkeyAuthUsedSchema, event);
}

export function isImpersonationStarted(event: unknown): event is ImpersonationStartedEvent {
  return v.is(impersonationStartedSchema, event);
}

export function isImpersonationEnded(event: unknown): event is ImpersonationEndedEvent {
  return v.is(impersonationEndedSchema, event);
}

export function isImpersonationExpired(event: unknown): event is ImpersonationExpiredEvent {
  return v.is(impersonationExpiredSchema, event);
}
