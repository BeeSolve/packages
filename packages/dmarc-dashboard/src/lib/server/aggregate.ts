import type { Report } from "@beesolve/dmarc-consumer/report";
import { dmarcRecordSchema } from "@beesolve/dmarc-parser";
import * as v from "valibot";

export interface SourceIpBreakdown {
  ip: string;
  count: number;
  spfPass: number;
  spfFail: number;
  dkimPass: number;
  dkimFail: number;
  dispositions: Array<string>;
}

export interface DomainAggregate {
  totalMessages: number;
  totalPass: number;
  totalFail: number;
  uniqueIps: number;
  reportCount: number;
  spfPassRate: number;
  dkimPassRate: number;
  sourceIpBreakdown: Array<SourceIpBreakdown>;
}

export function aggregateReports(reports: Array<Report>): DomainAggregate {
  const ipMap = new Map<
    string,
    {
      count: number;
      spfPass: number;
      spfFail: number;
      dkimPass: number;
      dkimFail: number;
      dispositions: Set<string>;
    }
  >();

  let totalMessages = 0;
  let totalPass = 0;
  let totalFail = 0;
  let spfPassMessages = 0;
  let spfFailMessages = 0;
  let dkimPassMessages = 0;
  let dkimFailMessages = 0;

  for (const report of reports) {
    totalMessages += report.totalMessages;
    totalPass += report.totalPass;
    totalFail += report.totalFail;

    for (const rawRecord of report.records) {
      const parsed = v.safeParse(dmarcRecordSchema, rawRecord);
      if (!parsed.success) continue;
      const record = parsed.output;

      const existing = ipMap.get(record.sourceIp);
      const spfPass = record.policyEvaluated.spf === "pass";
      const dkimPass = record.policyEvaluated.dkim === "pass";

      if (spfPass) {
        spfPassMessages += record.count;
      } else {
        spfFailMessages += record.count;
      }

      if (dkimPass) {
        dkimPassMessages += record.count;
      } else {
        dkimFailMessages += record.count;
      }

      if (existing != null) {
        existing.count += record.count;
        if (spfPass) existing.spfPass += record.count;
        else existing.spfFail += record.count;
        if (dkimPass) existing.dkimPass += record.count;
        else existing.dkimFail += record.count;
        existing.dispositions.add(record.policyEvaluated.disposition);
      } else {
        ipMap.set(record.sourceIp, {
          count: record.count,
          spfPass: spfPass ? record.count : 0,
          spfFail: spfPass ? 0 : record.count,
          dkimPass: dkimPass ? record.count : 0,
          dkimFail: dkimPass ? 0 : record.count,
          dispositions: new Set([record.policyEvaluated.disposition]),
        });
      }
    }
  }

  const sourceIpBreakdown = Array.from(ipMap.entries())
    .map(([ip, data]) => ({
      ip,
      count: data.count,
      spfPass: data.spfPass,
      spfFail: data.spfFail,
      dkimPass: data.dkimPass,
      dkimFail: data.dkimFail,
      dispositions: Array.from(data.dispositions),
    }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 20);

  const totalSpf = spfPassMessages + spfFailMessages;
  const totalDkim = dkimPassMessages + dkimFailMessages;

  return {
    totalMessages,
    totalPass,
    totalFail,
    uniqueIps: ipMap.size,
    reportCount: reports.length,
    spfPassRate: totalSpf > 0 ? Math.round((spfPassMessages / totalSpf) * 100) : 0,
    dkimPassRate: totalDkim > 0 ? Math.round((dkimPassMessages / totalDkim) * 100) : 0,
    sourceIpBreakdown,
  };
}
