import { error } from "@sveltejs/kit";

import type { PageServerLoad } from "./$types.js";

export const load: PageServerLoad = async ({ params, locals, url }) => {
  const user = locals.user;
  if (user == null) {
    error(403, "Access denied");
  }

  if (user.type !== "admin" && !user.domains.includes(params.domain)) {
    error(403, "Access denied — you do not have access to this domain");
  }

  const cursor = url.searchParams.get("cursor") ?? undefined;

  const result = await locals.services.reports.queryByDomain({
    domain: params.domain,
    cursor,
    limit: 50,
  });

  return {
    domain: params.domain,
    reports: result.reports.map((report) => ({
      orgName: report.orgName,
      reportId: report.reportId,
      dateRangeBegin: report.dateRangeBegin,
      dateRangeEnd: report.dateRangeEnd,
      totalMessages: report.totalMessages,
      totalPass: report.totalPass,
      totalFail: report.totalFail,
      policy: report.policy,
    })),
    cursor: result.cursor,
  };
};
