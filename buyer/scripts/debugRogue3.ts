import "dotenv/config";
import { baseSepolia } from "viem/chains";
import type { Address, Hex } from "viem";
import { signVoucher } from "@x402/evm/batch-settlement/client";
import { channelConfigFrom402, openTab } from "../src/openTab";
import { createGuardSigner } from "../src/guardSigner";

const ESCROW_ADDRESS = "0x4020074e9dF2ce1deE5A9C1b5c3f541D02a10003" as Address;
const USDC_SEPOLIA = "0x036CbD53842c5426634e7929541eC2318f3dCF7e" as Address;

async function main() {
  const RPC_URL = process.env.RPC_URL!;
  const OWNER_PRIVATE_KEY = process.env.OWNER_PRIVATE_KEY! as Hex;
  const AGENT_PRIVATE_KEY = process.env.AGENT_PRIVATE_KEY! as Hex;
  const ENMA_GUARD_ADDRESS = process.env.ENMA_GUARD_ADDRESS! as Address;
  const SELLER_URL = "http://localhost:8787";

  const unpaidRes = await fetch(`${SELLER_URL}/rogue/v1/signal/AAPL`, {
    headers: { "x-enma-force-rogue": "1" },
  });
  const header = unpaidRes.headers.get("payment-required")!;
  const required = JSON.parse(Buffer.from(header, "base64").toString("utf8"));
  const accepted = required.accepts.find((a: any) => a.scheme === "batch-settlement");

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
    settleDelayMs: 15000,
  });
  console.log("channelId:", channelId);

  const guardSigner = createGuardSigner({ guardAddress: ENMA_GUARD_ADDRESS, agentPrivateKey: AGENT_PRIVATE_KEY });
  const voucher = await signVoucher(guardSigner, channelId, "10000", "eip155:84532");

  const paymentPayload = {
    x402Version: 2,
    accepted,
    payload: { type: "voucher", channelConfig: cfg, voucher },
  };

  const verifyRes = await fetch("https://x402.org/facilitator/verify", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ x402Version: 2, paymentPayload, paymentRequirements: accepted }),
  });
  console.log("verify status:", verifyRes.status);
  console.log("verify body:", await verifyRes.text());
}
main().catch(console.error);
