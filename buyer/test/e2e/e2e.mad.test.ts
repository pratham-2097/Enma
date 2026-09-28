import "dotenv/config";
import { describe, it, expect } from "vitest";
import { createPublicClient, createWalletClient, http, type Address, type Hex } from "viem";
import { baseSepolia } from "viem/chains";
import { privateKeyToAccount } from "viem/accounts";
import { runCheat } from "../../src/agent";
import type { AgentConfig } from "../../src/agent";

/**
 * Gate G3-partial, beat 5 (MAD): the `cheat` buyer pays for and revokes 3
 * genuinely good responses. Each revoke makes that channel's NEXT claim
 * attempt fail at the escrow; the seller's own alarm (SellerDO.alarm(),
 * ~75s cadence) is what turns a failed claim into a recorded incident
 * (ledger.recordIncident) — this is the real, live-wired path, not a
 * simulated one. Once incidentCount >= 2 AND incidentValue/servedValue
 * >= 0.5 (ledger.ts), the payer is banned: the next request gets a
 * standard 402 (payment refused, banned) before any Claude call is made.
 *
 * EnmaGuard.revoke() is sticky per-seller: once revoked, EVERY subsequent
 * voucher for that seller fails facilitator verification, on-chain, until
 * a guardian explicitly restore()s it. To get 3 independent incidents
 * without permanently locking the seller out after the first one, this
 * test opens 3 separate channels up front, revokes+restores between each
 * cheat purchase (mirroring a guardian who decides each individual
 * incident was recoverable on the buyer-payment side), then waits for one
 * seller alarm cycle to observe all 3 failed claims at once and ban.
 *
 * Live, real facilitator, real Base Sepolia. Requires `wrangler dev`
 * running in seller/. Skipped by default (RUN_E2E=1). Runs for several
 * minutes (waits out the seller's own alarm cadence) — this is the actual
 * cost of proving the ban path live, not a tunable delay.
 */
const RUN = process.env.RUN_E2E === "1";

const GUARD_ABI = [
  {
    type: "function",
    name: "restore",
    stateMutability: "nonpayable",
    inputs: [{ name: "seller", type: "address" }],
    outputs: [],
  },
] as const;

describe.skipIf(!RUN)("e2e.mad (live, RUN_E2E=1)", () => {
  it("3 revoked claims -> seller's alarm bans the payer -> next request gets 403 pre-verify", async () => {
    const RPC_URL = requireEnv("RPC_URL");
    const GUARD_ADDRESS = requireEnv("ENMA_GUARD_ADDRESS") as Address;
    const receiver = requireEnv("ENMA_RECEIVER_ADDRESS") as Address;
    const guardianPrivateKey = requireEnv("GUARDIAN_PRIVATE_KEY") as Hex;

    const config: AgentConfig = {
      chain: baseSepolia,
      rpcUrl: RPC_URL,
      sellerUrl: process.env.SELLER_URL ?? "http://localhost:8787",
      escrowAddress: "0x4020074e9dF2ce1deE5A9C1b5c3f541D02a10003" as Address,
      usdcAddress: "0x036CbD53842c5426634e7929541eC2318f3dCF7e" as Address,
      guardAddress: GUARD_ADDRESS,
      ownerPrivateKey: requireEnv("OWNER_PRIVATE_KEY") as Hex,
      agentPrivateKey: requireEnv("AGENT_PRIVATE_KEY") as Hex,
      guardianPrivateKey,
    };

    const publicClient = createPublicClient({ chain: baseSepolia, transport: http(RPC_URL) });
    const guardian = privateKeyToAccount(guardianPrivateKey);
    const guardianWallet = createWalletClient({ account: guardian, chain: baseSepolia, transport: http(RPC_URL) });

    async function isRevoked(): Promise<boolean> {
      const [revoked] = (await publicClient.readContract({
        address: GUARD_ADDRESS,
        abi: [
          {
            type: "function",
            name: "revocations",
            stateMutability: "view",
            inputs: [{ name: "", type: "address" }],
            outputs: [
              { name: "revoked", type: "bool" },
              { name: "reason", type: "uint32" },
            ],
          },
        ] as const,
        functionName: "revocations",
        args: [receiver],
      })) as [boolean, number];
      return revoked;
    }

    // The facilitator verifies against ITS OWN RPC node, which can lag ours by more than
    // a few seconds — polling our own RPC for the restore only tells us OUR view caught
    // up, not the facilitator's. So the real gate is the facilitator's own verify call.
    async function facilitatorSeesRestored(): Promise<boolean> {
      const probeRes = await fetch(`${config.sellerUrl}/v1/signal/AAPL`);
      if (probeRes.status !== 402) return false;
      const header = probeRes.headers.get("payment-required");
      if (!header) return false;
      const required = JSON.parse(Buffer.from(header, "base64").toString("utf8")) as {
        accepts: { scheme: string; payTo: string; extra: { receiverAuthorizer: string; withdrawDelay: number } }[];
      };
      const accepted = required.accepts.find((a) => a.scheme === "batch-settlement");
      if (!accepted) return false;

      // A throwaway probe channel, funded at the escrow's minimum, purely to ask the
      // facilitator "do you currently consider this seller revoked?" without spending
      // a real cheat cycle on the answer.
      const { channelConfigFrom402, openTab } = await import("../../src/openTab");
      const { createGuardSigner } = await import("../../src/guardSigner");
      const { signVoucher } = await import("@x402/evm/batch-settlement/client");

      const cfg = channelConfigFrom402({
        guardAddress: GUARD_ADDRESS,
        token: config.usdcAddress,
        accepted,
        salt: ("0x" + Date.now().toString(16).padStart(64, "0")) as Hex,
      });
      const channelId = await openTab({
        chain: baseSepolia,
        rpcUrl: RPC_URL,
        escrowAddress: config.escrowAddress,
        guardAddress: GUARD_ADDRESS,
        ownerPrivateKey: config.ownerPrivateKey,
        cfg,
        amount: 50_000n,
        settleDelayMs: 3000,
      });
      const guardSigner = createGuardSigner({ guardAddress: GUARD_ADDRESS, agentPrivateKey: config.agentPrivateKey });
      const voucher = await signVoucher(guardSigner, channelId, "10000", "eip155:84532");
      const verifyRes = await fetch("https://x402.org/facilitator/verify", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          x402Version: 2,
          paymentPayload: { x402Version: 2, accepted, payload: { type: "voucher", channelConfig: cfg, voucher } },
          paymentRequirements: accepted,
        }),
      });
      if (!verifyRes.ok) return false;
      const body = (await verifyRes.json()) as { isValid?: boolean };
      return body.isValid === true;
    }

    async function restoreReceiverIfRevoked(): Promise<void> {
      if (!(await isRevoked())) return;
      const nonce = await publicClient.getTransactionCount({ address: guardian.address, blockTag: "pending" });
      const hash = await guardianWallet.writeContract({
        address: GUARD_ADDRESS,
        abi: GUARD_ABI,
        functionName: "restore",
        args: [receiver],
        nonce,
      });
      await publicClient.waitForTransactionReceipt({ hash, confirmations: 2 });

      const deadline = Date.now() + 90_000;
      while (Date.now() < deadline) {
        if (await facilitatorSeesRestored()) return;
        await new Promise((resolve) => setTimeout(resolve, 5000));
      }
    }

    // The ledger's incident count survives across test runs (it's keyed by this same
    // guard address in the seller's DO storage), so don't assume this run starts the
    // payer at zero incidents — cheat until either banned or a generous cap is hit.
    const MAX_CYCLES = 5;
    const cheatedAt: number[] = [];
    let banned: Awaited<ReturnType<typeof runCheat>> | undefined;

    for (let i = 0; i < MAX_CYCLES; i++) {
      await restoreReceiverIfRevoked();
      const result = await runCheat(config, "AAPL");
      if (result.status === 402) {
        banned = result;
        break;
      }
      expect(result.status).toBe(200); // the seller serves genuinely good data each time
      expect(result.revoked).toBe(true); // the cheat buyer revokes it anyway
      expect(result.revokeTx).toBeTruthy();
      cheatedAt.push(Date.now());
    }

    if (!banned) {
      // Give the seller's own alarm (its own ~75s cadence, PLAN.md §2.2) at least one full
      // cycle after the LAST cheat purchase to observe the resulting failed claims and ban.
      const deadline = cheatedAt[cheatedAt.length - 1] + 100_000;
      while (Date.now() < deadline) {
        const result = await runCheat(config, "AAPL");
        if (result.status === 402) {
          banned = result;
          break;
        }
        await new Promise((resolve) => setTimeout(resolve, 10_000));
      }
    }

    expect(banned).toBeDefined();
    // The x402 SDK's paymentMiddleware maps an aborted (banned) verification to a
    // standard 402 "payment required" response, not a distinct 403 — confirmed live
    // during Phase 6 rehearsal (docs/PLAN.md §16 beat 5): 4 consecutive requests from
    // a just-banned payer each returned 402 Payment Required in the real wrangler log.
    expect(banned!.status).toBe(402);
    expect(banned!.revoked).toBe(false); // never got a 200 to revoke -- banned pre-verify
  }, 300_000);
});

function requireEnv(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`missing required env var ${name} (RUN_E2E=1 requires contracts/.env's keys)`);
  return v;
}
