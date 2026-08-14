export type { DmarcReport } from "@beesolve/dmarc-parser";
import { dmarcReportSchema } from "@beesolve/dmarc-parser";
import * as v from "valibot";

export const eventSource = "dmarc-reports";
export const detailType = "DmarcReportParsed";

export const dmarcReportParsedEventSchema = v.object({
  source: v.literal(eventSource),
  "detail-type": v.literal(detailType),
  detail: dmarcReportSchema,
});

export type DmarcReportParsedEvent = v.InferOutput<typeof dmarcReportParsedEventSchema>;

export function isDmarcReportParsedEvent(event: unknown): event is DmarcReportParsedEvent {
  return v.safeParse(dmarcReportParsedEventSchema, event).success;
}
