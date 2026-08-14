import { error } from "@sveltejs/kit";

import type { PageServerLoad } from "./$types.js";

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

  return {
    domains: visibleDomains.map((domain) => ({
      domain: domain.domain,
      totalMessages: domain.totalMessages,
      totalPass: domain.totalPass,
      totalFail: domain.totalFail,
    })),
  };
};
