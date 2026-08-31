import { describe, expect, it } from "vitest";

import { loadConfig } from "./config.js";

const MINIMAL_ENV = { DATABASE_URL: "postgresql://localhost:5432/tokyo" };

describe("loadConfig", () => {
  it("applies defaults when only DATABASE_URL is set", () => {
    const config = loadConfig(MINIMAL_ENV);

    expect(config.PORT).toBe(4000);
    expect(config.HOST).toBe("0.0.0.0");
    expect(config.LOG_LEVEL).toBe("info");
    expect(config.CORS_ORIGIN).toBe("*");
    expect(config.NODE_ENV).toBe("development");
  });

  it("names every invalid variable in the thrown message", () => {
    expect(() => loadConfig({ PORT: "not-a-number", LOG_LEVEL: "chatty" })).toThrow(
      /DATABASE_URL[\s\S]*PORT[\s\S]*LOG_LEVEL/,
    );
  });

  it("rejects a wildcard CORS origin in production", () => {
    expect(() => loadConfig({ ...MINIMAL_ENV, NODE_ENV: "production", CORS_ORIGIN: "*" })).toThrow(
      /CORS_ORIGIN/,
    );
  });

  it("accepts an explicit CORS origin in production", () => {
    const config = loadConfig({
      ...MINIMAL_ENV,
      NODE_ENV: "production",
      CORS_ORIGIN: "https://matchi.app",
    });

    expect(config.CORS_ORIGIN).toBe("https://matchi.app");
  });

  it("still allows a wildcard outside production", () => {
    expect(
      loadConfig({ ...MINIMAL_ENV, NODE_ENV: "development", CORS_ORIGIN: "*" }).CORS_ORIGIN,
    ).toBe("*");
  });
});
