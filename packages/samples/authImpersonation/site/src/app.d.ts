import type { AuthClient } from "@beesolve/auth-service/sdk";
import type { SessionContext } from "@beesolve/auth-service/sveltekit";

import type { SampleUsers } from "./lib/server/sampleUsers.js";

declare global {
  namespace App {
    interface Locals {
      session: SessionContext;
      user: {
        email: string;
      } | null;
      services: {
        sampleUsers: SampleUsers;
        authClient: AuthClient;
      };
    }
  }
}

export {};
