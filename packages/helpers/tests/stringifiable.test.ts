import { describe, expect, test } from "bun:test";
import {
	decodeFromStringifiable,
	encodeToStringifiable,
} from "../index";

function roundTrip<T>(value: T): T {
	return decodeFromStringifiable(encodeToStringifiable(value));
}

describe("encodeToStringifiable / decodeFromStringifiable", () => {
	test("round-trips a string", () => {
		expect(roundTrip("hello")).toBe("hello");
		expect(roundTrip("")).toBe("");
		expect(roundTrip("_special")).toBe("_special");
	});

	test("round-trips numbers", () => {
		expect(roundTrip(42)).toBe(42);
		expect(roundTrip(0)).toBe(0);
		expect(roundTrip(-1)).toBe(-1);
		expect(roundTrip(3.14)).toBeCloseTo(3.14);
	});

	test("round-trips booleans", () => {
		expect(roundTrip(true)).toBe(true);
		expect(roundTrip(false)).toBe(false);
	});

	test("round-trips null", () => {
		expect(roundTrip(null)).toBeNull();
	});

	test("round-trips undefined", () => {
		expect(roundTrip(undefined)).toBeUndefined();
	});

	test("round-trips special number values", () => {
		expect(roundTrip(+Infinity)).toBe(+Infinity);
		expect(roundTrip(-Infinity)).toBe(-Infinity);
		expect(roundTrip(Number.NaN)).toBeNaN();
	});

	test("round-trips a Date", () => {
		const date = new Date("2024-01-15T12:00:00.000Z");
		expect(roundTrip(date)).toEqual(date);
	});

	test("round-trips a BigInt", () => {
		expect(roundTrip(BigInt("123456789"))).toBe(BigInt("123456789"));
	});

	test("round-trips an array", () => {
		expect(roundTrip([1, "two", null, undefined])).toEqual([
			1,
			"two",
			null,
			undefined,
		]);
	});

	test("round-trips a plain object", () => {
		const obj = { name: "Alice", age: 30, active: true, score: null };
		expect(roundTrip(obj)).toEqual(obj);
	});

	test("round-trips deeply nested structures", () => {
		const obj = { a: { b: { c: [1, { d: undefined }] } } };
		expect(roundTrip(obj)).toEqual(obj);
	});

	test("round-trips a Buffer", () => {
		const buf = Buffer.from("hello bytes");
		const result = roundTrip(buf);
		expect(result).toBeInstanceOf(Buffer);
		expect((result as Buffer).equals(buf)).toBe(true);
	});

	test("encodes versioned envelope", () => {
		const encoded = encodeToStringifiable("test");
		expect(encoded.___encoded).toBe("v1");
	});

	test("throws when encoding a function", () => {
		expect(() => encodeToStringifiable(() => {})).toThrow(
			"Cannot encode function",
		);
	});

	test("throws when encoding a symbol", () => {
		expect(() => encodeToStringifiable(Symbol("x"))).toThrow(
			"Cannot encode symbol",
		);
	});

	test("throws when decoding a non-plain-object", () => {
		expect(() => decodeFromStringifiable("not-an-object")).toThrow(
			"Only plain objects can be decoded.",
		);
		expect(() => decodeFromStringifiable(null)).toThrow(
			"Only plain objects can be decoded.",
		);
		expect(() => decodeFromStringifiable([1, 2, 3])).toThrow(
			"Only plain objects can be decoded.",
		);
	});
});
