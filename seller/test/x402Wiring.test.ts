import { describe, it, expect } from "vitest";
import { env } from "cloudflare:test";

describe("x402 payment wiring", () => {
  it("an unpaid GET /v1/signal/:asset returns 402 with a batch-settlement requirement", async () => {
    const id = env.SELLER_DO.newUniqueId();
    const stub = env.SELLER_DO.get(id);

    const res = await stub.fetch("https://do/v1/signal/AAPL");
    expect(res.status).toBe(402);

    const header = res.headers.get("payment-required");
    expect(header).toBeTruthy();
    const required = JSON.parse(atob(header!)) as {
      accepts: { scheme: string; network: string; amount: string; extra: { maxClaimsPerBatch: number } }[];
    };
    const accepted = required.accepts.find((a) => a.scheme === "batch-settlement" && a.network === "eip155:84532");
    expect(accepted).toBeDefined();
    expect(accepted!.amount).toBe("10000"); // $0.01 at 6 decimals
    expect(accepted!.extra.maxClaimsPerBatch).toBe(1);
  });

  it("an unrelated path is not intercepted by the payment middleware", async () => {
    const id = env.SELLER_DO.newUniqueId();
    const stub = env.SELLER_DO.get(id);

    const res = await stub.fetch("https://do/healthz");
    expect(res.status).toBe(200);
  });
});
