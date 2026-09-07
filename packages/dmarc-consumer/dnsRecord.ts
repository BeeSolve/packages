import * as v from "valibot";

export const spfAllQualifiers = ["-all", "~all", "?all", "+all"] as const;
export type SpfAllQualifier = (typeof spfAllQualifiers)[number];

export const spfMechanismSchema = v.object({
  raw: v.string(),
  all: v.optional(v.picklist(spfAllQualifiers)),
  lookupCount: v.optional(v.number()),
  valid: v.boolean(),
});

export type SpfMechanism = v.InferOutput<typeof spfMechanismSchema>;

export const dmarcPolicies = ["none", "quarantine", "reject"] as const;
export type DmarcPolicy = (typeof dmarcPolicies)[number];

export const alignmentModes = ["r", "s"] as const;
export type AlignmentMode = (typeof alignmentModes)[number];

export const dmarcRecordDnsSchema = v.object({
  raw: v.string(),
  policy: v.optional(v.picklist(dmarcPolicies)),
  subdomainPolicy: v.optional(v.picklist(dmarcPolicies)),
  pct: v.optional(v.number()),
  adkim: v.optional(v.picklist(alignmentModes)),
  aspf: v.optional(v.picklist(alignmentModes)),
  rua: v.optional(v.array(v.string())),
  valid: v.boolean(),
});

export type DmarcRecordDns = v.InferOutput<typeof dmarcRecordDnsSchema>;

export const dkimSelectorSchema = v.object({
  selector: v.string(),
  found: v.boolean(),
  raw: v.optional(v.string()),
});

export type DkimSelector = v.InferOutput<typeof dkimSelectorSchema>;

export const domainDnsSchema = v.object({
  fetchedAt: v.string(),
  spf: v.optional(spfMechanismSchema),
  dmarc: v.optional(dmarcRecordDnsSchema),
  dkimSelectors: v.optional(v.array(dkimSelectorSchema)),
  error: v.optional(v.string()),
});

export type DomainDns = v.InferOutput<typeof domainDnsSchema>;

const spfLookupMechanisms = ["include:", "a", "mx", "ptr", "exists:", "redirect="] as const;

/**
 * Parses a raw SPF TXT record into a structured {@link SpfMechanism}.
 *
 * Non-`v=spf1` records are returned with `valid: false` while preserving `raw`.
 */
export function parseSpfRecord(txt: string): SpfMechanism {
  const raw = txt.trim();

  if (!/^v=spf1(\s|$)/i.test(raw)) {
    return { raw, valid: false };
  }

  const terms = raw.split(/\s+/);

  const all = spfAllQualifiers.find((qualifier) => terms.includes(qualifier));

  const lookupCount = terms.reduce((count, term) => {
    const normalized = term.toLowerCase();
    const isLookup = spfLookupMechanisms.some((mechanism) => {
      if (mechanism === "a" || mechanism === "mx" || mechanism === "ptr") {
        return (
          normalized === mechanism ||
          normalized === `+${mechanism}` ||
          normalized.startsWith(`${mechanism}:`) ||
          normalized.startsWith(`${mechanism}/`)
        );
      }
      return normalized.startsWith(mechanism);
    });
    return isLookup ? count + 1 : count;
  }, 0);

  return { raw, all, lookupCount, valid: true };
}

/**
 * Parses a raw DMARC TXT record into a structured {@link DmarcRecordDns}.
 *
 * Non-`v=DMARC1` records are returned with `valid: false` while preserving `raw`.
 */
export function parseDmarcRecord(txt: string): DmarcRecordDns {
  const raw = txt.trim();

  if (!/^v=DMARC1\b/i.test(raw)) {
    return { raw, valid: false };
  }

  const tags: Record<string, string> = {};
  for (const segment of raw.split(";")) {
    const [key, ...rest] = segment.split("=");
    const tagName = key?.trim().toLowerCase();
    if (tagName == null || tagName === "" || rest.length === 0) continue;
    tags[tagName] = rest.join("=").trim();
  }

  const parsed: DmarcRecordDns = { raw, valid: true };

  const policy = dmarcPolicies.find((candidate) => candidate === tags.p);
  if (policy != null) parsed.policy = policy;

  const subdomainPolicy = dmarcPolicies.find((candidate) => candidate === tags.sp);
  if (subdomainPolicy != null) parsed.subdomainPolicy = subdomainPolicy;

  if (tags.pct != null) {
    const pct = Number(tags.pct);
    if (!Number.isNaN(pct)) parsed.pct = pct;
  }

  const adkim = alignmentModes.find((candidate) => candidate === tags.adkim);
  if (adkim != null) parsed.adkim = adkim;

  const aspf = alignmentModes.find((candidate) => candidate === tags.aspf);
  if (aspf != null) parsed.aspf = aspf;

  if (tags.rua != null && tags.rua !== "") {
    parsed.rua = tags.rua
      .split(",")
      .map((address) => address.trim().replace(/^mailto:/i, ""))
      .filter((address) => address !== "");
  }

  return parsed;
}
