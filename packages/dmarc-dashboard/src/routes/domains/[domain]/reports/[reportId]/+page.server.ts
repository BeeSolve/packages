import { ReportNotFoundError } from "@beesolve/dmarc-consumer/report";
import { dmarcRecordSchema } from "@beesolve/dmarc-parser";
import { error } from "@sveltejs/kit";
import * as v from "valibot";

import type { PageServerLoad } from "./$types.js";

const reportKeySchema = v.object({
  timestamp: v.number(),
  orgName: v.string(),
  reportId: v.string(),
});

export const load: PageServerLoad = async ({ params, locals }) => {
  const user = locals.user;
  if (user == null) {
    error(403, "Access denied");
  }

  if (user.type !== "admin" && !user.domains.includes(params.domain)) {
    error(403, "Access denied — you do not have access to this domain");
  }

  const decoded = v.safeParse(
    reportKeySchema,
    JSON.parse(Buffer.from(params.reportId, "base64url").toString()),
  );

  if (!decoded.success) {
    error(400, "Invalid report identifier");
  }

  try {
    const report = await locals.services.reports.getReport({
      domain: params.domain,
      timestamp: decoded.output.timestamp,
      orgName: decoded.output.orgName,
      reportId: decoded.output.reportId,
    });

    return {
      domain: params.domain,
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
        records: report.records.map((rawRecord) => v.parse(dmarcRecordSchema, rawRecord)),
      },
    };
  } catch (thrown) {
    if (thrown instanceof ReportNotFoundError) {
      error(404, "Report not found");
    }
    throw thrown;
  }
};
