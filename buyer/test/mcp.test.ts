import { describe, it, expect, vi, beforeEach } from "vitest";
import { baseSepolia } from "viem/chains";
import type { Address, Hex } from "viem";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import type { AgentConfig, AgentRunResult } from "../src/agent";

const runBuy = vi.fn<(config: AgentConfig, asset: string) => Promise<AgentRunResult>>();
const runCheat = vi.fn<(config: AgentConfig, asset: string) => Promise<AgentRunResult>>();
const runShady = vi.fn<(config: AgentConfig, asset: string) => Promise<AgentRunResult>>();
const runFirewall = vi.fn<(config: AgentConfig, asset: string) => Promise<AgentRunResult>>();

vi.mock("../src/agent", () => ({ runBuy, runCheat, runShady, runFirewall }));

const config: AgentConfig = {
  chain: baseSepolia,
  rpcUrl: "http://localhost:1",
  sellerUrl: "http://localhost:8787",
  escrowAddress: "0x4020074e9dF2ce1deE5A9C1b5c3f541D02a10003" as Address,
  usdcAddress: "0x036CbD53842c5426634e7929541eC2318f3dCF7e" as Address,
  guardAddress: "0x0000000000000000000000000000000000000001" as Address,
  ownerPrivateKey: "0x1111111111111111111111111111111111111111111111111111111111111111".slice(0, 66) as Hex,
  agentPrivateKey: "0x2222222222222222222222222222222222222222222222222222222222222222".slice(0, 66) as Hex,
  guardianPrivateKey: "0x3333333333333333333333333333333333333333333333333333333333333333".slice(0, 66) as Hex,
};

async function connectedClient() {
  const { createServer } = await import("../src/mcp");
  const server = createServer(config);
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: "test-client", version: "0.0.0" });
  await Promise.all([client.connect(clientTransport), server.connect(serverTransport)]);
  return client;
}

describe("mcp server (D7)", () => {
  beforeEach(() => {
    runBuy.mockReset();
    runCheat.mockReset();
    runShady.mockReset();
    runFirewall.mockReset();
  });

  it("lists buy_signal, cheat_signal, shady_signal, firewall_signal", async () => {
    const client = await connectedClient();
    const { tools } = await client.listTools();
    expect(tools.map((t) => t.name).sort()).toEqual([
      "buy_signal",
      "cheat_signal",
      "firewall_signal",
      "shady_signal",
    ]);
  });

  it("buy_signal calls runBuy with the given asset and returns its result as text", async () => {
    runBuy.mockResolvedValue({ mode: "buy", status: 200, revoked: false, body: { asset: "TSLA" } });
    const client = await connectedClient();

    const result = await client.callTool({ name: "buy_signal", arguments: { asset: "TSLA" } });

    expect(runBuy).toHaveBeenCalledWith(config, "TSLA");
    const content = result.content as { type: string; text: string }[];
    expect(JSON.parse(content[0].text)).toMatchObject({ mode: "buy", status: 200 });
  });

  it("defaults to AAPL when no asset is given", async () => {
    runShady.mockResolvedValue({ mode: "shady", revoked: false, refused: true, reason: "payTo flagged" });
    const client = await connectedClient();

    await client.callTool({ name: "shady_signal", arguments: {} });

    expect(runShady).toHaveBeenCalledWith(config, "AAPL");
  });

  it("cheat_signal routes to runCheat", async () => {
    runCheat.mockResolvedValue({ mode: "cheat", status: 200, revoked: true, revokeTx: "0xabc" as Hex });
    const client = await connectedClient();

    const result = await client.callTool({ name: "cheat_signal", arguments: { asset: "MSFT" } });

    expect(runCheat).toHaveBeenCalledWith(config, "MSFT");
    const content = result.content as { type: string; text: string }[];
    expect(JSON.parse(content[0].text)).toMatchObject({ mode: "cheat", revoked: true });
  });

  it("firewall_signal routes to runFirewall", async () => {
    runFirewall.mockResolvedValue({
      mode: "firewall",
      revoked: false,
      refused: true,
      reason: "per-call limit exceeded",
    });
    const client = await connectedClient();

    const result = await client.callTool({ name: "firewall_signal", arguments: { asset: "GOOG" } });

    expect(runFirewall).toHaveBeenCalledWith(config, "GOOG");
    const content = result.content as { type: string; text: string }[];
    expect(JSON.parse(content[0].text)).toMatchObject({ mode: "firewall", refused: true });
  });
});
