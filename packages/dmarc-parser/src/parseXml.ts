import { XMLParser } from "fast-xml-parser";
import * as v from "valibot";

import type { DmarcReport } from "./schema.ts";
import { dmarcReportSchema } from "./schema.ts";

export function parseXml(xml: string): DmarcReport {
  const raw: unknown = parser.parse(xml);

  if (raw == null || typeof raw !== "object" || !("feedback" in raw)) {
    throw new Error("Invalid DMARC XML: missing <feedback> root element");
  }

  const transformed = v.parse(rawFeedbackSchema, raw);
  return v.parse(dmarcReportSchema, transformed);
}

const parser = new XMLParser({
  ignoreAttributes: true,
  trimValues: true,
  parseTagValue: false,
});

function ensureArray<T>(value: T | Array<T> | undefined | null): Array<T> {
  if (value == null) return [];
  if (Array.isArray(value)) return value;
  return [value];
}

const toNumber = v.pipe(v.unknown(), v.transform(Number), v.number());

function stringifyLeaf(value: unknown): string | undefined {
  if (value == null) return undefined;
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return value.toString();
  throw new Error(`Expected a leaf value but received: ${JSON.stringify(value)}`);
}

const toString = v.pipe(v.unknown(), v.transform(stringifyLeaf), v.string());

const toOptionalString = v.optional(
  v.pipe(v.unknown(), v.transform(stringifyLeaf), v.optional(v.string())),
);

const rawReasonSchema = v.looseObject({
  type: toString,
  comment: toOptionalString,
});

const rawDkimSchema = v.looseObject({
  domain: toString,
  result: toString,
  selector: toOptionalString,
});

const rawSpfSchema = v.looseObject({
  domain: toString,
  result: toString,
  scope: toOptionalString,
});

const rawRecordSchema = v.pipe(
  v.looseObject({
    row: v.looseObject({
      source_ip: toString,
      count: toNumber,
      policy_evaluated: v.looseObject({
        disposition: toString,
        dkim: toString,
        spf: toString,
        reason: v.optional(v.unknown()),
      }),
    }),
    identifiers: v.looseObject({
      header_from: toString,
      envelope_from: toOptionalString,
      envelope_to: toOptionalString,
    }),
    auth_results: v.looseObject({
      dkim: v.optional(v.unknown()),
      spf: v.optional(v.unknown()),
    }),
  }),
  v.transform((raw) => {
    const reasons = ensureArray(raw.row.policy_evaluated.reason);
    return {
      sourceIp: raw.row.source_ip,
      count: raw.row.count,
      policyEvaluated: {
        disposition: raw.row.policy_evaluated.disposition,
        dkim: raw.row.policy_evaluated.dkim,
        spf: raw.row.policy_evaluated.spf,
        reason: reasons.length > 0 ? v.parse(v.array(rawReasonSchema), reasons) : undefined,
      },
      identifiers: {
        headerFrom: raw.identifiers.header_from,
        envelopeFrom: raw.identifiers.envelope_from,
        envelopeTo: raw.identifiers.envelope_to,
      },
      authResults: {
        dkim: v.parse(v.array(rawDkimSchema), ensureArray(raw.auth_results.dkim)),
        spf: v.parse(v.array(rawSpfSchema), ensureArray(raw.auth_results.spf)),
      },
    };
  }),
);

const rawFeedbackSchema = v.pipe(
  v.looseObject({
    feedback: v.looseObject({
      version: toOptionalString,
      report_metadata: v.looseObject({
        org_name: toString,
        email: toString,
        extra_contact_info: toOptionalString,
        report_id: toString,
        date_range: v.looseObject({
          begin: toNumber,
          end: toNumber,
        }),
        error: v.optional(v.unknown()),
      }),
      policy_published: v.looseObject({
        domain: toString,
        adkim: toString,
        aspf: toString,
        p: toString,
        sp: toOptionalString,
        np: toOptionalString,
        pct: toNumber,
        fo: toOptionalString,
      }),
      record: v.unknown(),
    }),
  }),
  v.transform((raw) => {
    const meta = raw.feedback.report_metadata;
    const policy = raw.feedback.policy_published;
    const errors = ensureArray(meta.error).map(String);
    const records = v.parse(v.array(rawRecordSchema), ensureArray(raw.feedback.record));

    return {
      version: raw.feedback.version,
      reportMetadata: {
        orgName: meta.org_name,
        email: meta.email,
        extraContactInfo: meta.extra_contact_info,
        reportId: meta.report_id,
        dateRange: meta.date_range,
        errors: errors.length > 0 ? errors : undefined,
      },
      policyPublished: {
        domain: policy.domain,
        adkim: policy.adkim,
        aspf: policy.aspf,
        p: policy.p,
        sp: policy.sp,
        np: policy.np,
        pct: policy.pct,
        fo: policy.fo,
      },
      records,
    };
  }),
);
