import { resolveTxt } from "node:dns/promises";

import type { DomainDns } from "./dnsRecord.ts";
import { parseDmarcRecord, parseSpfRecord } from "./dnsRecord.ts";
import { errorMessage } from "./errorMessage.ts";

/**
 * Resolves the SPF, DMARC and DKIM DNS records for a domain into a structured
 * {@link DomainDns}. Pure resolution and parsing only — no persistence.
 *
 * Per-lookup failures are isolated so one failing record does not abort the
 * others. A top-level `error` is set only when the domain apex itself fails to
 * resolve (NXDOMAIN/ENOTFOUND), meaning the domain does not exist at all. This
 * function never throws.
 */
export async function resolveDomainDns({
  domain,
  dkimSelectors,
}: {
  domain: string;
  dkimSelectors: Array<string>;
}): Promise<DomainDns> {
  const fetchedAt = new Date().toISOString();
  const dns: DomainDns = { fetchedAt };

  try {
    const records = await resolveTxt(domain);
    const spfRaw = records
      .map((chunks) => chunks.join(""))
      .find((joined) => /^v=spf1(\s|$)/i.test(joined.trim()));
    if (spfRaw != null) {
      dns.spf = parseSpfRecord(spfRaw);
    }
  } catch (error) {
    if (isDomainMissingError(error)) {
      dns.error = errorMessage(error);
      return dns;
    }
  }

  try {
    const records = await resolveTxt(`_dmarc.${domain}`);
    const dmarcRaw = records.map((chunks) => chunks.join(""))[0];
    if (dmarcRaw != null) {
      dns.dmarc = parseDmarcRecord(dmarcRaw);
    }
  } catch {}

  dns.dkimSelectors = await Promise.all(
    dkimSelectors.map(async (selector) => {
      try {
        const records = await resolveTxt(`${selector}._domainkey.${domain}`);
        const raw = records.map((chunks) => chunks.join(""))[0];
        if (raw == null) return { selector, found: false };
        return { selector, found: true, raw };
      } catch {
        return { selector, found: false };
      }
    }),
  );

  return dns;
}

/**
 * Returns `true` when cached DNS is missing, undated, or older than `ttlMs`.
 */
export function isDnsStale({ dns, ttlMs }: { dns?: Partial<DomainDns>; ttlMs: number }): boolean {
  if (dns == null || dns.fetchedAt == null) return true;
  return Date.now() - Date.parse(dns.fetchedAt) > ttlMs;
}

function isDomainMissingError(error: unknown): boolean {
  if (!(error instanceof Error) || !("code" in error)) return false;
  return error.code === "ENOTFOUND" || error.code === "NXDOMAIN";
}
