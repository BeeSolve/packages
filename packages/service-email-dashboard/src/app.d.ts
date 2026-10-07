import type { AuthClient } from "@beesolve/auth-service/sdk";
import type { SessionContext } from "@beesolve/auth-service/sveltekit";
import type { Email } from "@beesolve/email-service/sdk";

import type { Messages } from "#lib/server/messages.js";
import type { Recipients } from "#lib/server/recipients.js";
import type { Requests } from "#lib/server/requests.js";
import type { Setup } from "#lib/server/setup.js";
import type { GlobalStats } from "#lib/server/stats.js";
import type { Users } from "#lib/server/users.js";

declare global {
  namespace App {
    interface Locals {
      session: SessionContext;
      user: {
        email: string;
        type: "admin" | "user";
      } | null;
      services: {
        messages: Messages;
        globalStats: GlobalStats;
        recipients: Recipients;
        users: Users;
        setup: Setup;
        authClient: AuthClient;
        email: Email;
        requests: Requests;
      };
    }
  }
}

export {};
