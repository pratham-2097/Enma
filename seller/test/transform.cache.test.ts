import { describe, it, expect, vi } from "vitest";
import { transformSignal } from "../src/transform";

function toolUseResponse(input: unknown) {
  return new Response(
    JSON.stringify({
      id: "msg_1",
      type: "message",
      role: "assistant",
      content: [{ type: "tool_use", id: "tu_1", name: "emit_signal", input }],
      model: "claude-opus-5",
      stop_reason: "tool_use",
    }),
    { status: 200, headers: { "content-type": "application/json" } },
  );
}

const goodInput = {
  sentiment_index: 72,
  confidence: 0.8,
  n_sources: 12,
};

describe("transformSignal AI Gateway caching headers", () => {
  it("sets cf-aig-cache-ttl to 60s so Cloudflare caches the response for a minute", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(toolUseResponse(goodInput));
    await transformSignal({
      asset: "AAPL",
      upstreamText: "posts",
      apiKey: "sk-ant-test",
      gatewayUrl: "https://gateway.example/anthropic",
      fetchImpl,
    });

    const [, init] = fetchImpl.mock.calls[0] as [string, RequestInit];
    const headers = init.headers as Record<string, string>;
    expect(headers["cf-aig-cache-ttl"]).toBe("60");
  });

  it("keys the cache on the ticker, not the full prompt, so many buyers of the same asset share one call", async () => {
    const fetchImpl = vi.fn().mockImplementation(async () => toolUseResponse(goodInput));

    await transformSignal({
      asset: "AAPL",
      upstreamText: "buyer 1's prompt text",
      apiKey: "sk-ant-test",
      gatewayUrl: "https://gateway.example/anthropic",
      fetchImpl,
    });
    await transformSignal({
      asset: "AAPL",
      upstreamText: "buyer 2's completely different prompt text",
      apiKey: "sk-ant-test",
      gatewayUrl: "https://gateway.example/anthropic",
      fetchImpl,
    });

    const [, init1] = fetchImpl.mock.calls[0] as [string, RequestInit];
    const [, init2] = fetchImpl.mock.calls[1] as [string, RequestInit];
    const key1 = (init1.headers as Record<string, string>)["cf-aig-cache-key"];
    const key2 = (init2.headers as Record<string, string>)["cf-aig-cache-key"];

    expect(key1).toBe("AAPL");
    expect(key2).toBe("AAPL");
    expect(key1).toBe(key2);
  });

  it("uses a different cache key for a different ticker", async () => {
    const fetchImpl = vi.fn().mockImplementation(async () => toolUseResponse(goodInput));

    await transformSignal({
      asset: "AAPL",
      upstreamText: "posts",
      apiKey: "sk-ant-test",
      gatewayUrl: "https://gateway.example/anthropic",
      fetchImpl,
    });
    await transformSignal({
      asset: "TSLA",
      upstreamText: "posts",
      apiKey: "sk-ant-test",
      gatewayUrl: "https://gateway.example/anthropic",
      fetchImpl,
    });

    const [, init1] = fetchImpl.mock.calls[0] as [string, RequestInit];
    const [, init2] = fetchImpl.mock.calls[1] as [string, RequestInit];
    const key1 = (init1.headers as Record<string, string>)["cf-aig-cache-key"];
    const key2 = (init2.headers as Record<string, string>)["cf-aig-cache-key"];

    expect(key1).not.toBe(key2);
  });
});
