import { getRequestEvent, query } from "$app/server";
import { dmarcRecordSchema } from "@beesolve/dmarc-parser";
import { error } from "@sveltejs/kit";
import * as v from "valibot";

import { decodeReportKey } from "#lib/reportKey.js";
import { requireDomainAccess } from "#lib/server/access.js";
import { toRemoteError } from "#lib/server/httpErrors.js";

const getReportSchema = v.object({
  domain: v.string(),
  reportId: v.string(),
});

const reportKeySchema = v.object({
  timestamp: v.number(),
  orgName: v.string(),
  reportId: v.string(),
});

export const getReport = query(getReportSchema, async ({ domain, reportId }) => {
  const { locals } = getRequestEvent();
  requireDomainAccess({ locals, domain });

  const decoded = v.safeParse(reportKeySchema, decodeReportKey(reportId));

  if (!decoded.success) {
    error(400, "Invalid report identifier");
  }

  try {
    const report = await locals.services.reports.getReport({
      domain,
      timestamp: decoded.output.timestamp,
      orgName: decoded.output.orgName,
      reportId: decoded.output.reportId,
    });

    const records = report.records.map((rawRecord) => v.parse(dmarcRecordSchema, rawRecord));

    const recordIps = [...new Set(records.map((record) => record.sourceIp))];
    const enrichment = await locals.services.ipInfoCache.getMany({ ips: recordIps });

    const enrichedRecords = records.map((record) => ({
      ...record,
      asName: enrichment[record.sourceIp]?.asName,
      asn: enrichment[record.sourceIp]?.asn,
      country: enrichment[record.sourceIp]?.country,
      countryCode: enrichment[record.sourceIp]?.countryCode,
    }));

    const rawDmarcReport = {
      reportMetadata: {
        orgName: report.orgName,
        email: report.email,
        reportId: report.reportId,
        dateRange: {
          begin: report.dateRangeBegin,
          end: report.dateRangeEnd,
        },
      },
      policyPublished: {
        domain,
        adkim: report.adkim,
        aspf: report.aspf,
        p: report.policy,
        pct: report.pct,
      },
      records,
    };

    return {
      domain,
      report: {
        orgName: report.orgName,
        reportId: report.reportId,
        email: report.email,
        dateRangeBegin: report.dateRangeBegin,
        dateRangeEnd: report.dateRangeEnd,
        adkim: report.adkim,
        aspf: report.aspf,
        policy: report.policy,
        pct: report.pct,
        totalMessages: report.totalMessages,
        totalPass: report.totalPass,
        totalFail: report.totalFail,
        records: enrichedRecords,
      },
      rawDmarcReport,
    };
  } catch (thrown) {
    toRemoteError(thrown);
  }
});
