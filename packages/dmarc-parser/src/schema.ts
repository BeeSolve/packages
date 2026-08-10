import * as v from "valibot";

const alignmentSchema = v.picklist(["r", "s"]);

const dispositionSchema = v.picklist(["none", "quarantine", "reject"]);

const dkimSpfResultSchema = v.picklist(["pass", "fail"]);

const policySchema = v.picklist(["none", "quarantine", "reject"]);

const dateRangeSchema = v.object({
  begin: v.number(),
  end: v.number(),
});

const reportMetadataSchema = v.object({
  orgName: v.string(),
  email: v.string(),
  extraContactInfo: v.optional(v.string()),
  reportId: v.string(),
  dateRange: dateRangeSchema,
  errors: v.optional(v.array(v.string())),
});

const policyPublishedSchema = v.object({
  domain: v.string(),
  adkim: alignmentSchema,
  aspf: alignmentSchema,
  p: policySchema,
  sp: v.optional(policySchema),
  np: v.optional(policySchema),
  pct: v.number(),
  fo: v.optional(v.string()),
});

const policyOverrideReasonSchema = v.object({
  type: v.string(),
  comment: v.optional(v.string()),
});

const policyEvaluatedSchema = v.object({
  disposition: dispositionSchema,
  dkim: dkimSpfResultSchema,
  spf: dkimSpfResultSchema,
  reason: v.optional(v.array(policyOverrideReasonSchema)),
});

const identifiersSchema = v.object({
  headerFrom: v.string(),
  envelopeFrom: v.optional(v.string()),
  envelopeTo: v.optional(v.string()),
});

const dkimAuthResultSchema = v.object({
  domain: v.string(),
  result: v.string(),
  selector: v.optional(v.string()),
});

const spfAuthResultSchema = v.object({
  domain: v.string(),
  result: v.string(),
  scope: v.optional(v.string()),
});

const authResultsSchema = v.object({
  dkim: v.array(dkimAuthResultSchema),
  spf: v.array(spfAuthResultSchema),
});

const dmarcRecordSchema = v.object({
  sourceIp: v.string(),
  count: v.number(),
  policyEvaluated: policyEvaluatedSchema,
  identifiers: identifiersSchema,
  authResults: authResultsSchema,
});

export const dmarcReportSchema = v.object({
  version: v.optional(v.string()),
  reportMetadata: reportMetadataSchema,
  policyPublished: policyPublishedSchema,
  records: v.array(dmarcRecordSchema),
});

export type DmarcReport = v.InferOutput<typeof dmarcReportSchema>;
export type DmarcRecord = v.InferOutput<typeof dmarcRecordSchema>;
export type ReportMetadata = v.InferOutput<typeof reportMetadataSchema>;
export type PolicyPublished = v.InferOutput<typeof policyPublishedSchema>;
export type PolicyEvaluated = v.InferOutput<typeof policyEvaluatedSchema>;
export type AuthResults = v.InferOutput<typeof authResultsSchema>;
export type DkimAuthResult = v.InferOutput<typeof dkimAuthResultSchema>;
export type SpfAuthResult = v.InferOutput<typeof spfAuthResultSchema>;
