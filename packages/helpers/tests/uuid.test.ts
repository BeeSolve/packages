import { describe, expect, test } from "bun:test";
import {
	base36Decode,
	base36Encode,
	uuid7,
	uuid7ToDate,
} from "../src/uuid";

describe("uuid7", () => {
	test("produces a 24-character base36 string", () => {
		const id = uuid7();
		expect(id).toMatch(/^[0-9a-z]+$/);
		expect(id.length).toBe(24);
	});

	test("embeds the provided timestamp", () => {
		const ts = new Date("2024-06-01T00:00:00.000Z").getTime();
		const id = uuid7(ts);
		const date = uuid7ToDate(id);
		expect(date.getTime()).toBe(ts);
	});

	test("produces sortable ids for increasing timestamps", () => {
		const t1 = 1_700_000_000_000;
		const t2 = 1_700_000_001_000;
		const id1 = uuid7(t1);
		const id2 = uuid7(t2);
		expect(id1 < id2).toBe(true);
	});

	test("uses current timestamp when none provided", () => {
		const before = Date.now();
		const id = uuid7();
		const after = Date.now();
		const ts = uuid7ToDate(id).getTime();
		expect(ts).toBeGreaterThanOrEqual(before);
		expect(ts).toBeLessThanOrEqual(after);
	});
});

describe("uuid7ToDate", () => {
	test("round-trips timestamp through uuid7", () => {
		const ts = 1_704_067_200_000;
		expect(uuid7ToDate(uuid7(ts)).getTime()).toBe(ts);
	});

	test("throws on invalid uuid", () => {
		expect(() => uuid7ToDate("notavaliduuid00000000000")).toThrow();
	});
});

describe("base36Encode / base36Decode", () => {
	test("encodes and decodes round-trip", () => {
		const original = new Uint8Array([1, 2, 3, 255, 128, 64]);
		const encoded = base36Encode(original);
		const decoded = base36Decode(encoded);
		expect(decoded).toEqual(original);
	});

	test("produces only lowercase alphanumeric characters", () => {
		const data = crypto.getRandomValues(new Uint8Array(16));
		const encoded = base36Encode(data);
		expect(encoded).toMatch(/^[0-9a-z]+$/);
	});
});
