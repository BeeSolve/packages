import type { SessionContext } from "@beesolve/auth-service/sveltekit";

declare global {
  namespace App {
    interface Locals {
      session: SessionContext;
    }
  }
}

export {};
