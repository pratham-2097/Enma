import { describe, it, expect, vi, beforeEach } from "vitest";
import { baseSepolia } from "viem/chains";
import type { Address, Hex } from "viem";
import type { AgentConfig } from "../src/agent";

const buySignal = vi.fn();
const revokeSeller = vi.fn();
const reportEvent = vi.fn();
const checkDeterministic = vi.fn();
const checkJev = vi.fn();

vi.mock("../src/buySignal", async () => {
  const actual = await vi.importActual<typeof import("../src/buySignal")>("../src/buySignal");
  return { ...actual, buySignal };
});
vi.mock("../src/revoke", () => ({ revokeSeller }));
vi.mock("../src/reportEvent", () => ({ reportEvent }));
vi.mock("../src/qa", async () => {
  const actual = await vi.importActual<typeof import("../src/qa")>("../src/qa");
  return { ...actual, checkDeterministic, checkJev };
});

const config: AgentConfig = {
  chain: baseSepolia,
  rpcUrl: "http://localhost:1",
  sellerUrl: "http://localhost:8787",
  escrowAddress: "0x4020074e9dF2ce1deE5A9C1b5c3f541D02a10003" as Address,
  usdcAddress: "0x036CbD53842c5426634e7929541eC2318f3dCF7e" as Address,
  guardAddress: "0x0000000000000000000000000000000000000001" as Address,
  ownerPrivateKey: "0x1111111111111111111111111111111111111111111111111111111111111111".slice(0, 66) as Hex,
  agentPrivateKey: "0x2222222222222222222222222222222222222222222222222222222222222222".slice(0, 66) as Hex,
  guardianPrivateKey: "0x3333333333333333333333333333333333333333333333333333333333333333".slice(0, 66) as Hex,
};

const SELLER: Address = "0x9999999999999999999999999999999999999999999999999999999999999999".slice(0, 42) as Address;
const PAYER: Address = "0x8888888888888888888888888888888888888888888888888888888888888888".slice(0, 42) as Address;

function fakePurchase(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    status: 200,
    body: { asset: "AAPL" },
    channelId: "0xchannel",
    cfg: { payer: PAYER },
    seller: SELLER,
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("runBuy event reporting", () => {
  it("reports a passing qa_verdict when both QA gates pass", async () => {
    buySignal.mockResolvedValue(fakePurchase());
    checkDeterministic.mockReturnValue({ ok: true });
    const { runBuy } = await import("../src/agent");

    await runBuy({ ...config, jevApiKey: undefined }, "AAPL");

    expect(reportEvent).toHaveBeenCalledWith(config.sellerUrl, {
      kind: "qa_verdict",
      seller: SELLER,
      asset: "AAPL",
      ok: true,
    });
    expect(revokeSeller).not.toHaveBeenCalled();
  });

  it("reports a failing qa_verdict and a revoked event when gate 1 fails", async () => {
    buySignal.mockResolvedValue(fakePurchase());
    checkDeterministic.mockReturnValue({ ok: false, reasonCode: 10, message: "schema invalid" });
    revokeSeller.mockResolvedValue("0xRevokeTx");
    const { runBuy } = await import("../src/agent");

    const result = await runBuy(config, "AAPL");

    expect(reportEvent).toHaveBeenCalledWith(
      config.sellerUrl,
      expect.objectContaining({ kind: "qa_verdict", ok: false, reason: "schema invalid" }),
    );
    expect(reportEvent).toHaveBeenCalledWith(config.sellerUrl, {
      kind: "revoked",
      seller: SELLER,
      payer: PAYER,
      txHash: "0xRevokeTx",
    });
    expect(result.revoked).toBe(true);
  });

  it("reports no events when the purchase itself fails (never reached QA)", async () => {
    buySignal.mockResolvedValue(fakePurchase({ status: 402, body: {} }));
    const { runBuy } = await import("../src/agent");

    await runBuy(config, "AAPL");

    expect(reportEvent).not.toHaveBeenCalled();
  });
});

describe("runCheat event reporting", () => {
  it("reports a revoked event even though the data was genuinely good", async () => {
    buySignal.mockResolvedValue(fakePurchase());
    revokeSeller.mockResolvedValue("0xCheatRevokeTx");
    const { runCheat } = await import("../src/agent");

    await runCheat(config, "AAPL");

    expect(reportEvent).toHaveBeenCalledWith(config.sellerUrl, {
      kind: "revoked",
      seller: SELLER,
      payer: PAYER,
      txHash: "0xCheatRevokeTx",
    });
  });
});

describe("runFirewall", () => {
  it("returns a successful purchase when the spend limit isn't hit", async () => {
    buySignal.mockResolvedValue(fakePurchase());
    const { runFirewall } = await import("../src/agent");

    const result = await runFirewall({ ...config, spendLimit: { maxPerCallAtomicUnits: 1_000_000n } }, "AAPL");

    expect(result).toEqual({ mode: "firewall", status: 200, body: { asset: "AAPL" }, revoked: false });
  });

  it("refuses and reports no revoke when buySignal throws SpendLimitExceededError", async () => {
    const { SpendLimitExceededError } = await import("../src/buySignal");
    buySignal.mockRejectedValue(new SpendLimitExceededError("refused before opening a channel: per-call limit exceeded"));
    const { runFirewall } = await import("../src/agent");

    const result = await runFirewall({ ...config, spendLimit: { maxPerCallAtomicUnits: 1n } }, "AAPL");

    expect(result.refused).toBe(true);
    expect(result.reason).toMatch(/per-call limit exceeded/i);
    expect(revokeSeller).not.toHaveBeenCalled();
  });

  it("re-throws any error that isn't a SpendLimitExceededError", async () => {
    buySignal.mockRejectedValue(new Error("network down"));
    const { runFirewall } = await import("../src/agent");

    await expect(runFirewall(config, "AAPL")).rejects.toThrow("network down");
  });
});
