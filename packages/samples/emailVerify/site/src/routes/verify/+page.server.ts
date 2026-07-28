import { randomBytes, randomInt } from "node:crypto";

import {
  ExpiredTokenError,
  TokenAlreadyUsedUpError,
  TokenDoesNotExistError,
  TokenInvalidError,
  TokenThrottledError,
} from "@beesolve/action-tokens/model";
import { fail, redirect } from "@sveltejs/kit";
import * as v from "valibot";

import type { Actions } from "./$types.js";

export const actions: Actions = {
  default: async ({ request, locals }) => {
    const formData = await request.formData();
    const intent = typeof formData.get("intent") === "string" ? formData.get("intent") : "";
    const token = typeof formData.get("token") === "string" ? formData.get("token") : "";

    if (intent === "resend") {
      return handleResend(token, locals);
    }

    const code = typeof formData.get("code") === "string" ? formData.get("code") : "";
    return handleVerify(token, code, locals);
  },
};

async function handleVerify(token: string, code: string, locals: App.Locals) {
  const result = v.safeParse(
    v.object({
      token: v.pipe(v.string(), v.nonEmpty()),
      code: v.pipe(v.string(), v.length(6), v.digits()),
    }),
    { token, code },
  );

  if (!result.success) {
    return fail(400, { error: "Please enter a valid 6-digit code.", token });
  }

  let data: unknown;

  try {
    const tokenResult = await locals.actionTokens.use({
      owner: token,
      action: "contactVerify",
      value: code,
      drainWhenValid: true,
    });
    data = tokenResult.data;
  } catch (error) {
    if (
      error instanceof TokenInvalidError ||
      error instanceof ExpiredTokenError ||
      error instanceof TokenAlreadyUsedUpError
    ) {
      return fail(400, { error: "Invalid or expired code.", token });
    }
    throw error;
  }

  const message = v.parse(
    v.object({
      name: v.string(),
      email: v.pipe(v.string(), v.email()),
      subject: v.string(),
      message: v.string(),
    }),
    data,
  );

  await locals.emailService.sendEmail({
    recipients: [locals.env.RECIPIENT_EMAIL],
    sender: {
      name: message.name,
      emailAddress: message.email,
    },
    subject: `[Contact] ${message.subject}`,
    text: `From: ${message.name} <${message.email}>\nSubject: ${message.subject}\n\n${message.message}`,
    html: `<p><strong>From:</strong> ${message.name} &lt;${message.email}&gt;</p><p><strong>Subject:</strong> ${message.subject}</p><hr /><p>${message.message.replace(/\n/g, "<br />")}</p>`,
  });

  redirect(303, "/confirmed");
}

async function handleResend(oldToken: string, locals: App.Locals) {
  const result = v.safeParse(
    v.object({ token: v.pipe(v.string(), v.nonEmpty(), v.maxLength(256)) }),
    { token: oldToken },
  );

  if (!result.success) {
    return fail(400, { error: "Invalid request.", token: oldToken });
  }

  let data: unknown;

  try {
    const peekResult = await locals.actionTokens.peek({ owner: oldToken, action: "contactVerify" });
    data = peekResult.data;
  } catch (error) {
    if (
      error instanceof TokenDoesNotExistError ||
      error instanceof ExpiredTokenError ||
      error instanceof TokenAlreadyUsedUpError
    ) {
      return fail(400, {
        error: "Token not found or expired. Please start over.",
        token: oldToken,
      });
    }
    throw error;
  }

  const parsed = v.parse(
    v.object({
      name: v.string(),
      email: v.pipe(v.string(), v.email()),
      subject: v.string(),
      message: v.string(),
    }),
    data,
  );

  await locals.actionTokens.drain({ owner: oldToken, action: "contactVerify" });

  const newToken = randomBytes(32).toString("base64url");
  const code = generateOTP();
  const referenceCode = randomBytes(4).toString("hex").toUpperCase();
  const expiresAt = new Date(Date.now() + locals.env.OTP_EXPIRY_SECONDS * 1000);

  try {
    await locals.actionTokens.createNewWithThrottling({
      action: "contactVerify",
      data: {
        name: parsed.name,
        email: parsed.email,
        subject: parsed.subject,
        message: parsed.message,
      },
      expiresAt,
      overwrite: false,
      owner: newToken,
      remainingUses: 3,
      value: code,
      throttle: { id: parsed.email, windowSeconds: locals.env.THROTTLE_WINDOW_SECONDS },
    });
  } catch (error) {
    if (error instanceof TokenThrottledError) {
      return fail(429, { error: "Please wait before requesting a new code.", token: oldToken });
    }
    throw error;
  }

  await locals.emailService.sendEmail({
    recipients: [parsed.email],
    subject: "Verification code for your contact form submission",
    text: `Your verification code is: ${code}\nReference: ${referenceCode}\n\nThis code expires in ${Math.round(locals.env.OTP_EXPIRY_SECONDS / 60)} minutes.\n\nIf you did not request this, you can safely ignore this email.`,
    html: `<p>Your verification code is: <strong>${code}</strong></p><p>Reference: <strong>${referenceCode}</strong></p><p>This code expires in ${Math.round(locals.env.OTP_EXPIRY_SECONDS / 60)} minutes.</p><p>If you did not request this, you can safely ignore this email.</p>`,
  });

  const canResendAt = new Date(
    Date.now() + locals.env.THROTTLE_WINDOW_SECONDS * 1000,
  ).toISOString();

  return { token: newToken, referenceCode, canResendAt };
}

function generateOTP(length: number = 6): string {
  const digits: Array<number> = [];
  for (let i = 0; i < length; i++) {
    digits.push(randomInt(10));
  }
  return digits.join("");
}
