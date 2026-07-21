import { randomBytes, randomInt } from "node:crypto";

import { TokenThrottledError } from "@beesolve/action-tokens/model";
import { fail, redirect } from "@sveltejs/kit";
import * as v from "valibot";

import type { Actions } from "./$types.js";

const schema = v.object({
  name: v.pipe(v.string(), v.trim(), v.minLength(1)),
  email: v.pipe(v.string(), v.trim(), v.toLowerCase(), v.email()),
  subject: v.pipe(v.string(), v.trim(), v.minLength(1)),
  message: v.pipe(v.string(), v.minLength(10)),
});

export const actions: Actions = {
  default: async ({ request, locals }) => {
    const formData = await request.formData();

    const result = v.safeParse(schema, {
      name: formData.get("name"),
      email: formData.get("email"),
      subject: formData.get("subject"),
      message: formData.get("message"),
    });

    if (!result.success) {
      return fail(400, {
        error: "Please fill in all fields correctly.",
        name: formData.get("name") as string,
        email: formData.get("email") as string,
        subject: formData.get("subject") as string,
        message: formData.get("message") as string,
      });
    }

    const { name, email, subject, message } = result.output;

    const token = randomBytes(32).toString("base64url");
    const code = generateOTP();
    const referenceCode = randomBytes(4).toString("hex").toUpperCase();
    const expiresAt = new Date(Date.now() + locals.env.OTP_EXPIRY_SECONDS * 1000);

    try {
      await locals.actionTokens.createNewWithThrottling({
        action: "contactVerify",
        data: { name, email, subject, message },
        expiresAt,
        overwrite: true,
        owner: token,
        remainingUses: 3,
        value: code,
        throttle: { id: email, windowSeconds: locals.env.THROTTLE_WINDOW_SECONDS },
      });
    } catch (error) {
      if (error instanceof TokenThrottledError) {
        return fail(429, {
          error: "Please wait before submitting again.",
          name,
          email,
          subject,
          message,
        });
      }
      throw error;
    }

    await locals.emailService.sendEmail({
      recipients: [email],
      subject: "Verification code for your contact form submission",
      text: `Your verification code is: ${code}\nReference: ${referenceCode}\n\nThis code expires in ${Math.round(locals.env.OTP_EXPIRY_SECONDS / 60)} minutes.\n\nIf you did not request this, you can safely ignore this email.`,
      html: `<p>Your verification code is: <strong>${code}</strong></p><p>Reference: <strong>${referenceCode}</strong></p><p>This code expires in ${Math.round(locals.env.OTP_EXPIRY_SECONDS / 60)} minutes.</p><p>If you did not request this, you can safely ignore this email.</p>`,
    });

    const canResendAt = new Date(
      Date.now() + locals.env.THROTTLE_WINDOW_SECONDS * 1000,
    ).toISOString();
    const params = new URLSearchParams({ token, referenceCode, canResendAt });

    redirect(303, `/verify?${params}`);
  },
};

function generateOTP(length: number = 6): string {
  const digits: Array<number> = [];
  for (let i = 0; i < length; i++) {
    digits.push(randomInt(10));
  }
  return digits.join("");
}
