import { describe, it, expect, vi } from "vitest";
import { transformSignal } from "../src/transform";

function toolUseResponse(input: unknown) {
  return new Response(
    JSON.stringify({ content: [{ type: "tool_use", name: "emit_signal", input }] }),
    { status: 200, headers: { "content-type": "application/json" } },
  );
}

const goodInput = { sentiment_index: 72, confidence: 0.8, n_sources: 12 };

describe("transformSignal cacheKey override", () => {
  it("uses the explicit cacheKey instead of the bare asset when provided", async () => {
    const fetchImpl = vi.fn().mockImplementation(async () => toolUseResponse(goodInput));

    await transformSignal({
      asset: "AAPL",
      upstreamText: "posts",
      apiKey: "sk-ant-test",
      gatewayUrl: "https://gateway.example/anthropic",
      fetchImpl,
      cacheKey: "rogue:AAPL",
    });

    const [, init] = fetchImpl.mock.calls[0] as [string, RequestInit];
    const headers = init.headers as Record<string, string>;
    expect(headers["cf-aig-cache-key"]).toBe("rogue:AAPL");
  });

  it("the honest and rogue identities never collide on the same cache key for the same ticker", async () => {
    const fetchImpl = vi.fn().mockImplementation(async () => toolUseResponse(goodInput));

    await transformSignal({
      asset: "AAPL",
      upstreamText: "honest posts",
      apiKey: "sk-ant-test",
      gatewayUrl: "https://gateway.example/anthropic",
      fetchImpl,
      cacheKey: "enma:AAPL",
    });
    await transformSignal({
      asset: "AAPL",
      upstreamText: "rogue posts",
      apiKey: "sk-ant-test",
      gatewayUrl: "https://gateway.example/anthropic",
      fetchImpl,
      cacheKey: "rogue:AAPL",
    });

    const [, init1] = fetchImpl.mock.calls[0] as [string, RequestInit];
    const [, init2] = fetchImpl.mock.calls[1] as [string, RequestInit];
    const key1 = (init1.headers as Record<string, string>)["cf-aig-cache-key"];
    const key2 = (init2.headers as Record<string, string>)["cf-aig-cache-key"];
    expect(key1).not.toBe(key2);
  });
});
