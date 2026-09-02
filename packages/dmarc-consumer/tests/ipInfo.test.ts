import { afterEach, describe, expect, it, mock, spyOn } from "bun:test";

import { IpInfoCache } from "../ipInfo.ts";

function makeDynamo() {
  const send = mock(() => Promise.resolve({}));
  return { send };
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status });
}

function freshItem(ip: string) {
  return {
    pk: `ipinfo#${ip}`,
    sk: "ipinfo" as const,
    ip,
    asn: "AS15169",
    asName: "Google LLC",
    asDomain: "google.com",
    countryCode: "US",
    country: "United States",
    fetchedAt: new Date().toISOString(),
  };
}

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
});

describe("IpInfoCache", () => {
  describe("enrich", () => {
    it("returns null and does not call the API when no apiKey is configured", async () => {
      const dynamo = makeDynamo();
      const fetchSpy = spyOn(globalThis, "fetch").mockRejectedValue(
        new Error("should not be called"),
      );

      const cache = new IpInfoCache({ dynamo, tableName: "t" });
      const result = await cache.enrich({ ip: "1.2.3.4" });

      expect(result).toBeNull();
      expect(dynamo.send).not.toHaveBeenCalled();
      expect(fetchSpy).not.toHaveBeenCalled();
    });

    it("returns the cached value without calling the API when present", async () => {
      const dynamo = makeDynamo();
      dynamo.send.mockResolvedValueOnce({ Item: freshItem("8.8.8.8") });
      const fetchSpy = spyOn(globalThis, "fetch").mockRejectedValue(
        new Error("should not be called"),
      );

      const cache = new IpInfoCache({ dynamo, tableName: "t", apiKey: "key" });
      const result = await cache.enrich({ ip: "8.8.8.8" });

      expect(result?.asName).toBe("Google LLC");
      expect(fetchSpy).not.toHaveBeenCalled();
      expect(dynamo.send).toHaveBeenCalledTimes(1);
    });

    it("fetches and stores when the IP is not cached", async () => {
      const dynamo = makeDynamo();
      dynamo.send.mockResolvedValueOnce({ Item: undefined }); // get miss
      dynamo.send.mockResolvedValueOnce({}); // put

      const fetchSpy = spyOn(globalThis, "fetch").mockResolvedValue(
        jsonResponse({
          ip: "112.201.67.110",
          asn: "AS9299",
          as_name: "PLDT",
          as_domain: "pldt.com",
          country_code: "PH",
          country: "Philippines",
        }),
      );

      const cache = new IpInfoCache({ dynamo, tableName: "t", apiKey: "key" });
      const result = await cache.enrich({ ip: "112.201.67.110" });

      expect(fetchSpy).toHaveBeenCalledTimes(1);
      expect(result?.asName).toBe("PLDT");
      expect(result?.country).toBe("Philippines");
      expect(dynamo.send).toHaveBeenCalledTimes(2);
    });
  });

  describe("enrichMany", () => {
    it("only calls the API for IPs not already in the cache", async () => {
      const dynamo = makeDynamo();
      // put for the single missing IP
      dynamo.send.mockResolvedValue({});

      const cache = new IpInfoCache({ dynamo, tableName: "t", apiKey: "key" });
      // One of the two IPs is already cached; the other is missing.
      spyOn(cache, "getMany").mockResolvedValue({ "8.8.8.8": freshItem("8.8.8.8") });

      const fetchSpy = spyOn(globalThis, "fetch").mockResolvedValue(
        jsonResponse({
          ip: "1.1.1.1",
          asn: "AS13335",
          as_name: "Cloudflare, Inc.",
          as_domain: "cloudflare.com",
          country_code: "US",
          country: "United States",
        }),
      );

      const result = await cache.enrichMany({ ips: ["8.8.8.8", "1.1.1.1"] });

      // Only the missing IP triggers a lookup.
      expect(fetchSpy).toHaveBeenCalledTimes(1);
      const requestUrl = fetchSpy.mock.calls[0]?.[0];
      expect(typeof requestUrl).toBe("string");
      expect(requestUrl).toContain("1.1.1.1");

      // Both IPs are present in the merged result.
      expect(result["8.8.8.8"]?.asName).toBe("Google LLC");
      expect(result["1.1.1.1"]?.asName).toBe("Cloudflare, Inc.");
    });

    it("returns an empty record and does not call the API without an apiKey", async () => {
      const dynamo = makeDynamo();
      const fetchSpy = spyOn(globalThis, "fetch").mockRejectedValue(
        new Error("should not be called"),
      );

      const cache = new IpInfoCache({ dynamo, tableName: "t" });
      const result = await cache.enrichMany({ ips: ["1.1.1.1"] });

      expect(result).toEqual({});
      expect(fetchSpy).not.toHaveBeenCalled();
    });
  });

  describe("getMany", () => {
    it("returns a record keyed by IP for found items", async () => {
      const dynamo = makeDynamo();
      dynamo.send.mockResolvedValueOnce({
        Responses: { t: [freshItem("8.8.8.8"), freshItem("1.1.1.1")] },
      });

      const cache = new IpInfoCache({ dynamo, tableName: "t" });
      const result = await cache.getMany({ ips: ["8.8.8.8", "1.1.1.1", "8.8.8.8"] });

      expect(Object.keys(result).sort()).toEqual(["1.1.1.1", "8.8.8.8"]);
      expect(result["8.8.8.8"]?.asName).toBe("Google LLC");
    });
  });
});
