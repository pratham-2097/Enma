import "dotenv/config";
import { describe, it, expect } from "vitest";
import { createPublicClient, http, type Address, type Hex } from "viem";
import { baseSepolia } from "viem/chains";
import { runBuy } from "../../src/agent";
import type { AgentConfig } from "../../src/agent";

/**
 * Gate G3-partial, beat 2: trigger the seller's own claim alarm (it fires every
 * ~75s on its own, PLAN.md §2.2's "safety window") and watch a real claim land:
 * the escrow's recorded channel balance drops and the receiver's on-chain USDC
 * balance rises. Live, real facilitator, real Base Sepolia. Requires `wrangler
 * dev` running in seller/. Skipped by default (RUN_E2E=1).
 */
const RUN = process.env.RUN_E2E === "1";

const ESCROW_ADDRESS = "0x4020074e9dF2ce1deE5A9C1b5c3f541D02a10003" as Address;
const USDC_SEPOLIA = "0x036CbD53842c5426634e7929541eC2318f3dCF7e" as Address;

const ESCROW_ABI = [
  {
    type: "function",
    name: "channels",
    stateMutability: "view",
    inputs: [{ name: "", type: "bytes32" }],
    outputs: [
      { name: "balance", type: "uint128" },
      { name: "totalClaimed", type: "uint128" },
    ],
  },
] as const;

const ERC20_ABI = [
  {
    type: "function",
    name: "balanceOf",
    stateMutability: "view",
    inputs: [{ name: "a", type: "address" }],
    outputs: [{ type: "uint256" }],
  },
] as const;

describe.skipIf(!RUN)("e2e.claim (live, RUN_E2E=1)", () => {
  it("the DO alarm claims the channel and settle() moves USDC to the seller", async () => {
    const RPC_URL = requireEnv("RPC_URL");
    const publicClient = createPublicClient({ chain: baseSepolia, transport: http(RPC_URL) });

    const config: AgentConfig = {
      chain: baseSepolia,
      rpcUrl: RPC_URL,
      sellerUrl: process.env.SELLER_URL ?? "http://localhost:8787",
      escrowAddress: ESCROW_ADDRESS,
      usdcAddress: USDC_SEPOLIA,
      guardAddress: requireEnv("ENMA_GUARD_ADDRESS") as Address,
      ownerPrivateKey: requireEnv("OWNER_PRIVATE_KEY") as Hex,
      agentPrivateKey: requireEnv("AGENT_PRIVATE_KEY") as Hex,
      guardianPrivateKey: requireEnv("GUARDIAN_PRIVATE_KEY") as Hex,
    };
    const receiver = requireEnv("ENMA_RECEIVER_ADDRESS") as Address;

    const purchase = await runBuy(config, "AAPL");
    expect(purchase.status).toBe(200);
    expect(purchase.revoked).toBe(false);

    const receiverBalanceBefore = (await publicClient.readContract({
      address: USDC_SEPOLIA,
      abi: ERC20_ABI,
      functionName: "balanceOf",
      args: [receiver],
    })) as bigint;

    // The DO's own alarm fires on its own ~75s cadence (SellerDO's CLAIM_INTERVAL_SECS) —
    // poll rather than assume a fixed wait, since it may already be mid-cycle.
    const deadline = Date.now() + 150_000;
    let claimed = false;
    while (Date.now() < deadline) {
      const receiverBalanceNow = (await publicClient.readContract({
        address: USDC_SEPOLIA,
        abi: ERC20_ABI,
        functionName: "balanceOf",
        args: [receiver],
      })) as bigint;
      if (receiverBalanceNow > receiverBalanceBefore) {
        claimed = true;
        break;
      }
      await new Promise((resolve) => setTimeout(resolve, 10_000));
    }

    expect(claimed).toBe(true);
  }, 180_000);
});

function requireEnv(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`missing required env var ${name} (RUN_E2E=1 requires contracts/.env's keys)`);
  return v;
}
