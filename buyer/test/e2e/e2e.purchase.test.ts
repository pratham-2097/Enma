import "dotenv/config";
import { describe, it, expect } from "vitest";
import { baseSepolia } from "viem/chains";
import type { Address, Hex } from "viem";
import { runBuy } from "../../src/agent";
import type { AgentConfig } from "../../src/agent";

/**
 * Gate G3-partial, beat 1: buy -> 200 -> QA passes -> no revoke.
 * Live: real openTab, real voucher, real facilitator verification, real Claude call.
 * Requires `wrangler dev` running in seller/. Skipped by default (RUN_E2E=1).
 */
const RUN = process.env.RUN_E2E === "1";

describe.skipIf(!RUN)("e2e.purchase (live, RUN_E2E=1)", () => {
  it("buy AAPL: gets a 200, passes QA, never revokes", async () => {
    const config: AgentConfig = {
      chain: baseSepolia,
      rpcUrl: requireEnv("RPC_URL"),
      sellerUrl: process.env.SELLER_URL ?? "http://localhost:8787",
      escrowAddress: "0x4020074e9dF2ce1deE5A9C1b5c3f541D02a10003" as Address,
      usdcAddress: "0x036CbD53842c5426634e7929541eC2318f3dCF7e" as Address,
      guardAddress: requireEnv("ENMA_GUARD_ADDRESS") as Address,
      ownerPrivateKey: requireEnv("OWNER_PRIVATE_KEY") as Hex,
      agentPrivateKey: requireEnv("AGENT_PRIVATE_KEY") as Hex,
      guardianPrivateKey: requireEnv("GUARDIAN_PRIVATE_KEY") as Hex,
      jevApiKey: process.env.TYPESAFE_API_KEY || undefined,
    };

    const result = await runBuy(config, "AAPL");

    expect(result.status).toBe(200);
    expect(result.revoked).toBe(false);
    expect(result.body).toBeDefined();
  }, 60_000);
});

function requireEnv(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`missing required env var ${name} (RUN_E2E=1 requires contracts/.env's keys)`);
  return v;
}
