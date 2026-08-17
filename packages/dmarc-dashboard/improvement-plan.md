# DMARC Dashboard — Improvement Plan

Based on competitive research of paid DMARC reporting platforms (dmarcian, Valimail, Proofpoint Email Fraud Defense, Red Sift OnDMARC, URIports, PowerDMARC, Postmark DMARC).

## Current State

The dashboard already provides:

- Domain overview with aggregate pass/fail rates
- Per-domain drill-down with SPF/DKIM pass rates and source IP analysis
- Individual report detail view (records, auth results, dispositions)
- Calendar-based date filtering
- Processing stats with daily breakdown
- Multi-user access with domain-level permissions

## Improvement Ideas (Prioritized)

### 1. Trend/Timeline Charts

**What competitors do:** Every major player shows pass rate and email volume over time as line/area charts. This is the single most impactful visual for spotting regressions, attacks, or misconfigurations.

**Implementation:** We already have the data — aggregate pass/fail counts per report with timestamps. A time-series chart (30-day or 90-day view) per domain showing volume and pass rate would match what all paid tools provide.

**Effort:** Medium — needs a charting library (e.g. Chart.js, or lightweight SVG-based) and a new API endpoint that returns daily aggregates over a date range.

---

### 2. Sender/Source Identification (Reverse DNS & Known Sender Labels)

**What competitors do:** dmarcian's "Source Viewer" and Valimail's "Monitor" translate raw IPs into recognizable sender names (Google, Amazon SES, Mailchimp, SendGrid, etc.). This is the #1 feature that makes DMARC data actionable for non-technical users.

**Implementation:** Maintain a mapping of known IP ranges → sender names. Could be a static JSON file updated periodically, or a reverse DNS lookup at report-processing time. Show "Google (209.85.x.x)" instead of just the IP.

**Effort:** Medium — needs an IP-to-sender classification database. Could start with a curated static list of major ESPs, then add rDNS fallback.

---

### 3. Policy Progression Guidance

**What competitors do:** Show the current DMARC/SPF/DKIM record for each domain, validate it, and provide step-by-step guidance to move from p=none → p=quarantine → p=reject. Red Sift OnDMARC claims 6-8 week average to full enforcement with their guidance.

**Implementation:** DNS lookup for the domain's DMARC/SPF/DKIM records, validate syntax, show current state and a "readiness score" indicating whether it's safe to tighten policy based on recent pass rates.

**Effort:** Medium-High — needs DNS resolution at query time or periodic background checks, plus a recommendation engine.

---

### 4. Alerts & Notifications

**What competitors do:** dmarcian "Alert Central", URIports push/email/webhook notifications. Alerts for: new sending IPs, traffic spikes, pass rate drops, DNS record changes.

**Implementation:** Background job (Lambda on a schedule) that compares current day's data to historical baseline. Send alerts via the existing email service when anomalies detected.

**Effort:** Medium — needs a threshold/anomaly detection strategy and a notification preferences UI.

---

### 5. Geographic/GeoIP Mapping

**What competitors do:** dmarcian and Proofpoint show a world map of where emails originate. Useful for spotting abuse from unexpected countries.

**Implementation:** GeoIP lookup on source IPs (MaxMind GeoLite2 or similar). Could be done at ingestion time (store country code) or at display time. Show a map visualization on the domain page.

**Effort:** Medium — needs a GeoIP database and a map visualization component.

---

### 6. DMARC Failure/Forensic Reports (RUF)

**What competitors do:** URIports and PowerDMARC process RUF (failure) reports which contain per-message details about authentication failures, including headers and delivery info.

**Implementation:** Would require accepting RUF reports (separate from RUA aggregate reports), parsing them, and displaying per-message forensic data. Note: many receivers don't send RUF reports, and they may contain PII requiring encryption (URIports uses OpenPGP).

**Effort:** High — new ingestion pipeline, privacy considerations.

---

### 7. DNS Record Monitoring

**What competitors do:** URIports monitors SPF/DKIM/DMARC/MTA-STS DNS records for changes and alerts on unauthorized modifications or syntax errors.

**Implementation:** Periodic DNS resolution for each monitored domain's authentication records. Compare to previous known-good state. Alert on changes.

**Effort:** Low-Medium — straightforward DNS checks on a schedule.

---

### 8. Subdomain Discovery

**What competitors do:** dmarcian and OnDMARC automatically discover subdomains from DMARC aggregate report data (subdomains appear in reports when mail is sent from them).

**Implementation:** We already receive reports that may include subdomains. Could extract unique subdomains from report data and surface them in the UI with their authentication status.

**Effort:** Low — data likely already exists in reports, just needs extraction and display.

---

### 9. Executive/Compliance Dashboard

**What competitors do:** Fortra/Agari provides board-level metrics: total domains protected, enforcement status across portfolio, total threats blocked, compliance status (PCI DSS 4.0.1, Google/Yahoo requirements).

**Implementation:** A summary page showing enforcement status per domain, overall compliance posture, and aggregate threat metrics.

**Effort:** Low — mostly a new summary view of existing data.

---

### 10. Lookalike Domain Detection

**What competitors do:** Proofpoint scans 650M+ domains for lookalikes. OnDMARC flags cousin domains.

**Implementation:** Would require external domain monitoring infrastructure. Likely out of scope for a self-hosted tool but could integrate with third-party threat feeds.

**Effort:** Very High — needs external data sources.

---

## Recommended Priority Order

1. **Trend charts** — highest impact, data already available
2. **Sender identification** — makes the tool usable by non-technical users
3. **Executive/compliance dashboard** — low effort, high perceived value
4. **Subdomain discovery** — low effort, data likely already present
5. **DNS record monitoring** — straightforward, proactive security
6. **Alerts & notifications** — builds on all above
7. **Policy guidance** — differentiator for onboarding users
8. **GeoIP mapping** — visual appeal, moderate effort
9. **Forensic reports** — high effort, limited receiver support
10. **Lookalike detection** — requires external infrastructure

## References

- [dmarcian DMARC Management Platform](https://dmarcian.com/dmarc-management-platform/)
- [Valimail Products](https://www.valimail.com/products/)
- [Red Sift OnDMARC](https://ondmarc.com/features)
- [Proofpoint Email Fraud Defense](https://www.proofpoint.com/us/products/email-protection/email-fraud-defense)
- [URIports DMARC](https://www.uriports.com/dmarc)
- [Fortra DMARC Protection](https://www.agari.com/products/dmarc-protection)
- [Postmark DMARC](https://dmarc.postmarkapp.com/)
