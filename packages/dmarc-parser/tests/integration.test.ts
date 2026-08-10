import { describe, expect, it } from "bun:test";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { decompress } from "../src/decompress.ts";
import { parseXml } from "../src/parseXml.ts";

const samplesDir = join(import.meta.dir, "../samples");
const hasSamples = existsSync(samplesDir);

describe.skipIf(!hasSamples)("integration: parse all sample files", () => {
  const files = hasSamples
    ? readdirSync(samplesDir).filter((f) => f.endsWith(".gz") || f.endsWith(".zip"))
    : [];

  it(`parses all ${files.length} sample files`, () => {
    const results: Array<{ file: string; orgName: string; records: number }> = [];
    const failures: Array<{ file: string; error: string }> = [];

    for (const file of files) {
      try {
        const buffer = readFileSync(join(samplesDir, file));
        const xml = decompress(buffer, file);
        const report = parseXml(xml);

        results.push({
          file,
          orgName: report.reportMetadata.orgName,
          records: report.records.length,
        });
      } catch (error) {
        failures.push({
          file,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }

    const providers = new Set(results.map((r) => r.orgName));
    console.log(`\nParsed ${results.length}/${files.length} files successfully`);
    console.log(`Providers: ${[...providers].join(", ")}`);
    console.log(`Total records: ${results.reduce((sum, r) => sum + r.records, 0)}`);

    if (failures.length > 0) {
      console.log(`\nFailures (${failures.length}):`);
      for (const f of failures) {
        console.log(`  ${f.file}: ${f.error}`);
      }
    }

    expect(failures).toHaveLength(0);
    expect(results.length).toBe(files.length);
  });
});
