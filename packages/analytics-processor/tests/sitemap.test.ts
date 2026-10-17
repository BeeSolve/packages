import { afterEach, describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import {
  canonicalPath,
  fetchSitemapPaths,
  normalizeSitemapLoc,
  parseSitemap,
  sitemapUserAgent,
} from "../src/sitemap.ts";

const fixture = readFileSync(join(import.meta.dir, "fixtures", "example-sitemap.xml"), "utf8");

describe("canonicalPath", () => {
  it("collapses a trailing slash", () => {
    expect(canonicalPath("/blog/")).toBe("/blog");
  });

  it("leaves root unchanged", () => {
    expect(canonicalPath("/")).toBe("/");
  });

  it("leaves an already-unslashed path unchanged", () => {
    expect(canonicalPath("/blog")).toBe("/blog");
  });

  it("collapses a single trailing slash on a deep path", () => {
    expect(canonicalPath("/blog/getting-started/")).toBe("/blog/getting-started");
  });
});

describe("normalizeSitemapLoc", () => {
  it("maps the origin root to /", () => {
    expect(normalizeSitemapLoc("https://example.com/")).toBe("/");
  });

  it("maps a plain path to its pathname", () => {
    expect(normalizeSitemapLoc("https://example.com/blog")).toBe("/blog");
  });

  it("collapses a trailing slash", () => {
    expect(normalizeSitemapLoc("https://example.com/blog/")).toBe("/blog");
  });

  it("strips query and fragment", () => {
    expect(normalizeSitemapLoc("https://example.com/search?q=a&b#top")).toBe("/search");
  });

  it("throws on unparseable input", () => {
    expect(() => normalizeSitemapLoc("not a url")).toThrow();
  });
});

describe("parseSitemap", () => {
  const paths = parseSitemap(fixture);

  it("dedupes the /blog and /blog/ pair to a single entry", () => {
    expect(paths.filter((path) => path === "/blog")).toHaveLength(1);
    expect(paths).not.toContain("/blog/");
  });

  it("returns the deduped count", () => {
    expect(paths).toHaveLength(53);
  });

  it("includes the root and blog paths", () => {
    expect(paths).toContain("/");
    expect(paths).toContain("/blog");
  });

  it("includes realistic article paths", () => {
    expect(paths).toContain("/blog/getting-started");
  });

  it("preserves first-seen order", () => {
    expect(paths[0]).toBe("/");
    expect(paths[1]).toBe("/blog");
  });

  it("XML-unescapes entities without leaking &amp;", () => {
    expect(paths).toContain("/search");
    for (const path of paths) {
      expect(path).not.toContain("&amp;");
    }
  });

  it("throws on a sitemap index document", () => {
    const index = `<?xml version="1.0" encoding="UTF-8"?>
<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  <sitemap><loc>https://example.com/sitemap-blog.xml</loc></sitemap>
</sitemapindex>`;
    expect(() => parseSitemap(index)).toThrow();
  });
});

describe("fetchSitemapPaths", () => {
  const originalFetch = globalThis.fetch;

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it("fetches, parses, and returns the normalized paths", async () => {
    const xml = [
      `<?xml version="1.0" encoding="UTF-8"?>`,
      `<urlset>`,
      `<url><loc>https://example.com/</loc></url>`,
      `<url><loc>https://example.com/blog</loc></url>`,
      `<url><loc>https://example.com/blog/</loc></url>`,
      `</urlset>`,
    ].join("");

    const requests: Array<RequestInit | undefined> = [];
    const fetchStub: typeof globalThis.fetch = Object.assign(
      async (_input: string | URL | Request, init?: RequestInit) => {
        requests.push(init);
        return new Response(xml, { status: 200 });
      },
      { preconnect: originalFetch.preconnect },
    );
    globalThis.fetch = fetchStub;

    const paths = await fetchSitemapPaths("https://example.com/sitemap.xml");

    expect(paths).toEqual(["/", "/blog"]);

    const headers = new Headers(requests[0]?.headers);
    expect(headers.get("user-agent")).toBe(sitemapUserAgent);
  });
});
