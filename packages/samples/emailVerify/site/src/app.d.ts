import type { ActionTokensClient } from "@beesolve/action-tokens/sdk";
import type { Email } from "@beesolve/email-service/sdk";

import type { Environment } from "./hooks.server";

declare global {
  namespace App {
    interface Locals {
      env: Environment;
      actionTokens: ActionTokensClient;
      emailService: Email;
    }
  }
}

export {};
