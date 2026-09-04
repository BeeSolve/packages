import type { SessionContext } from "@beesolve/auth-service/sveltekit";

declare global {
  namespace App {
    // Minimal skeleton — `services` is expanded in a later task once the
    // Messages/Users/Setup models exist.
    interface Locals {
      session: SessionContext;
      user: {
        email: string;
        type: "admin" | "user";
      } | null;
    }
  }
}

export {};
