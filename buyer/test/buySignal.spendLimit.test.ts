import { describe, it, expect, vi, beforeEach } from "vitest";
import type { Address, Chain, Hex } from "viem";
import { SpendLimiter } from "../src/spendLimit";

vi.mock("../src/guardSigner", () => ({ createGuardSigner: vi.fn(() => ({})) }));
vi.mock("../src/openTab", () => ({
  channelConfigFrom402: vi.fn(() => ({ payer: "0xPayer" })),
  openTab: vi.fn(async () => "0xchannel"),
}));
vi.mock("@x402/evm/batch-settlement/client", () => ({
  signVoucher: vi.fn(async () => ({ signature: "0xsig" })),
}));

const SELLER_PAY_TO = "0xSellerReceiver";

function fake402Response(amount = "10000") {
  const payload = {
    accepts: [
      {
        scheme: "batch-settlement",
        payTo: SELLER_PAY_TO,
        amount,
        extra: { receiverAuthorizer: "0xAuth", withdrawDelay: 900 },
      },
    ],
  };
  const header = Buffer.from(JSON.stringify(payload)).toString("base64");
  return new Response("", { status: 402, headers: { "payment-required": header } });
}

const BASE_OPTS = {
  chain: {} as Chain,
  rpcUrl: "http://localhost:1",
  sellerUrl: "http://localhost:8787",
  asset: "AAPL",
  escrowAddress: "0xEscrow" as Address,
  usdcAddress: "0xUsdc" as Address,
  guardAddress: "0xGuard" as Address,
  ownerPrivateKey: "0x1" as Hex,
  agentPrivateKey: "0x2" as Hex,
};

beforeEach(() => {
  vi.resetModules();
  vi.clearAllMocks();
});

describe("buySignal spend limit firewall", () => {
  it("refuses to open a channel when the seller's quote exceeds the per-call cap", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation(async () => fake402Response("10000"));
    const { openTab } = await import("../src/openTab");
    const { buySignal } = await import("../src/buySignal");

    const limiter = new SpendLimiter({ maxPerCallAtomicUnits: 5_000n });

    await expect(buySignal({ ...BASE_OPTS, spendLimiter: limiter })).rejects.toThrow(/per-call/i);

    expect(openTab).not.toHaveBeenCalled();
    expect(fetchSpy).toHaveBeenCalledTimes(1); // only the unpaid probe request — never retried into a paid one
  });

  it("proceeds normally when the seller's quote is within the cap", async () => {
    vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(fake402Response("10000"))
      .mockResolvedValueOnce(new Response(JSON.stringify({ ok: true }), { status: 200, headers: { "content-type": "application/json" } }));
    const { openTab } = await import("../src/openTab");
    const { buySignal } = await import("../src/buySignal");

    const limiter = new SpendLimiter({ maxPerCallAtomicUnits: 10_000n });
    const result = await buySignal({ ...BASE_OPTS, spendLimiter: limiter });

    expect(result.status).toBe(200);
    expect(openTab).toHaveBeenCalledTimes(1);
  });

  it("records spend against the limiter only after a successful paid response", async () => {
    vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(fake402Response("10000"))
      .mockResolvedValueOnce(new Response(JSON.stringify({ ok: true }), { status: 200, headers: { "content-type": "application/json" } }));
    const { buySignal } = await import("../src/buySignal");

    const limiter = new SpendLimiter({ maxWindowAtomicUnits: 15_000n, windowMs: 60_000 });
    const recordSpy = vi.spyOn(limiter, "record");

    await buySignal({ ...BASE_OPTS, spendLimiter: limiter });

    expect(recordSpy).toHaveBeenCalledWith(SELLER_PAY_TO, 10_000n);
  });

  it("behaves exactly as before when no spendLimiter is passed", async () => {
    vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(fake402Response("10000"))
      .mockResolvedValueOnce(new Response(JSON.stringify({ ok: true }), { status: 200, headers: { "content-type": "application/json" } }));
    const { openTab } = await import("../src/openTab");
    const { buySignal } = await import("../src/buySignal");

    const result = await buySignal(BASE_OPTS);

    expect(result.status).toBe(200);
    expect(openTab).toHaveBeenCalledTimes(1);
  });
});
