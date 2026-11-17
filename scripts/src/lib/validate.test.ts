import { describe, expect, it } from "vitest";

import { expectColumns, expectRowCount } from "./validate.js";

describe("expectColumns", () => {
  it("passes when every required column has a non-empty value", () => {
    expect(() => expectColumns({ a: 1, b: "x" }, ["a", "b"], "ctx")).not.toThrow();
  });

  it("names every missing column in the error message", () => {
    expect(() => expectColumns({ a: 1 }, ["a", "b", "c"], "row #4")).toThrowError(
      /row #4: missing required column\(s\): b, c/,
    );
  });

  it("treats null, undefined, and empty string as missing", () => {
    expect(() => expectColumns({ a: null }, ["a"], "ctx")).toThrow(/missing required column/);
    expect(() => expectColumns({ a: undefined }, ["a"], "ctx")).toThrow(/missing required column/);
    expect(() => expectColumns({ a: "" }, ["a"], "ctx")).toThrow(/missing required column/);
  });

  it("accepts falsy-but-present values like 0 and false", () => {
    expect(() => expectColumns({ a: 0, b: false }, ["a", "b"], "ctx")).not.toThrow();
  });
});

describe("expectRowCount", () => {
  it("passes within [min, max]", () => {
    expect(() => expectRowCount(5, { min: 1, max: 10, label: "widgets" })).not.toThrow();
  });

  it("aborts below the configured minimum, naming the label and counts", () => {
    expect(() => expectRowCount(0, { min: 3, label: "wards" })).toThrowError(
      /wards: expected at least 3 row\(s\), got 0/,
    );
  });

  it("aborts above the configured maximum", () => {
    expect(() => expectRowCount(100, { max: 10, label: "widgets" })).toThrowError(
      /widgets: expected at most 10 row\(s\), got 100/,
    );
  });

  it("is a no-op when neither min nor max is given", () => {
    expect(() => expectRowCount(0, { label: "anything" })).not.toThrow();
  });
});
