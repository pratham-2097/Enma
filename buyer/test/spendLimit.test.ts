import { describe, it, expect } from "vitest";
import { SpendLimiter } from "../src/spendLimit";

const SELLER = "0xSeller" as const;

describe("SpendLimiter", () => {
  describe("per-call cap", () => {
    it("allows a call at or below the per-call cap", () => {
      const limiter = new SpendLimiter({ maxPerCallAtomicUnits: 10_000n });
      expect(limiter.check(SELLER, 10_000n)).toEqual({ allowed: true });
    });

    it("refuses a call above the per-call cap, without recording spend", () => {
      const limiter = new SpendLimiter({ maxPerCallAtomicUnits: 5_000n });
      const result = limiter.check(SELLER, 10_000n);
      expect(result.allowed).toBe(false);
      expect(result.reason).toMatch(/per-call/i);
    });
  });

  describe("rolling window cap", () => {
    it("allows spend within the window total", () => {
      const limiter = new SpendLimiter({ maxWindowAtomicUnits: 30_000n, windowMs: 60_000 });
      expect(limiter.check(SELLER, 10_000n).allowed).toBe(true);
      limiter.record(SELLER, 10_000n);
      expect(limiter.check(SELLER, 10_000n).allowed).toBe(true);
      limiter.record(SELLER, 10_000n);
      expect(limiter.check(SELLER, 10_000n).allowed).toBe(true);
    });

    it("refuses spend that would exceed the window total", () => {
      const limiter = new SpendLimiter({ maxWindowAtomicUnits: 15_000n, windowMs: 60_000 });
      limiter.record(SELLER, 10_000n);
      const result = limiter.check(SELLER, 10_000n);
      expect(result.allowed).toBe(false);
      expect(result.reason).toMatch(/window/i);
    });

    it("tracks spend per seller independently", () => {
      const limiter = new SpendLimiter({ maxWindowAtomicUnits: 15_000n, windowMs: 60_000 });
      limiter.record(SELLER, 10_000n);
      const other = "0xOtherSeller";
      expect(limiter.check(other, 10_000n).allowed).toBe(true);
    });

    it("expires spend outside the rolling window", () => {
      let now = 0;
      const limiter = new SpendLimiter({ maxWindowAtomicUnits: 15_000n, windowMs: 1_000 }, () => now);
      limiter.record(SELLER, 10_000n);
      now = 2_000;
      expect(limiter.check(SELLER, 10_000n).allowed).toBe(true);
    });
  });

  describe("no limits configured", () => {
    it("allows any amount when no caps are set", () => {
      const limiter = new SpendLimiter({});
      expect(limiter.check(SELLER, 1_000_000_000n).allowed).toBe(true);
    });
  });
});
