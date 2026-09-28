import { describe, it, expect } from "vitest";
import { parseFlaggedSellers } from "../src/flaggedSellers";

describe("parseFlaggedSellers", () => {
  it("parses a comma-separated list of addresses", () => {
    const result = parseFlaggedSellers("0xAAA1111111111111111111111111111111111a,0xBBB2222222222222222222222222222222222b");
    expect(result).toEqual(["0xAAA1111111111111111111111111111111111a", "0xBBB2222222222222222222222222222222222b"]);
  });

  it("trims whitespace around each address", () => {
    const result = parseFlaggedSellers(" 0xAAA1111111111111111111111111111111111a , 0xBBB2222222222222222222222222222222222b ");
    expect(result).toEqual(["0xAAA1111111111111111111111111111111111a", "0xBBB2222222222222222222222222222222222b"]);
  });

  it("returns an empty array for undefined or empty input", () => {
    expect(parseFlaggedSellers(undefined)).toEqual([]);
    expect(parseFlaggedSellers("")).toEqual([]);
  });

  it("drops empty entries from a trailing/leading comma", () => {
    expect(parseFlaggedSellers("0xAAA1111111111111111111111111111111111a,,")).toEqual([
      "0xAAA1111111111111111111111111111111111a",
    ]);
  });
});
