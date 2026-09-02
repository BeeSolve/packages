import { aggregateReports } from "$lib/server/aggregate.js";
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
  const dateFilter = url.searchParams.get("date") ?? undefined;
  const monthParam = url.searchParams.get("month") ?? undefined;

  const queryParams: {
    domain: string;
    startTime?: number;
    endTime?: number;
    cursor?: string;
    limit?: number;
  } = {
    domain: params.domain,
    cursor,
    limit: 50,
  };

  if (dateFilter != null) {
    const dayStart = Date.parse(`${dateFilter}T00:00:00Z`);
    if (!Number.isNaN(dayStart)) {
      queryParams.startTime = dayStart / 1000;
      queryParams.endTime = queryParams.startTime + 86399;
    }
  }

  const result = await locals.services.reports.queryByDomain(queryParams);

  const now = new Date();
  const currentMonth = `${String(now.getUTCFullYear())}-${String(now.getUTCMonth() + 1).padStart(2, "0")}`;
  const monthPattern = /^\d{4}-\d{2}$/;
  const requestedMonth =
    monthParam != null && monthPattern.test(monthParam)
      ? monthParam
      : dateFilter != null
        ? dateFilter.slice(0, 7)
        : currentMonth;
  const displayMonth = requestedMonth > currentMonth ? currentMonth : requestedMonth;
  const todayIso = `${currentMonth}-${String(now.getUTCDate()).padStart(2, "0")}`;

  const aggregate = aggregateReports(result.reports);

  const breakdownIps = aggregate.sourceIpBreakdown.map((row) => row.ip);
  const enrichment = await locals.services.ipInfoCache.getMany({ ips: breakdownIps });

  const sourceIpBreakdown = aggregate.sourceIpBreakdown.map((row) => ({
    ...row,
    asName: enrichment[row.ip]?.asName,
    asn: enrichment[row.ip]?.asn,
    country: enrichment[row.ip]?.country,
    countryCode: enrichment[row.ip]?.countryCode,
  }));

  const senderAlignment = aggregate.senderAlignment.map((row) => ({
    ...row,
    asName: enrichment[row.ip]?.asName,
    country: enrichment[row.ip]?.country,
  }));

  return {
    domain: params.domain,
    dateFilter: dateFilter ?? null,
    displayMonth,
    currentMonth,
    today: todayIso,
    aggregate: {
      ...aggregate,
      sourceIpBreakdown,
      senderAlignment,
    },
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
