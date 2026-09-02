import { error, fail } from "@sveltejs/kit";
import * as v from "valibot";

import type { Actions, PageServerLoad } from "./$types.js";

export const load: PageServerLoad = async ({ locals }) => {
  const user = locals.user;
  if (user == null) {
    error(403, "Access denied");
  }

  const allDomains = await locals.services.domains.list();
  const visibleDomains =
    user.type === "admin"
      ? allDomains
      : allDomains.filter((domain) => user.domains.includes(domain.domain));

  const statuses = await locals.services.backfill.getStatuses();

  return {
    domains: visibleDomains.map((domain) => {
      const status = statuses[domain.domain] ?? { canRun: true };
      return {
        domain: domain.domain,
        totalMessages: domain.totalMessages,
        totalPass: domain.totalPass,
        totalFail: domain.totalFail,
        canRun: status.canRun,
        lastRun: status.lastRun,
      };
    }),
  };
};

export const actions: Actions = {
  default: async ({ request, locals }) => {
    const user = locals.user;
    if (user == null) {
      error(403, "Access denied");
    }

    const formData = await request.formData();
    const domainResult = v.safeParse(v.pipe(v.string(), v.minLength(1)), formData.get("domain"));
    if (!domainResult.success) {
      return fail(400, { error: "Invalid domain." });
    }

    const domain = domainResult.output;
    if (user.type !== "admin" && !user.domains.includes(domain)) {
      error(403, "Access denied");
    }

    const result = await locals.services.backfill.start({ domain });
    if (!result.enqueued) {
      return fail(409, { error: "A backfill is already running for this domain." });
    }

    return { started: true, domain };
  },
};
