import { beforeAll, describe, expect, it } from "bun:test";
import { runInNewContext } from "node:vm";

import { buildEdgeFunction, cloudFrontFunctionMaxBytes } from "../build";
import { handler } from "../src/edge";
import type { CloudFrontEvent, CloudFrontRequest, CloudFrontResponse } from "../src/edge";

const chromeAccept = "image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8";

interface EventProps {
  uri?: string;
  querystring?: CloudFrontRequest["querystring"];
  headers?: CloudFrontRequest["headers"];
}

function event(props: EventProps = {}): CloudFrontEvent {
  return {
    request: {
      method: "GET",
      uri: props.uri ?? "/assets/photos/cat.jpg",
      querystring: props.querystring ?? {},
      headers: props.headers ?? {},
    },
  };
}

function clone(input: CloudFrontEvent): CloudFrontEvent {
  return JSON.parse(JSON.stringify(input));
}

function isResponse(result: CloudFrontRequest | CloudFrontResponse): result is CloudFrontResponse {
  return "statusCode" in result;
}

function requestOf(result: CloudFrontRequest | CloudFrontResponse): CloudFrontRequest {
  if (isResponse(result)) throw new Error(`Expected a request, got ${result.statusCode}`);
  return result;
}

function responseOf(result: CloudFrontRequest | CloudFrontResponse): CloudFrontResponse {
  if (!isResponse(result)) throw new Error("Expected a response");
  return result;
}

describe("handler", () => {
  it("rewrites the query string in canonical order", () => {
    const request = requestOf(
      handler(event({ querystring: { w: { value: "300" }, h: { value: "200" } } })),
    );

    expect(request.querystring).toBe("h=200&w=300");
  });

  it("gives equal cache keys for reordered, differently cased and default-carrying queries", () => {
    const first = requestOf(
      handler(event({ querystring: { h: { value: "2" }, w: { value: "1" } } })),
    ).querystring;
    const second = requestOf(
      handler(
        event({ querystring: { W: { value: "1" }, fit: { value: "CLIP" }, H: { value: "2" } } }),
      ),
    ).querystring;

    expect(second).toBe(first);
  });

  it("drops unknown parameters", () => {
    const request = requestOf(
      handler(
        event({
          querystring: { utm_source: { value: "x" }, w: { value: "100" }, fbclid: { value: "1" } },
        }),
      ),
    );

    expect(request.querystring).toBe("w=100");
  });

  it("keeps the last value of duplicated parameters", () => {
    const request = requestOf(
      handler(
        event({
          querystring: {
            w: { value: "1", multiValue: [{ value: "1" }, { value: "2" }, { value: "3" }] },
          },
        }),
      ),
    );

    expect(request.querystring).toBe("w=3");
  });

  it("decodes percent-encoded values", () => {
    const request = requestOf(handler(event({ querystring: { w: { value: "3%30%30" } } })));

    expect(request.querystring).toBe("w=300");
  });

  it("accepts a query string value as well as an object", () => {
    const request = requestOf(handler(event({ querystring: "w=300&h=200&utm=x" })));

    expect(request.querystring).toBe("h=200&w=300");
  });

  it("sets an empty query for a request without parameters", () => {
    const request = requestOf(handler(event()));

    expect(request.querystring).toEqual({});
  });

  it("answers 400 for unsupported parameters", () => {
    const crop = responseOf(handler(event({ querystring: { crop: { value: "faces" } } })));
    const blur = responseOf(handler(event({ querystring: { blur: { value: "5" } } })));
    const fit = responseOf(handler(event({ querystring: { fit: { value: "crop" } } })));

    for (const response of [crop, blur, fit]) {
      expect(response.statusCode).toBe(400);
      expect(response.statusDescription).toBe("Bad Request");
      expect(response.headers["cache-control"]?.value).toBe("no-store");
    }
    expect(crop.body).toContain("crop");
  });

  it("answers 400 for invalid values", () => {
    const response = responseOf(handler(event({ querystring: { w: { value: "abc" } } })));

    expect(response.statusCode).toBe(400);
    expect(response.body).toContain("w");
  });

  it("normalizes Accept to image/webp for browsers that accept it", () => {
    const request = requestOf(handler(event({ headers: { accept: { value: chromeAccept } } })));

    expect(request.headers.accept).toEqual({ value: "image/webp" });
  });

  it("normalizes Accept to */* otherwise", () => {
    const variants: Array<CloudFrontRequest["headers"]> = [
      { accept: { value: "*/*" } },
      { accept: { value: "image/png,image/jpeg" } },
      { accept: { value: "image/webp;q=0" } },
      {},
    ];
    for (const headers of variants) {
      expect(requestOf(handler(event({ headers }))).headers.accept).toEqual({ value: "*/*" });
    }
  });

  it("joins multiple Accept header values", () => {
    const request = requestOf(
      handler(
        event({
          headers: {
            accept: {
              value: "image/png",
              multiValue: [{ value: "image/png" }, { value: "image/webp" }],
            },
          },
        }),
      ),
    );

    expect(request.headers.accept).toEqual({ value: "image/webp" });
  });

  it("keeps the uri, method and other headers", () => {
    const request = requestOf(
      handler(event({ uri: "/assets/a%20b.jpg", headers: { host: { value: "cdn.example.com" } } })),
    );

    expect(request.uri).toBe("/assets/a%20b.jpg");
    expect(request.method).toBe("GET");
    expect(request.headers.host).toEqual({ value: "cdn.example.com" });
  });

  it("answers 400 for path traversal, plain and encoded", () => {
    for (const uri of [
      "/assets/../secret.jpg",
      "/assets/%2e%2e/secret.jpg",
      "/assets/%2E%2E/secret.jpg",
      "/assets/photos/./cat.jpg",
      "/assets/photos%2F..%2Fcat.jpg",
      "/assets/a%2Fb.jpg",
      "/assets/%E0%A4%A.jpg",
    ]) {
      expect(responseOf(handler(event({ uri }))).statusCode).toBe(400);
    }
  });

  it("allows dots inside file names", () => {
    expect(isResponse(handler(event({ uri: "/assets/my..photo.v2.jpg" })))).toBe(false);
    expect(isResponse(handler(event({ uri: "/assets/.hidden/cat.jpg" })))).toBe(false);
  });
});

describe("built function", () => {
  let code = "";

  beforeAll(async () => {
    code = await buildEdgeFunction();
  });

  it("is a script without imports and exports", () => {
    expect(code).toContain("function handler(");
    expect(code).not.toMatch(/^\s*(import|export)\b/m);
    expect(code).not.toMatch(/\bimport\s*\(/);
  });

  it("is below the CloudFront Function size limit", () => {
    expect(cloudFrontFunctionMaxBytes).toBe(10 * 1024);
    expect(new TextEncoder().encode(code).length).toBeLessThan(cloudFrontFunctionMaxBytes);
  });

  it("avoids syntax the CloudFront JavaScript runtime 2.0 does not list", () => {
    expect(code).not.toMatch(/\bfor\s*\([^)]*\bof\b/);
    expect(code).not.toContain("...");
    expect(code).not.toContain("?.");
    expect(code).not.toContain("??");
    expect(code).not.toMatch(/\bclass\s+\w/);
    expect(code).not.toMatch(/\bfunction\s*\*/);
    expect(code).not.toMatch(/\bcatch\s*\{/);
    expect(code).not.toMatch(/\b(const|let|var)\s*[{[]/);
  });

  it("behaves like the source handler", () => {
    const built = runInNewContext(`${code}\nhandler`, {});

    const events: Array<CloudFrontEvent> = [
      event(),
      event({ querystring: { w: { value: "300" }, h: { value: "200" } } }),
      event({ querystring: { W: { value: "0300" }, fit: { value: "MAX" }, utm: { value: "x" } } }),
      event({
        querystring: { w: { value: "1", multiValue: [{ value: "1" }, { value: "9" }] } },
      }),
      event({ querystring: { crop: { value: "faces" } } }),
      event({ querystring: { w: { value: "abc" } } }),
      event({ uri: "/assets/%2e%2e/x.jpg" }),
      event({ headers: { accept: { value: chromeAccept } } }),
      event({ headers: { accept: { value: "*/*" } } }),
      event({ querystring: "w=100&h=50&q=75" }),
    ];

    for (const input of events) {
      const fromBuilt = JSON.parse(JSON.stringify(built(clone(input))));
      const fromSource = JSON.parse(JSON.stringify(handler(clone(input))));
      expect(fromBuilt).toEqual(fromSource);
    }
  });
});
