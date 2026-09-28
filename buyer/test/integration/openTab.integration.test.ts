import "dotenv/config";
import { describe, it, expect } from "vitest";
import { baseSepolia } from "viem/chains";
import type { Address, Hex } from "viem";
import { channelConfigFrom402, openTab, getChannelReceiver } from "../../src/openTab";

/**
 * Proves the on-chain channelReceiver mapping matches what we actually opened with —
 * a real openTab against the real deployed EnmaGuard on Base Sepolia. Not mocked.
 *
 * Skipped by default (RUN_INTEGRATION=1 to opt in) since it spends real testnet gas.
 */
const RUN = process.env.RUN_INTEGRATION === "1";

describe.skipIf(!RUN)("openTab.integration (live network, RUN_INTEGRATION=1)", () => {
  it("channelReceiver(channelId) matches the receiver we opened the tab with", async () => {
    const RPC_URL = requireEnv("RPC_URL");
    const OWNER_PRIVATE_KEY = requireEnv("OWNER_PRIVATE_KEY") as Hex;
    const ENMA_GUARD_ADDRESS = requireEnv("ENMA_GUARD_ADDRESS") as Address;
    const ESCROW_ADDRESS = "0x4020074e9dF2ce1deE5A9C1b5c3f541D02a10003" as Address;
    const USDC_SEPOLIA = "0x036CbD53842c5426634e7929541eC2318f3dCF7e" as Address;

    // a receiver distinct from any previously-opened channel's, for a clean assertion
    const receiver = "0x000000000000000000000000000000000000cafE" as Address;
    const receiverAuthorizer = "0x000000000000000000000000000000000000Face" as Address;

    const cfg = channelConfigFrom402({
      guardAddress: ENMA_GUARD_ADDRESS,
      token: USDC_SEPOLIA,
      accepted: {
        payTo: receiver,
        extra: { receiverAuthorizer, withdrawDelay: 900 },
      },
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
      settleDelayMs: 0, // no facilitator involved here, just our own RPC's read-after-write
    });

    const onChainReceiver = await getChannelReceiver({
      chain: baseSepolia,
      rpcUrl: RPC_URL,
      guardAddress: ENMA_GUARD_ADDRESS,
      channelId,
    });

    expect(onChainReceiver.toLowerCase()).toBe(receiver.toLowerCase());
  }, 60_000);
});

function requireEnv(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`missing required env var ${name} (RUN_INTEGRATION=1 requires contracts/.env's keys)`);
  return v;
}
