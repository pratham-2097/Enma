import { describe, it, expect, vi } from "vitest";
import { env, runInDurableObject } from "cloudflare:test";
import { SellerDO } from "../src/sellerDO";

function toolUseResponse(input: unknown) {
  return new Response(
    JSON.stringify({
      content: [{ type: "tool_use", name: "emit_signal", input }],
    }),
    { status: 200, headers: { "content-type": "application/json" } },
  );
}

describe("rogue mode call counting", () => {
  it("serves honest data for the first ROGUE_AFTER calls, then switches to junk", async () => {
    const id = env.SELLER_DO.newUniqueId();
    const stub = env.SELLER_DO.get(id);

    await runInDurableObject(stub, async (instance: SellerDO) => {
      expect(await instance.shouldServeRogue("AAPL", { rogueAfter: 1 })).toBe(false); // call 1: honest
      expect(await instance.shouldServeRogue("AAPL", { rogueAfter: 1 })).toBe(true); // call 2: rogue
      expect(await instance.shouldServeRogue("AAPL", { rogueAfter: 1 })).toBe(true); // call 3: still rogue
    });
  });

  it("tracks call counts per asset independently", async () => {
    const id = env.SELLER_DO.newUniqueId();
    const stub = env.SELLER_DO.get(id);

    await runInDurableObject(stub, async (instance: SellerDO) => {
      expect(await instance.shouldServeRogue("AAPL", { rogueAfter: 1 })).toBe(false);
      expect(await instance.shouldServeRogue("TSLA", { rogueAfter: 1 })).toBe(false); // separate counter
      expect(await instance.shouldServeRogue("AAPL", { rogueAfter: 1 })).toBe(true);
    });
  });
});
