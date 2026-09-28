import { describe, it, expect } from "vitest";
import { env } from "cloudflare:test";

describe("rogue instance identity", () => {
  it("the rogue-named DO instance advertises ROGUE_RECEIVER_ADDRESS as payTo, not ENMA_RECEIVER_ADDRESS", async () => {
    const id = env.SELLER_DO.idFromName("rogue");
    const stub = env.SELLER_DO.get(id);

    const res = await stub.fetch("https://do/v1/signal/AAPL");
    expect(res.status).toBe(402);

    const header = res.headers.get("payment-required")!;
    const required = JSON.parse(atob(header));
    const accepted = required.accepts.find((a: { scheme: string }) => a.scheme === "batch-settlement");

    expect(accepted.payTo.toLowerCase()).toBe(env.ROGUE_RECEIVER_ADDRESS.toLowerCase());
    expect(accepted.payTo.toLowerCase()).not.toBe(env.ENMA_RECEIVER_ADDRESS.toLowerCase());
  });

  it("the honest ('enma') instance still advertises ENMA_RECEIVER_ADDRESS", async () => {
    const id = env.SELLER_DO.idFromName("enma");
    const stub = env.SELLER_DO.get(id);

    const res = await stub.fetch("https://do/v1/signal/AAPL");
    const header = res.headers.get("payment-required")!;
    const required = JSON.parse(atob(header));
    const accepted = required.accepts.find((a: { scheme: string }) => a.scheme === "batch-settlement");

    expect(accepted.payTo.toLowerCase()).toBe(env.ENMA_RECEIVER_ADDRESS.toLowerCase());
  });
});
