// Gate G2 proof: a real openTab, a real voucher signed for EnmaGuard via the SDK's own
// signVoucher() + our custom guardSigner, and a real 200 from the seller Worker (via
// `wrangler dev`) against the live x402.org facilitator on Base Sepolia. Run with
// `npm run prove-g2` from buyer/ while `wrangler dev` is running in seller/.
import "dotenv/config";
import { createPublicClient, createWalletClient, http, type Address, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { baseSepolia } from "viem/chains";
import { signVoucher } from "@x402/evm/batch-settlement/client";
import { createGuardSigner } from "../src/guardSigner";

const RPC_URL = requireEnv("RPC_URL");
const OWNER_PRIVATE_KEY = requireEnv("OWNER_PRIVATE_KEY") as Hex;
const AGENT_PRIVATE_KEY = requireEnv("AGENT_PRIVATE_KEY") as Hex;
const ENMA_GUARD_ADDRESS = requireEnv("ENMA_GUARD_ADDRESS") as Address;
const SELLER_URL = process.env.SELLER_URL ?? "http://localhost:8787";
const ESCROW_ADDRESS = "0x4020074e9dF2ce1deE5A9C1b5c3f541D02a10003" as Address;
const USDC_SEPOLIA = "0x036CbD53842c5426634e7929541eC2318f3dCF7e" as Address;

function requireEnv(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`missing required env var ${name}`);
  return v;
}

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

async function main() {
  const publicClient = createPublicClient({ chain: baseSepolia, transport: http(RPC_URL) });
  const owner = privateKeyToAccount(OWNER_PRIVATE_KEY);
  const ownerWallet = createWalletClient({ account: owner, chain: baseSepolia, transport: http(RPC_URL) });
  const guardSigner = createGuardSigner({ guardAddress: ENMA_GUARD_ADDRESS, agentPrivateKey: AGENT_PRIVATE_KEY });

  console.log("1. GET /v1/signal/AAPL (unpaid) to read the seller's live 402 terms...");
  const unpaidRes = await fetch(`${SELLER_URL}/v1/signal/AAPL`);
  if (unpaidRes.status !== 402) {
    throw new Error(`expected 402, got ${unpaidRes.status}: ${await unpaidRes.text()}`);
  }
  const header = unpaidRes.headers.get("payment-required");
  if (!header) throw new Error("no payment-required header on 402");
  const required = JSON.parse(Buffer.from(header, "base64").toString("utf8"));
  const accepted = required.accepts.find((a: { scheme: string }) => a.scheme === "batch-settlement");
  if (!accepted) throw new Error("seller did not offer batch-settlement");
  console.log("   payTo:", accepted.payTo, "amount:", accepted.amount, "receiverAuthorizer:", accepted.extra.receiverAuthorizer);

  const cfg = {
    payer: ENMA_GUARD_ADDRESS,
    payerAuthorizer: "0x0000000000000000000000000000000000000000" as Address,
    receiver: accepted.payTo as Address,
    receiverAuthorizer: accepted.extra.receiverAuthorizer as Address,
    token: USDC_SEPOLIA,
    withdrawDelay: accepted.extra.withdrawDelay as number,
    salt: ("0x" + Date.now().toString(16).padStart(64, "0")) as Hex,
  };

  console.log("2. EnmaGuard.openTab(cfg, 50000) — building a tab from the guard's own funds...");
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
  // The facilitator reads channel state from its own RPC node, which may lag ours by a
  // block or two even after our own confirmations — give it a moment to catch up.
  await new Promise((resolve) => setTimeout(resolve, 5000));
  console.log("   openTab tx:", openTabHash, "channelId:", channelId);

  console.log("3. Signing a voucher for one call's worth (10000 = $0.01) via the SDK's signVoucher() + guardSigner...");
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

  console.log("4. GET /v1/signal/AAPL with PAYMENT-SIGNATURE — the real facilitator verifies via eth_call to EnmaGuard...");
  const paidRes = await fetch(`${SELLER_URL}/v1/signal/AAPL`, {
    headers: { "payment-signature": paymentHeader },
  });
  const body = await paidRes.text();
  console.log("   status:", paidRes.status);
  console.log("   body:", body);

  if (paidRes.status !== 200) {
    throw new Error(`Gate G2 FAILED: expected 200, got ${paidRes.status}`);
  }
  console.log("\nGate G2 PASSED: real payment, real facilitator verification, real 200.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
