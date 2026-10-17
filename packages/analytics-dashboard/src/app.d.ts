import type {
  AppliedMarkers,
  Breakdowns,
  Config,
  Totals,
  UrlDirectory,
  WatchStats,
} from "@beesolve/analytics-processor";
import type { AnalyticsClient } from "@beesolve/analytics-processor/sdk";
import type { AuthClient } from "@beesolve/auth-service/sdk";
import type { SessionContext } from "@beesolve/auth-service/sveltekit";
import type { Email } from "@beesolve/email-service/sdk";

import type { Setup } from "#lib/server/setup.js";
import type { Users } from "#lib/server/users.js";

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
        totals: Totals;
        breakdowns: Breakdowns;
        config: Config;
        watchStats: WatchStats;
        urls: UrlDirectory;
        markers: AppliedMarkers;
        users: Users;
        setup: Setup;
        authClient: AuthClient;
        analyticsClient: AnalyticsClient;
        email: Email;
      };
    }
  }
}

export {};
