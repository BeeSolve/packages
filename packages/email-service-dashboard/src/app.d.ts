import type { Messages } from "$lib/server/messages";
import type { Recipients } from "$lib/server/recipients";
import type { Setup } from "$lib/server/setup";
import type { GlobalStats } from "$lib/server/stats";
import type { Users } from "$lib/server/users";
import type { AuthClient } from "@beesolve/auth-service/sdk";
import type { SessionContext } from "@beesolve/auth-service/sveltekit";
import type { Email } from "@beesolve/email-service/sdk";

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
      };
    }
  }
}

export {};
