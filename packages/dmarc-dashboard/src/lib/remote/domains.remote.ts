import { getRequestEvent, form, query } from "$app/server";
import { invalid } from "@sveltejs/kit";
import * as v from "valibot";

import { requireDomainAccess } from "#lib/server/access.js";
import { buildAdvisory } from "#lib/server/advisory.js";
import { aggregateReports } from "#lib/server/aggregate.js";
import { requireUser, toRemoteError } from "#lib/server/httpErrors.js";

export const listDomains = query(async () => {
  const { locals } = getRequestEvent();
  const { services, user } = locals;
  try {
    const currentUser = requireUser(user);
    const allDomains = await services.domains.list();
    const visibleDomains =
      currentUser.type === "admin"
        ? allDomains
        : allDomains.filter((domain) => currentUser.domains.includes(domain.domain));

    return visibleDomains.map((domain) => ({
      domain: domain.domain,
      totalMessages: domain.totalMessages,
      totalPass: domain.totalPass,
      totalFail: domain.totalFail,
    }));
  } catch (error) {
    toRemoteError(error, { redirectOnUnauthorized: true });
  }
});

const getDomainOverviewSchema = v.object({
  domain: v.string(),
  cursor: v.optional(v.string()),
  date: v.optional(v.string()),
  month: v.optional(v.string()),
});

export const getDomainOverview = query(
  getDomainOverviewSchema,
  async ({ domain, cursor, date, month }) => {
    const { locals } = getRequestEvent();
    try {
      requireDomainAccess({ locals, domain });

      const queryParams: {
        domain: string;
        startTime?: number;
        endTime?: number;
        cursor?: string;
        limit?: number;
      } = {
        domain,
        cursor,
        limit: 50,
      };

      if (date != null) {
        const dayStart = Date.parse(`${date}T00:00:00Z`);
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
        month != null && monthPattern.test(month)
          ? month
          : date != null
            ? date.slice(0, 7)
            : currentMonth;
      const displayMonth = requestedMonth > currentMonth ? currentMonth : requestedMonth;
      const todayIso = `${currentMonth}-${String(now.getUTCDate()).padStart(2, "0")}`;

      const aggregate = aggregateReports(result.reports);

      const [domainRecord, dnsRefreshStatuses, ipBackfillStatuses] = await Promise.all([
        locals.services.domains.getByDomain({ domain }),
        locals.services.adminSdk.getDnsRefreshStatuses(),
        locals.services.adminSdk.getIpBackfillStatuses(),
      ]);
      const dns = domainRecord?.dns;
      const advisory = buildAdvisory({ dns, aggregate });
      const dnsRefreshStatus = dnsRefreshStatuses[domain] ?? { canRun: true };
      const ipBackfillStatus = ipBackfillStatuses[domain] ?? { canRun: true };

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
        domain,
        dateFilter: date ?? null,
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
    } catch (error) {
      toRemoteError(error, { redirectOnUnauthorized: true });
    }
  },
);

const refreshIntents = ["refresh-dns", "refresh-ips"] as const;

const refreshDomainSchema = v.object({
  domain: v.string(),
  intent: v.picklist(refreshIntents),
});

export const refreshDomain = form(refreshDomainSchema, async ({ domain, intent }) => {
  const { locals } = getRequestEvent();

  requireDomainAccess({ locals, domain });

  if (intent === "refresh-dns") {
    const result = await locals.services.adminSdk.startDnsRefresh({ domain });
    if (!result.enqueued) {
      invalid("A DNS refresh is already running for this domain.");
    }
  } else {
    const result = await locals.services.adminSdk.startIpBackfill({ domain });
    if (!result.enqueued) {
      invalid("An IP refresh is already running for this domain.");
    }
  }

  return { intent, started: true };
});
