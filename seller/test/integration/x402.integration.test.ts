import { describe, it, expect } from "vitest";
import { createPublicClient, createWalletClient, http, type Address, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { baseSepolia } from "viem/chains";
import { signVoucher } from "@x402/evm/batch-settlement/client";
import { createGuardSigner } from "../../../buyer/src/guardSigner";

/**
 * Gate G2: a real openTab, a real voucher signed for the deployed EnmaGuard, and a
 * real 200 from the seller Worker — verified through the live x402.org facilitator's
 * eth_call to EnmaGuard.isValidSignature on Base Sepolia. Not mocked at any layer.
 *
 * Requires `wrangler dev` running in this directory and contracts/.env's funded
 * OWNER/AGENT keys. Skipped by default (RUN_G2=1 to opt in) since it spends real
 * testnet gas and needs network access — not something a normal `vitest run` should do.
 */
const RUN = process.env.RUN_G2 === "1";

const ESCROW_ADDRESS = "0x4020074e9dF2ce1deE5A9C1b5c3f541D02a10003" as Address;
const USDC_SEPOLIA = "0x036CbD53842c5426634e7929541eC2318f3dCF7e" as Address;

const GUARD_ABI = [
  {
    type: "function",
    name: "openTab",
    stateMutability: "nonpayable",
    inputs: [
      {
        name: "cfg",
        type: "tuple",
        components: [
          { name: "payer", type: "address" },
          { name: "payerAuthorizer", type: "address" },
          { name: "receiver", type: "address" },
          { name: "receiverAuthorizer", type: "address" },
          { name: "token", type: "address" },
          { name: "withdrawDelay", type: "uint40" },
          { name: "salt", type: "bytes32" },
        ],
      },
      { name: "amount", type: "uint128" },
    ],
    outputs: [],
  },
] as const;

const ESCROW_ABI = [
  {
    type: "function",
    name: "getChannelId",
    stateMutability: "view",
    inputs: [
      {
        name: "cfg",
        type: "tuple",
        components: [
          { name: "payer", type: "address" },
          { name: "payerAuthorizer", type: "address" },
          { name: "receiver", type: "address" },
          { name: "receiverAuthorizer", type: "address" },
          { name: "token", type: "address" },
          { name: "withdrawDelay", type: "uint40" },
          { name: "salt", type: "bytes32" },
        ],
      },
    ],
    outputs: [{ type: "bytes32" }],
  },
] as const;

describe.skipIf(!RUN)("x402.integration (Gate G2, live network, RUN_G2=1)", () => {
  it("a real openTab + a real voucher gets a real 200 from wrangler dev via the live facilitator", async () => {
    const RPC_URL = requireEnv("RPC_URL");
    const OWNER_PRIVATE_KEY = requireEnv("OWNER_PRIVATE_KEY") as Hex;
    const AGENT_PRIVATE_KEY = requireEnv("AGENT_PRIVATE_KEY") as Hex;
    const ENMA_GUARD_ADDRESS = requireEnv("ENMA_GUARD_ADDRESS") as Address;
    const SELLER_URL = process.env.SELLER_URL ?? "http://localhost:8787";

    const publicClient = createPublicClient({ chain: baseSepolia, transport: http(RPC_URL) });
    const owner = privateKeyToAccount(OWNER_PRIVATE_KEY);
    const ownerWallet = createWalletClient({ account: owner, chain: baseSepolia, transport: http(RPC_URL) });
    const guardSigner = createGuardSigner({ guardAddress: ENMA_GUARD_ADDRESS, agentPrivateKey: AGENT_PRIVATE_KEY });

    const unpaidRes = await fetch(`${SELLER_URL}/v1/signal/AAPL`);
    expect(unpaidRes.status).toBe(402);
    const header = unpaidRes.headers.get("payment-required");
    expect(header).toBeTruthy();
    const required = JSON.parse(Buffer.from(header!, "base64").toString("utf8"));
    const accepted = required.accepts.find((a: { scheme: string }) => a.scheme === "batch-settlement");
    expect(accepted).toBeDefined();

    const cfg = {
      payer: ENMA_GUARD_ADDRESS,
      payerAuthorizer: "0x0000000000000000000000000000000000000000" as Address,
      receiver: accepted.payTo as Address,
      receiverAuthorizer: accepted.extra.receiverAuthorizer as Address,
      token: USDC_SEPOLIA,
      withdrawDelay: accepted.extra.withdrawDelay as number,
      salt: ("0x" + Date.now().toString(16).padStart(64, "0")) as Hex,
    };

    const channelId = (await publicClient.readContract({
      address: ESCROW_ADDRESS,
      abi: ESCROW_ABI,
      functionName: "getChannelId",
      args: [cfg],
    })) as Hex;

    const openTabHash = await ownerWallet.writeContract({
      address: ENMA_GUARD_ADDRESS,
      abi: GUARD_ABI,
      functionName: "openTab",
      args: [cfg, 50_000n],
    });
    await publicClient.waitForTransactionReceipt({ hash: openTabHash, confirmations: 2 });
    // The facilitator reads from its own RPC node, which can lag ours by a block or two.
    await new Promise((resolve) => setTimeout(resolve, 5000));

    const claimAmount = "10000";
    const voucher = await signVoucher(guardSigner, channelId, claimAmount, "eip155:84532");

    const paymentPayload = {
      x402Version: 2,
      accepted,
      payload: {
        type: "voucher",
        channelConfig: cfg,
        voucher,
      },
    };
    const paymentHeader = Buffer.from(JSON.stringify(paymentPayload)).toString("base64");

    const paidRes = await fetch(`${SELLER_URL}/v1/signal/AAPL`, {
      headers: { "payment-signature": paymentHeader },
    });
    expect(paidRes.status).toBe(200);

    const body = (await paidRes.json()) as { asset: string; sentiment_index: number };
    expect(body.asset).toBe("AAPL");
    expect(body.sentiment_index).toBeGreaterThanOrEqual(0);
  }, 60_000);
});

function requireEnv(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`missing required env var ${name} (RUN_G2=1 requires contracts/.env's keys)`);
  return v;
}
