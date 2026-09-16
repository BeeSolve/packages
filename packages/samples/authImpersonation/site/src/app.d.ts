import type { SampleUsers } from "$lib/server/sampleUsers";
import type { AuthClient } from "@beesolve/auth-service/sdk";
import type { SessionContext } from "@beesolve/auth-service/sveltekit";

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
