import { requireDomainAccess } from "$lib/server/access.js";
import { buildAdvisory } from "$lib/server/advisory.js";
import { aggregateReports } from "$lib/server/aggregate.js";
import { fail } from "@sveltejs/kit";
import * as v from "valibot";

import type { Actions, PageServerLoad } from "./$types.js";

export const load: PageServerLoad = async ({ params, locals, url }) => {
  requireDomainAccess({ locals, domain: params.domain });

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

  const [domainRecord, dnsRefreshStatuses, ipBackfillStatuses] = await Promise.all([
    locals.services.domains.getByDomain({ domain: params.domain }),
    locals.services.adminSdk.getDnsRefreshStatuses(),
    locals.services.adminSdk.getIpBackfillStatuses(),
  ]);
  const dns = domainRecord?.dns;
  const advisory = buildAdvisory({ dns, aggregate });
  const dnsRefreshStatus = dnsRefreshStatuses[params.domain] ?? { canRun: true };
  const ipBackfillStatus = ipBackfillStatuses[params.domain] ?? { canRun: true };

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
    dns: dns ?? null,
    advisory,
    dnsRefreshStatus,
    ipBackfillStatus,
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

export const actions: Actions = {
  default: async ({ request, params, locals }) => {
    const { domain } = params;
    requireDomainAccess({ locals, domain });

    const formData = await request.formData();
    const intentResult = v.safeParse(
      v.picklist(["refresh-dns", "refresh-ips"]),
      formData.get("intent"),
    );
    if (!intentResult.success) {
      return fail(400, { error: "Invalid action." });
    }
    const intent = intentResult.output;

    if (intent === "refresh-dns") {
      const result = await locals.services.adminSdk.startDnsRefresh({ domain });
      if (!result.enqueued) {
        return fail(409, { intent, error: "A DNS refresh is already running for this domain." });
      }
      return { intent, started: true };
    }

    const result = await locals.services.adminSdk.startIpBackfill({ domain });
    if (!result.enqueued) {
      return fail(409, { intent, error: "An IP refresh is already running for this domain." });
    }
    return { intent, started: true };
  },
};
