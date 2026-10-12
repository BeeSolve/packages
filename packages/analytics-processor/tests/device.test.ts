import { describe, expect, it } from "bun:test";

import { classifyDevice } from "../src/device.ts";

describe("classifyDevice", () => {
  it("classifies googlebot as a bot", () => {
    expect(
      classifyDevice("Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)"),
    ).toBe("bot");
  });

  it("classifies an iPhone Safari UA as mobile", () => {
    expect(
      classifyDevice(
        "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1",
      ),
    ).toBe("mobile");
  });

  it("classifies a desktop Chrome UA as desktop", () => {
    expect(
      classifyDevice(
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
      ),
    ).toBe("desktop");
  });

  it("classifies an empty string as other", () => {
    expect(classifyDevice("")).toBe("other");
  });

  it("classifies an Android device as mobile", () => {
    expect(
      classifyDevice(
        "Mozilla/5.0 (Linux; Android 13; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36",
      ),
    ).toBe("mobile");
  });

  it("classifies an unknown UA as other", () => {
    expect(classifyDevice("SomeRandomClient/1.0")).toBe("other");
  });
});
