import type { Setup } from "$lib/server/setup";
import type { Users } from "$lib/server/users";
import type { AuthClient } from "@beesolve/auth-service/sdk";
import type { SessionContext } from "@beesolve/auth-service/sveltekit";
import type { Domains } from "@beesolve/dmarc-consumer/domain";
import type { Reports } from "@beesolve/dmarc-consumer/report";

declare global {
  namespace App {
    interface Locals {
      session: SessionContext;
      user: {
        email: string;
        type: "admin" | "user";
        domains: Array<string>;
      } | null;
      services: {
        users: Users;
        setup: Setup;
        domains: Domains;
        reports: Reports;
        authClient: AuthClient;
      };
    }
  }
}

export {};
