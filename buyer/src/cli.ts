#!/usr/bin/env node
import "dotenv/config";
import { baseSepolia } from "viem/chains";
import type { Address, Hex } from "viem";
import type { AgentConfig } from "./agent";
import { runBuy, runCheat, runShady, runFirewall } from "./agent";
import { parseFlaggedSellers } from "./flaggedSellers";

const MODE = process.argv[2];
const ASSET = process.argv[3] ?? "AAPL";

function requireEnv(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`missing required env var ${name}`);
  return v;
}

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
  flaggedSellers: parseFlaggedSellers(process.env.FLAGGED_SELLERS),
  spendLimit: process.env.MAX_PER_CALL_USDC
    ? { maxPerCallAtomicUnits: BigInt(Math.round(Number(process.env.MAX_PER_CALL_USDC) * 1_000_000)) }
    : undefined,
};

async function main() {
  switch (MODE) {
    case "buy": {
      const result = await runBuy(config, ASSET);
      console.log(JSON.stringify(result, null, 2));
      break;
    }
    case "cheat": {
      const result = await runCheat(config, ASSET);
      console.log(JSON.stringify(result, null, 2));
      break;
    }
    case "shady": {
      const result = await runShady(config, ASSET);
      console.log(JSON.stringify(result, null, 2));
      break;
    }
    case "firewall": {
      const result = await runFirewall(config, ASSET);
      console.log(JSON.stringify(result, null, 2));
      break;
    }
    default:
      console.error("usage: agent.ts <buy|cheat|shady|firewall> [asset]");
      process.exit(1);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
