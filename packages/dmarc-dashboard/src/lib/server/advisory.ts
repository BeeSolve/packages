import type { DmarcRecordDns, DomainDns, SpfMechanism } from "@beesolve/dmarc-consumer/dns-record";

import type { DomainAggregate } from "./aggregate.ts";

export const advisorySeverities = ["ok", "info", "warning", "critical"] as const;
export type AdvisorySeverity = (typeof advisorySeverities)[number];

export interface AdvisoryFinding {
  readonly id: string;
  readonly severity: AdvisorySeverity;
  readonly title: string;
  readonly detail: string;
}

/**
 * Combines the cached DNS records with the report-derived aggregate to produce
 * a list of plain-language setup findings. Pure — no I/O.
 *
 * When DNS has never been checked (`dns == null`) the record-absent findings
 * are suppressed in favour of a neutral `dns-not-checked` onboarding finding;
 * report-derived findings still render. When DNS was fetched but the lookup
 * failed (`dns != null && dns.error != null`) a `dns-unavailable` note is added
 * and report-derived findings still render.
 */
export function buildAdvisory(props: {
  readonly dns?: DomainDns;
  readonly aggregate: DomainAggregate;
}): Array<AdvisoryFinding> {
  const { dns, aggregate } = props;

  if (dns == null) {
    return [
      dnsNotCheckedFinding,
      ...spoofingFindings({ spoofingAttempts: aggregate.spoofingAttempts }),
    ];
  }

  const authFailing = aggregate.spfPassRate < 80 || aggregate.dkimPassRate < 80;

  return [
    ...dmarcFindings({ dmarc: dns.dmarc, authFailing }),
    ...spfFindings({ spf: dns.spf }),
    ...dkimFindings({ selectors: dns.dkimSelectors }),
    ...spoofingFindings({ spoofingAttempts: aggregate.spoofingAttempts }),
    ...dnsAvailabilityFindings({ dns }),
  ];
}

const dnsNotCheckedFinding: AdvisoryFinding = {
  id: "dns-not-checked",
  severity: "info",
  title: "DNS not checked yet",
  detail:
    "Run a DNS check to read this domain's SPF, DMARC and DKIM records and see its setup health. Until then, guidance is based only on observed report data.",
};

function dmarcFindings(props: {
  readonly dmarc?: DmarcRecordDns;
  readonly authFailing: boolean;
}): Array<AdvisoryFinding> {
  const { dmarc, authFailing } = props;

  if (dmarc == null || !dmarc.valid) {
    return [
      {
        id: "policy-missing",
        severity: "critical",
        title: "No DMARC record found",
        detail:
          "Publish a _dmarc TXT record (start with v=DMARC1; p=none; rua=...) so receivers report on and, once verified, act on unauthenticated mail.",
      },
    ];
  }

  const findings: Array<AdvisoryFinding> = [];

  if (dmarc.policy === "none") {
    findings.push({
      id: "policy-none",
      severity: authFailing ? "warning" : "info",
      title: "DMARC policy is p=none",
      detail: authFailing
        ? "Authentication is failing for some mail but the policy takes no action. After verifying your legitimate senders, move to p=quarantine and then p=reject to block spoofed mail."
        : "The policy is monitor-only. Once you have confirmed your legitimate senders pass, move to p=quarantine and then p=reject.",
    });
  }

  if (dmarc.pct != null && dmarc.pct < 100) {
    findings.push({
      id: "pct-partial",
      severity: "info",
      title: `DMARC policy applies to only ${String(dmarc.pct)}% of mail`,
      detail:
        "pct is below 100, so the policy is enforced on a fraction of messages. Raise pct to 100 once you are confident in your configuration.",
    });
  }

  return findings;
}

function spfFindings(props: { readonly spf?: SpfMechanism }): Array<AdvisoryFinding> {
  const { spf } = props;

  if (spf == null || !spf.valid) {
    return [
      {
        id: "spf-missing",
        severity: "warning",
        title: "No SPF record found",
        detail:
          "Publish a v=spf1 TXT record listing your authorized senders and ending in -all so receivers can verify your mail.",
      },
    ];
  }

  const findings: Array<AdvisoryFinding> = [];

  if (spf.all === "+all") {
    findings.push({
      id: "spf-softfail",
      severity: "critical",
      title: "SPF allows any sender (+all)",
      detail:
        "+all lets any server pass SPF for your domain, defeating its purpose. Replace it with -all once your authorized senders are listed.",
    });
  }

  if (spf.all === "~all" || spf.all === "?all") {
    findings.push({
      id: "spf-softfail",
      severity: "info",
      title: `SPF uses a soft qualifier (${spf.all})`,
      detail:
        "This does not hard-fail unauthorized senders. Once your legitimate senders are verified, tighten the record to -all.",
    });
  }

  if (spf.lookupCount != null && spf.lookupCount > 10) {
    findings.push({
      id: "spf-lookups",
      severity: "warning",
      title: `SPF exceeds the 10 DNS-lookup limit (${String(spf.lookupCount)})`,
      detail:
        "SPF permits at most 10 DNS lookups; beyond that, evaluation returns permerror and SPF fails. Flatten or consolidate your include mechanisms.",
    });
  }

  return findings;
}

function dkimFindings(props: {
  readonly selectors?: DomainDns["dkimSelectors"];
}): Array<AdvisoryFinding> {
  return (props.selectors ?? [])
    .filter((selector) => !selector.found)
    .map((selector) => ({
      id: `dkim-selector-missing:${selector.selector}`,
      severity: "warning",
      title: `DKIM selector "${selector.selector}" is not published`,
      detail: `Mail is being signed with the "${selector.selector}" selector, but no key is published at ${selector.selector}._domainkey. Publish or repair the DKIM key so signatures validate.`,
    }));
}

function spoofingFindings(props: { readonly spoofingAttempts: number }): Array<AdvisoryFinding> {
  if (props.spoofingAttempts <= 0) return [];

  return [
    {
      id: "spoofing-blocked",
      severity: "ok",
      title: `DMARC blocked ${String(props.spoofingAttempts)} spoofed messages`,
      detail:
        "Messages failing both SPF and DKIM were quarantined or rejected under your policy. This is DMARC working as intended.",
    },
  ];
}

function dnsAvailabilityFindings(props: { readonly dns: DomainDns }): Array<AdvisoryFinding> {
  if (props.dns.error == null) return [];

  return [
    {
      id: "dns-unavailable",
      severity: "info",
      title: "DNS records could not be read",
      detail:
        "The latest DNS lookup failed, so guidance below is based only on observed report data. Try refreshing DNS.",
    },
  ];
}
