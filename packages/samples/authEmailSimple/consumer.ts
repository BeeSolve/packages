import { isEmailCodeAuth, isUnsuccessfulAuth } from "@beesolve/auth-service/events";
import type { EventBridgeEvent } from "aws-lambda";

export async function handler(event: EventBridgeEvent<string, unknown>): Promise<void> {
  if (isEmailCodeAuth(event)) {
    const { emailAddress, code, referenceCode } = event.detail;
    console.log(`[EmailCodeAuth] Send code ${code} (ref: ${referenceCode}) to ${emailAddress}`);
  }

  if (isUnsuccessfulAuth(event)) {
    const { detail } = event;
    console.log(`[UnsuccessfulAuth] ${detail.code}: ${detail.reason}`);
  }
}
