import { describe, it, expect, vi } from "vitest";
import { resolveRogueDecision, resolveRogueAfterEnv, buildTransformCacheKey } from "../src/sellerDO";

describe("resolveRogueDecision", () => {
  it("is honest when ROGUE_AFTER is unset and no force header is present", async () => {
    const shouldServeRogue = vi.fn();
    const result = await resolveRogueDecision({ asset: "AAPL", rogueAfterEnv: undefined, forceHeader: null }, shouldServeRogue);
    expect(result).toBe(false);
    expect(shouldServeRogue).not.toHaveBeenCalled();
  });

  it("forces rogue for one request when the header is present, regardless of ROGUE_AFTER", async () => {
    const shouldServeRogue = vi.fn();
    const result = await resolveRogueDecision({ asset: "AAPL", rogueAfterEnv: undefined, forceHeader: "1" }, shouldServeRogue);
    expect(result).toBe(true);
    expect(shouldServeRogue).not.toHaveBeenCalled(); // forced, doesn't consume a call-count slot
  });

  it("defers to the call-counting logic when ROGUE_AFTER is set and no header is present", async () => {
    const shouldServeRogue = vi.fn().mockResolvedValue(true);
    const result = await resolveRogueDecision({ asset: "AAPL", rogueAfterEnv: "1", forceHeader: null }, shouldServeRogue);
    expect(result).toBe(true);
    expect(shouldServeRogue).toHaveBeenCalledWith("AAPL", { rogueAfter: 1 });
  });
});

describe("resolveRogueAfterEnv", () => {
  it("defaults the rogue instance to ROGUE_AFTER=1 when ROGUE_AFTER is genuinely unset", () => {
    expect(resolveRogueAfterEnv(undefined, true)).toBe("1");
  });

  it("defaults the rogue instance to ROGUE_AFTER=1 when ROGUE_AFTER is an empty string — the actual .dev.vars/.env shape, not undefined", () => {
    expect(resolveRogueAfterEnv("", true)).toBe("1");
  });

  it("respects an explicit ROGUE_AFTER override for the rogue instance", () => {
    expect(resolveRogueAfterEnv("3", true)).toBe("3");
  });

  it("never defaults the honest instance — it stays honest unless ROGUE_AFTER is explicitly set", () => {
    expect(resolveRogueAfterEnv(undefined, false)).toBe(undefined);
    expect(resolveRogueAfterEnv("", false)).toBe("");
  });
});

describe("buildTransformCacheKey", () => {
  it("gives the rogue instance's still-honest call and its later rogue call DIFFERENT cache keys", () => {
    // Regression: both calls hit the rogue SellerDO instance for the same asset, but
    // the first is still honest (before the call-count threshold) and the second is
    // junk-fed. If the cache key only depended on identity+asset, the second call
    // would silently get the first call's cached honest response back — defeating
    // the entire "rogue seller serves junk" demo beat within the cache TTL window.
    const honestCallKey = buildTransformCacheKey({ isRogue: true, asset: "AAPL", rogueThisRequest: false });
    const rogueCallKey = buildTransformCacheKey({ isRogue: true, asset: "AAPL", rogueThisRequest: true });
    expect(honestCallKey).not.toBe(rogueCallKey);
  });

  it("still scopes the honest and rogue SELLER instances separately, as before", () => {
    const enmaKey = buildTransformCacheKey({ isRogue: false, asset: "AAPL", rogueThisRequest: false });
    const rogueKey = buildTransformCacheKey({ isRogue: true, asset: "AAPL", rogueThisRequest: false });
    expect(enmaKey).not.toBe(rogueKey);
  });

  it("is stable for the same identity/asset/rogue-decision triple", () => {
    const a = buildTransformCacheKey({ isRogue: true, asset: "AAPL", rogueThisRequest: true });
    const b = buildTransformCacheKey({ isRogue: true, asset: "AAPL", rogueThisRequest: true });
    expect(a).toBe(b);
  });
});
