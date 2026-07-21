import { isEmailCodeAuth, isUnsuccessfulAuth } from "@beesolve/auth-service/events";
import { Email } from "@beesolve/email-service/sdk";
import type { EventBridgeEvent } from "aws-lambda";

const email = new Email();

export async function handler(event: EventBridgeEvent<string, unknown>): Promise<void> {
  if (isEmailCodeAuth(event)) {
    const { emailAddress, code, referenceCode } = event.detail;

    await email.sendEmail({
      recipients: [emailAddress],
      subject: `Your sign-in code: ${code} (ref: ${referenceCode})`,
      html: `
        <h2>Your sign-in code</h2>
        <p style="font-size: 32px; font-weight: bold; letter-spacing: 4px;">${code}</p>
        <p>Reference: <strong>${referenceCode}</strong></p>
        <p>This code expires in 10 minutes.</p>
      `,
      text: `Your sign-in code is: ${code}\nReference: ${referenceCode}\nThis code expires in 10 minutes.`,
    });

    console.log(`[EmailCodeAuth] Sent code to ${emailAddress} (ref: ${referenceCode})`);
  }

  if (isUnsuccessfulAuth(event)) {
    const { emailAddress, reason } = event.detail;
    console.log(`[UnsuccessfulAuth] ${emailAddress ?? "unknown"}: ${reason}`);
  }
}
