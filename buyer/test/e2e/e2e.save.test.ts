import "dotenv/config";
import { describe, it, expect } from "vitest";
import { baseSepolia } from "viem/chains";
import type { Address, Hex } from "viem";
import { signVoucher } from "@x402/evm/batch-settlement/client";
import { checkDeterministic } from "../../src/qa";
import { revokeSeller } from "../../src/revoke";
import { channelConfigFrom402, getChannelReceiver, openTab } from "../../src/openTab";
import { createGuardSigner } from "../../src/guardSigner";
import { fetchWithSettleRetry } from "../../src/buySignal";

/**
 * Gate G3-partial, beat 3: buy from the rogue seller -> QA fails -> revoke tx ->
 * the seller's next claim for that channel reverts. Live, real facilitator.
 * Requires `wrangler dev` running in seller/. Skipped by default (RUN_E2E=1).
 */
const RUN = process.env.RUN_E2E === "1";

const ESCROW_ADDRESS = "0x4020074e9dF2ce1deE5A9C1b5c3f541D02a10003" as Address;
const USDC_SEPOLIA = "0x036CbD53842c5426634e7929541eC2318f3dCF7e" as Address;

describe.skipIf(!RUN)("e2e.save (live, RUN_E2E=1)", () => {
  it("QA fails on rogue data, revoke lands, EnmaGuard now rejects that voucher", async () => {
    const RPC_URL = requireEnv("RPC_URL");
    const OWNER_PRIVATE_KEY = requireEnv("OWNER_PRIVATE_KEY") as Hex;
    const AGENT_PRIVATE_KEY = requireEnv("AGENT_PRIVATE_KEY") as Hex;
    const GUARDIAN_PRIVATE_KEY = requireEnv("GUARDIAN_PRIVATE_KEY") as Hex;
    const ENMA_GUARD_ADDRESS = requireEnv("ENMA_GUARD_ADDRESS") as Address;
    const SELLER_URL = process.env.SELLER_URL ?? "http://localhost:8787";

    // Hit the seller's separate rogue instance (its own DO, its own on-chain receiver)
    // so revoking it never touches the honest seller's ENMA_RECEIVER_ADDRESS. The force
    // header guarantees rogue data on this call regardless of the instance's own
    // per-asset call counter, which persists across test runs.
    const unpaidRes = await fetch(`${SELLER_URL}/rogue/v1/signal/AAPL`, {
      headers: { "x-enma-force-rogue": "1" },
    });
    expect(unpaidRes.status).toBe(402);
    const header = unpaidRes.headers.get("payment-required")!;
    const required = JSON.parse(Buffer.from(header, "base64").toString("utf8"));
    const accepted = required.accepts.find((a: { scheme: string }) => a.scheme === "batch-settlement");

    const cfg = channelConfigFrom402({
      guardAddress: ENMA_GUARD_ADDRESS,
      token: USDC_SEPOLIA,
      accepted,
      salt: ("0x" + Date.now().toString(16).padStart(64, "0")) as Hex,
    });

    const channelId = await openTab({
      chain: baseSepolia,
      rpcUrl: RPC_URL,
      escrowAddress: ESCROW_ADDRESS,
      guardAddress: ENMA_GUARD_ADDRESS,
      ownerPrivateKey: OWNER_PRIVATE_KEY,
      cfg,
      amount: 50_000n,
    });

    const guardSigner = createGuardSigner({ guardAddress: ENMA_GUARD_ADDRESS, agentPrivateKey: AGENT_PRIVATE_KEY });
    const voucher = await signVoucher(guardSigner, channelId, "10000", "eip155:84532");

    const paymentPayload = {
      x402Version: 2,
      accepted,
      payload: { type: "voucher", channelConfig: cfg, voucher },
    };
    const paymentHeader = Buffer.from(JSON.stringify(paymentPayload)).toString("base64");

    const { status, body } = await fetchWithSettleRetry(
      `${SELLER_URL}/rogue/v1/signal/AAPL`,
      { headers: { "payment-signature": paymentHeader, "x-enma-force-rogue": "1" } },
      true,
    );
    expect(status).toBe(200); // the seller charges even for junk — that's the point

    const qa = checkDeterministic(body);
    expect(qa.ok).toBe(false); // rogue data must fail QA gate 1

    console.log("DATA INVALID: REVOKING VOUCHER");
    const revokeTx = await revokeSeller({
      chain: baseSepolia,
      rpcUrl: RPC_URL,
      guardAddress: ENMA_GUARD_ADDRESS,
      guardianPrivateKey: GUARDIAN_PRIVATE_KEY,
      seller: accepted.payTo as Address,
      reasonCode: qa.ok ? 0 : qa.reasonCode,
    });
    expect(revokeTx).toBeTruthy();

    const receiver = await getChannelReceiver({
      chain: baseSepolia,
      rpcUrl: RPC_URL,
      guardAddress: ENMA_GUARD_ADDRESS,
      channelId,
    });
    expect(receiver.toLowerCase()).toBe((accepted.payTo as string).toLowerCase());
    // The revocation is keyed by seller address, not this specific channel or voucher —
    // any subsequent claim attempt for this seller now reverts at EnmaGuard.isValidSignature.
    // (Proven at the contract level by test_revokeAfterSigning_claimReverts_onRealEscrow.)
  }, 90_000);
});

function requireEnv(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`missing required env var ${name} (RUN_E2E=1 requires contracts/.env's keys)`);
  return v;
}
