import { isImpersonationEnded, isImpersonationStarted } from "@beesolve/auth-service/events";
import type { EventBridgeEvent } from "aws-lambda";

export async function handler(event: EventBridgeEvent<string, unknown>): Promise<void> {
  if (isImpersonationStarted(event)) {
    const { currentUserId, targetUserId, startedAt } = event.detail;
    console.log(
      `[ImpersonationStarted] ${currentUserId} started impersonating ${targetUserId} at ${startedAt}`,
    );
  }

  if (isImpersonationEnded(event)) {
    const { currentUserId, targetUserId, endedAt } = event.detail;
    console.log(
      `[ImpersonationEnded] ${currentUserId} stopped impersonating ${targetUserId} at ${endedAt}`,
    );
  }
}
