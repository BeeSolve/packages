import type { Report } from "@beesolve/dmarc-consumer/report";
import { dmarcRecordSchema } from "@beesolve/dmarc-parser";
import * as v from "valibot";

export const sourceIpVerdicts = ["legitimate", "forwarded", "spoofing", "suspicious"] as const;
export type SourceIpVerdict = (typeof sourceIpVerdicts)[number];

export interface SourceIpBreakdown {
  ip: string;
  count: number;
  spfPass: number;
  spfFail: number;
  dkimPass: number;
  dkimFail: number;
  dispositions: Array<string>;
  headerFroms: Array<string>;
  spfResults: Array<string>;
  dkimResults: Array<string>;
  policyReasons: Array<string>;
  verdict: SourceIpVerdict;
}

export interface SenderAlignment {
  ip: string;
  asName?: string;
  count: number;
  spfAligned: boolean;
  dkimAligned: boolean;
}

export interface DomainAggregate {
  totalMessages: number;
  totalPass: number;
  totalFail: number;
  uniqueIps: number;
  reportCount: number;
  spfPassRate: number;
  dkimPassRate: number;
  spoofingAttempts: number;
  sourceIpBreakdown: Array<SourceIpBreakdown>;
  senderAlignment: Array<SenderAlignment>;
}

interface IpAccumulator {
  count: number;
  spfPass: number;
  spfFail: number;
  dkimPass: number;
  dkimFail: number;
  dispositions: Set<string>;
  headerFroms: Set<string>;
  spfResults: Set<string>;
  dkimResults: Set<string>;
  policyReasons: Set<string>;
}

export function aggregateReports(reports: Array<Report>): DomainAggregate {
  const ipMap = new Map<string, IpAccumulator>();

  let totalMessages = 0;
  let totalPass = 0;
  let totalFail = 0;
  let spfPassMessages = 0;
  let spfFailMessages = 0;
  let dkimPassMessages = 0;
  let dkimFailMessages = 0;
  let spoofingAttempts = 0;

  for (const report of reports) {
    totalMessages += report.totalMessages;
    totalPass += report.totalPass;
    totalFail += report.totalFail;

    for (const rawRecord of report.records) {
      const parsed = v.safeParse(dmarcRecordSchema, rawRecord);
      if (!parsed.success) continue;
      const record = parsed.output;

      const spfPass = record.policyEvaluated.spf === "pass";
      const dkimPass = record.policyEvaluated.dkim === "pass";
      const acted = record.policyEvaluated.disposition !== "none";

      if (spfPass) spfPassMessages += record.count;
      else spfFailMessages += record.count;

      if (dkimPass) dkimPassMessages += record.count;
      else dkimFailMessages += record.count;

      if (!spfPass && !dkimPass && acted) {
        spoofingAttempts += record.count;
      }

      const accumulator = ipMap.get(record.sourceIp) ?? createAccumulator();
      accumulator.count += record.count;
      if (spfPass) accumulator.spfPass += record.count;
      else accumulator.spfFail += record.count;
      if (dkimPass) accumulator.dkimPass += record.count;
      else accumulator.dkimFail += record.count;
      accumulator.dispositions.add(record.policyEvaluated.disposition);
      accumulator.headerFroms.add(record.identifiers.headerFrom);

      for (const spfResult of record.authResults.spf) {
        accumulator.spfResults.add(spfResult.result);
      }
      for (const dkimResult of record.authResults.dkim) {
        accumulator.dkimResults.add(dkimResult.result);
      }
      for (const reason of record.policyEvaluated.reason ?? []) {
        accumulator.policyReasons.add(
          reason.comment != null ? `${reason.type}: ${reason.comment}` : reason.type,
        );
      }

      ipMap.set(record.sourceIp, accumulator);
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
      headerFroms: Array.from(data.headerFroms),
      spfResults: Array.from(data.spfResults),
      dkimResults: Array.from(data.dkimResults),
      policyReasons: Array.from(data.policyReasons),
      verdict: classifyVerdict(data),
    }))
    .sort((first, second) => second.count - first.count)
    .slice(0, 20);

  const senderAlignment = Array.from(ipMap.entries())
    .filter(([, data]) => data.spfPass > 0 || data.dkimPass > 0)
    .map(([ip, data]) => ({
      ip,
      count: data.count,
      spfAligned: data.spfPass > 0,
      dkimAligned: data.dkimPass > 0,
    }))
    .sort((first, second) => second.count - first.count);

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
    spoofingAttempts,
    sourceIpBreakdown,
    senderAlignment,
  };
}

// Plain-language verdict for a source IP, derived from DMARC-evaluated results:
// - legitimate: at least some mail passed both SPF and DKIM and nothing was acted on
// - forwarded: DMARC passed (via SPF or DKIM alignment) but not both — typical of forwards/lists
// - spoofing: both SPF and DKIM failed and the policy acted (quarantine/reject)
// - suspicious: failures present but not cleanly matching the above
function classifyVerdict(data: IpAccumulator): SourceIpVerdict {
  const acted = data.dispositions.size > 0 && !onlyNone(data.dispositions);
  const anySpfPass = data.spfPass > 0;
  const anyDkimPass = data.dkimPass > 0;
  const anyFail = data.spfFail > 0 || data.dkimFail > 0;

  if (!anySpfPass && !anyDkimPass && acted) return "spoofing";
  if (anySpfPass && anyDkimPass && !acted) return "legitimate";
  if ((anySpfPass || anyDkimPass) && !acted) return "forwarded";
  if (anyFail) return "suspicious";
  return "legitimate";
}

function onlyNone(dispositions: Set<string>): boolean {
  for (const disposition of dispositions) {
    if (disposition !== "none") return false;
  }
  return true;
}

function createAccumulator(): IpAccumulator {
  return {
    count: 0,
    spfPass: 0,
    spfFail: 0,
    dkimPass: 0,
    dkimFail: 0,
    dispositions: new Set<string>(),
    headerFroms: new Set<string>(),
    spfResults: new Set<string>(),
    dkimResults: new Set<string>(),
    policyReasons: new Set<string>(),
  };
}
