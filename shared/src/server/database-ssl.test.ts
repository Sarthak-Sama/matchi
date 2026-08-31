import { describe, expect, it } from "vitest";

import { databaseSslFor } from "./database-ssl.js";

describe("databaseSslFor", () => {
  it("verifies certificates for a hosted database", () => {
    expect(
      databaseSslFor(
        "postgresql://u:p@ep-x-pooler.ap-southeast-1.aws.neon.tech/neondb?sslmode=require",
      ),
    ).toEqual({ rejectUnauthorized: true });
  });

  it("does not require TLS on loopback, where none is served", () => {
    expect(databaseSslFor("postgresql://tokyo:tokyo@localhost:5432/tokyo")).toBe(false);
    expect(databaseSslFor("postgresql://tokyo:tokyo@127.0.0.1:5432/tokyo")).toBe(false);
  });

  it("handles an IPv6 loopback literal", () => {
    expect(databaseSslFor("postgresql://u:p@[::1]:5432/tokyo")).toBe(false);
  });

  it("fails closed on an unparseable connection string", () => {
    expect(databaseSslFor("not a url")).toEqual({ rejectUnauthorized: true });
  });

  it("does not treat sslmode in the query string as the policy", () => {
    expect(databaseSslFor("postgresql://u:p@db.example.com/x?sslmode=disable")).toEqual({
      rejectUnauthorized: true,
    });
  });
});
