import { describe, expect, test } from "bun:test";
import {
  BadRequestError,
  ForbiddenError,
  NotFoundError,
  UnauthorizedError,
} from "../index.ts";

const errorClasses = [
  { name: "NotFoundError", Ctor: NotFoundError },
  { name: "ForbiddenError", Ctor: ForbiddenError },
  { name: "BadRequestError", Ctor: BadRequestError },
  { name: "UnauthorizedError", Ctor: UnauthorizedError },
] as const;

for (const { name, Ctor } of errorClasses) {
  describe(name, () => {
    test("is an instance of Error", () => {
      expect(new Ctor("oops")).toBeInstanceOf(Error);
    });

    test("message is set when constructed with a string", () => {
      const err = new Ctor("something went wrong");
      expect(err.message).toBe("something went wrong");
    });

    test("stringified is false when constructed with a string", () => {
      expect(new Ctor("msg").stringified).toBe(false);
    });

    test("message is JSON when constructed with an object", () => {
      const payload = { code: 42, detail: "bad input" };
      const err = new Ctor(payload);
      expect(err.message).toBe(JSON.stringify(payload));
    });

    test("stringified is true when constructed with an object", () => {
      expect(new Ctor({ x: 1 }).stringified).toBe(true);
    });

    test("message is JSON when constructed with an array", () => {
      const arr = [1, 2, 3];
      const err = new Ctor(arr);
      expect(err.message).toBe(JSON.stringify(arr));
    });

    test("stringified is true when constructed with an array", () => {
      expect(new Ctor([1]).stringified).toBe(true);
    });

    test("name property matches class name", () => {
      expect(new Ctor("x").name).toBe("Error");
    });
  });
}
