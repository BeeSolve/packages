import { EventBridgeClient, PutEventsCommand } from "@aws-sdk/client-eventbridge";
import { GetObjectCommand, S3Client } from "@aws-sdk/client-s3";
import type { DmarcReport } from "@beesolve/dmarc-parser";
import { decompress, extractFromEmail, parseXml } from "@beesolve/dmarc-parser";
import { keptActive } from "@beesolve/lambda-keep-active/runtime";
import * as v from "valibot";

import type { StatsCounter } from "../index.ts";
import { detailType, eventSource, statsDetailType } from "../index.ts";

const envSchema = v.object({
  EVENT_BUS_ARN: v.string(),
});
const env = v.parse(envSchema, process.env);

const s3 = new S3Client();
const eventBridge = new EventBridgeClient();

const s3EventSchema = v.object({
  detail: v.object({
    bucket: v.object({ name: v.string() }),
    object: v.object({ key: v.string() }),
  }),
});

type AuthResult =
  | { status: "pass" }
  | { status: "manual" }
  | { status: "authRejected" }
  | { status: "spamRejected" }
  | { status: "virusRejected" };

export const handler = keptActive(async (event: unknown, _context: unknown): Promise<void> => {
  const { detail } = v.parse(s3EventSchema, event);
  const bucketName = detail.bucket.name;
  const objectKey = detail.object.key;

  const body = await fetchObject({ bucket: bucketName, key: objectKey });

  const authResult = checkEmailAuthentication({ body });

  if (authResult.status === "authRejected") {
    console.warn("Skipping email: authentication failed");
    await emitStats({ counter: "authRejected", value: 1 });
    return;
  }

  if (authResult.status === "spamRejected") {
    console.warn("Skipping email: flagged as spam by SES");
    await emitStats({ counter: "spamRejected", value: 1 });
    return;
  }

  if (authResult.status === "virusRejected") {
    console.warn("Skipping email: flagged as containing a virus by SES");
    await emitStats({ counter: "virusRejected", value: 1 });
    return;
  }

  if (authResult.status === "manual") {
    await emitStats({ counter: "manualUpload", value: 1 });
  }

  const reports = await parseReports({ body, objectKey });

  await emitEvents({ reports });

  if (reports.length > 0) {
    await emitStats({ counter: "processed", value: reports.length });
  }
});

interface EmitStatsProps {
  counter: StatsCounter;
  value: number;
}

async function emitStats(props: EmitStatsProps): Promise<void> {
  await eventBridge.send(
    new PutEventsCommand({
      Entries: [
        {
          Source: eventSource,
          DetailType: statsDetailType,
          Detail: JSON.stringify({ counter: props.counter, value: props.value }),
          EventBusName: env.EVENT_BUS_ARN,
        },
      ],
    }),
  );
}

interface FetchObjectProps {
  bucket: string;
  key: string;
}

async function fetchObject(props: FetchObjectProps): Promise<Buffer> {
  const response = await s3.send(new GetObjectCommand({ Bucket: props.bucket, Key: props.key }));

  if (response.Body == null) {
    throw new Error(`Empty response body for s3://${props.bucket}/${props.key}`);
  }

  return Buffer.from(await response.Body.transformToByteArray());
}

interface CheckEmailAuthenticationProps {
  body: Buffer;
}

function checkEmailAuthentication(props: CheckEmailAuthenticationProps): AuthResult {
  const headerSection = props.body.subarray(0, 8192).toString("utf-8");

  const authResults = extractAuthenticationResults({ headers: headerSection });

  if (authResults == null) {
    return { status: "manual" };
  }

  const spfResult = extractAuthMethod({ value: authResults, method: "spf" });
  const dkimResult = extractAuthMethod({ value: authResults, method: "dkim" });

  const spfPass = spfResult === "pass";
  const dkimPass = dkimResult === "pass";

  if (!spfPass && !dkimPass) {
    return { status: "authRejected" };
  }

  const spamVerdict = extractSesVerdict({ headers: headerSection, name: "X-SES-Spam-Verdict" });
  const virusVerdict = extractSesVerdict({ headers: headerSection, name: "X-SES-Virus-Verdict" });

  if (spamVerdict === "FAIL") {
    return { status: "spamRejected" };
  }

  if (virusVerdict === "FAIL") {
    return { status: "virusRejected" };
  }

  return { status: "pass" };
}

interface ExtractAuthenticationResultsProps {
  headers: string;
}

function extractAuthenticationResults(
  props: ExtractAuthenticationResultsProps,
): string | undefined {
  const regex = /^Authentication-Results:\s*(.+(?:\r?\n[ \t]+.+)*)/im;
  const match = regex.exec(props.headers);

  if (match?.[1] == null) {
    return undefined;
  }

  const value = match[1].replace(/\r?\n[ \t]+/g, " ").trim();

  if (!value.startsWith("amazonses.com")) {
    return undefined;
  }

  return value;
}

interface ExtractAuthMethodProps {
  value: string;
  method: string;
}

function extractAuthMethod(props: ExtractAuthMethodProps): string | undefined {
  const regex = new RegExp(`\\b${props.method}=(\\w+)`, "i");
  const match = regex.exec(props.value);
  return match?.[1]?.toLowerCase();
}

interface ExtractSesVerdictProps {
  headers: string;
  name: string;
}

function extractSesVerdict(props: ExtractSesVerdictProps): string | undefined {
  const regex = new RegExp(`^${props.name}:\\s*(.+)$`, "mi");
  const match = regex.exec(props.headers);
  return match?.[1]?.trim();
}

interface ParseReportsProps {
  body: Buffer;
  objectKey: string;
}

async function parseReports(props: ParseReportsProps): Promise<Array<DmarcReport>> {
  const filename = props.objectKey.split("/").pop() ?? props.objectKey;

  if (isEmail(filename)) {
    const extracted = await extractFromEmail(props.body);
    return extracted.map((entry) => parseXml(entry.xml));
  }

  const xml = decompress(props.body, filename);
  return [parseXml(xml)];
}

function isEmail(filename: string): boolean {
  const hasReportExtension =
    filename.endsWith(".xml") ||
    filename.endsWith(".xml.gz") ||
    filename.endsWith(".gz") ||
    filename.endsWith(".zip");

  return !hasReportExtension;
}

interface EmitEventsProps {
  reports: Array<DmarcReport>;
}

async function emitEvents(props: EmitEventsProps): Promise<void> {
  const entries = props.reports.map((report) => ({
    Source: eventSource,
    DetailType: detailType,
    Detail: JSON.stringify(report),
    EventBusName: env.EVENT_BUS_ARN,
  }));

  if (entries.length === 0) return;

  await eventBridge.send(new PutEventsCommand({ Entries: entries }));
}
