import type { DynamoDBDocumentClient } from "@aws-sdk/lib-dynamodb";
import { BatchGetCommand, GetCommand, PutCommand } from "@aws-sdk/lib-dynamodb";
import { splitArrayToChunks } from "@beesolve/helpers";
import * as v from "valibot";

export interface IpInfo {
  ip: string;
  asn?: string;
  asName?: string;
  asDomain?: string;
  countryCode?: string;
  country?: string;
}

export const ipInfoCacheSchema = v.object({
  pk: v.string(),
  sk: v.literal("ipinfo"),
  ip: v.string(),
  asn: v.optional(v.string()),
  asName: v.optional(v.string()),
  asDomain: v.optional(v.string()),
  countryCode: v.optional(v.string()),
  country: v.optional(v.string()),
  fetchedAt: v.string(),
});

export type IpInfoCacheItem = v.InferOutput<typeof ipInfoCacheSchema>;

const liteApiResponseSchema = v.object({
  ip: v.string(),
  asn: v.optional(v.string()),
  as_name: v.optional(v.string()),
  as_domain: v.optional(v.string()),
  country_code: v.optional(v.string()),
  country: v.optional(v.string()),
});

export async function lookupIpInfo(props: {
  readonly ip: string;
  readonly apiKey: string;
}): Promise<IpInfo> {
  const response = await fetch(`https://api.ipinfo.io/lite/${encodeURIComponent(props.ip)}`, {
    headers: { Authorization: `Bearer ${props.apiKey}` },
  });

  if (!response.ok) {
    throw new Error(`ipinfo lookup failed for ${props.ip}: ${String(response.status)}`);
  }

  const body = v.parse(liteApiResponseSchema, await response.json());

  return {
    ip: body.ip,
    asn: body.asn,
    asName: body.as_name,
    asDomain: body.as_domain,
    countryCode: body.country_code,
    country: body.country,
  };
}

export class IpInfoCache {
  constructor(
    private readonly props: {
      readonly dynamo: Pick<DynamoDBDocumentClient, "send">;
      readonly tableName: string;
      readonly apiKey?: string;
    },
  ) {}

  readonly get = async (props: { readonly ip: string }): Promise<IpInfoCacheItem | null> => {
    const { Item: item } = await this.props.dynamo.send(
      new GetCommand({
        TableName: this.props.tableName,
        Key: { pk: keyFor(props.ip), sk: "ipinfo" },
      }),
    );

    if (item == null) return null;
    return this.parseOne(item);
  };

  readonly getMany = async (props: {
    readonly ips: Array<string>;
  }): Promise<Record<string, IpInfoCacheItem>> => {
    const uniqueIps = Array.from(new Set(props.ips));
    const result: Record<string, IpInfoCacheItem> = {};

    for (const batch of splitArrayToChunks(uniqueIps, 100)) {
      const { Responses: responses } = await this.props.dynamo.send(
        new BatchGetCommand({
          RequestItems: {
            [this.props.tableName]: {
              Keys: batch.map((ip) => ({ pk: keyFor(ip), sk: "ipinfo" })),
            },
          },
        }),
      );

      for (const item of responses?.[this.props.tableName] ?? []) {
        const parsed = v.safeParse(ipInfoCacheSchema, item);
        if (parsed.success) {
          result[parsed.output.ip] = parsed.output;
        }
      }
    }

    return result;
  };

  readonly put = async (props: { readonly info: IpInfo }): Promise<IpInfoCacheItem> => {
    const item: IpInfoCacheItem = {
      pk: keyFor(props.info.ip),
      sk: "ipinfo",
      ip: props.info.ip,
      asn: props.info.asn,
      asName: props.info.asName,
      asDomain: props.info.asDomain,
      countryCode: props.info.countryCode,
      country: props.info.country,
      fetchedAt: new Date().toISOString(),
    };

    await this.props.dynamo.send(new PutCommand({ TableName: this.props.tableName, Item: item }));

    return item;
  };

  /**
   * Presence-only cache enrichment for a single IP. Returns null when no API
   * key is configured. If the IP is already cached, the cached value is
   * returned and the API is never called again for that IP. Otherwise the IP
   * is looked up and stored.
   */
  readonly enrich = async (props: { readonly ip: string }): Promise<IpInfoCacheItem | null> => {
    if (this.props.apiKey == null) return null;

    const cached = await this.get({ ip: props.ip });
    if (cached != null) {
      return cached;
    }

    const info = await lookupIpInfo({ ip: props.ip, apiKey: this.props.apiKey });
    return this.put({ info });
  };

  /**
   * Presence-only cache enrichment for many IPs. Only IPs that are not already
   * cached trigger an API call. No-op returning `{}` when no API key is
   * configured.
   */
  readonly enrichMany = async (props: {
    readonly ips: Array<string>;
  }): Promise<Record<string, IpInfoCacheItem>> => {
    if (this.props.apiKey == null) return {};

    const uniqueIps = Array.from(new Set(props.ips));
    const existing = await this.getMany({ ips: uniqueIps });
    const result: Record<string, IpInfoCacheItem> = { ...existing };

    const toFetch = uniqueIps.filter((ip) => existing[ip] == null);

    for (const ip of toFetch) {
      const info = await lookupIpInfo({ ip, apiKey: this.props.apiKey });
      result[ip] = await this.put({ info });
    }

    return result;
  };

  private readonly parseOne = (item: unknown): IpInfoCacheItem => {
    const result = v.safeParse(ipInfoCacheSchema, item);
    if (!result.success) {
      console.error(v.flatten(result.issues));
      throw new Error("Malformed stored ipinfo cache record");
    }
    return result.output;
  };
}

function keyFor(ip: string): string {
  return `ipinfo#${ip}`;
}
