#!/usr/bin/env node
import "dotenv/config";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  type Tool,
} from "@modelcontextprotocol/sdk/types.js";
import { baseSepolia } from "viem/chains";
import type { Address, Hex } from "viem";
import type { AgentConfig, AgentRunResult } from "./agent";
import { runBuy, runCheat, runShady, runFirewall } from "./agent";
import { parseFlaggedSellers } from "./flaggedSellers";

/**
 * D7: wraps the buyer's own buy/cheat/shady modes as an MCP server, so a
 * Claude session can pay EnmaGuard-gated sellers directly — from `buyer/`,
 * `claude mcp add enma -- npx tsx src/mcp.ts`. Every tool call goes through
 * the exact same agent.ts path the CLI uses: real openTab, real voucher,
 * real QA gates, real revoke. Nothing here is a separate/mocked payment path.
 */
function requireEnv(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`missing required env var ${name}`);
  return v;
}

function loadConfig(): AgentConfig {
  return {
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
}

const ASSET_INPUT_SCHEMA = {
  type: "object" as const,
  properties: {
    asset: {
      type: "string",
      description: 'Ticker to buy a sentiment signal for, e.g. "AAPL". Defaults to "AAPL".',
    },
  },
};

const TOOLS: Tool[] = [
  {
    name: "buy_signal",
    description:
      "Pay for and fetch a market-sentiment signal for a ticker via x402 batch-settlement. " +
      "Runs the full honest buyer path: pay, run deterministic + Jev QA, and revoke the " +
      "voucher automatically if the data fails QA. Returns the signal (or the QA/revoke outcome).",
    inputSchema: ASSET_INPUT_SCHEMA,
  },
  {
    name: "cheat_signal",
    description:
      "Buyer-abuse demo mode: pays for a signal, then revokes it regardless of whether the " +
      "data was genuinely good. Used to demonstrate the seller's MAD (mutually-assured " +
      "disincentive) ledger and ban path, not to evaluate seller data quality.",
    inputSchema: ASSET_INPUT_SCHEMA,
  },
  {
    name: "shady_signal",
    description:
      "Screens the seller's on-chain payTo address against a local denylist before ever " +
      "signing a voucher. Refuses to pay a known-flagged seller; otherwise behaves like buy_signal " +
      "without running the QA/revoke gates.",
    inputSchema: ASSET_INPUT_SCHEMA,
  },
  {
    name: "firewall_signal",
    description:
      "Same honest buy as buy_signal, but with a per-call spend cap (MAX_PER_CALL_USDC) enforced " +
      "BEFORE any channel is opened or gas is spent. If the seller's quoted price exceeds the cap, " +
      "refuses outright with zero funds at risk — the buyer-side counterpart to the seller-side QA " +
      "revoke. No-op (behaves like buy_signal) if MAX_PER_CALL_USDC isn't set.",
    inputSchema: ASSET_INPUT_SCHEMA,
  },
];

function textResult(result: AgentRunResult) {
  return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
}

export function createServer(config: AgentConfig = loadConfig()): Server {
  const server = new Server(
    { name: "enma-buyer", version: "0.0.0" },
    { capabilities: { tools: {} } },
  );

  server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: TOOLS }));

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const asset = (request.params.arguments?.asset as string | undefined) ?? "AAPL";

    switch (request.params.name) {
      case "buy_signal":
        return textResult(await runBuy(config, asset));
      case "cheat_signal":
        return textResult(await runCheat(config, asset));
      case "shady_signal":
        return textResult(await runShady(config, asset));
      case "firewall_signal":
        return textResult(await runFirewall(config, asset));
      default:
        throw new Error(`unknown tool "${request.params.name}"`);
    }
  });

  return server;
}

async function main() {
  const server = createServer();
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
