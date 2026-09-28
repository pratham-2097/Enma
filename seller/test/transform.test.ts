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

describe("transformSignal", () => {
  it("returns a validated Signal when Claude emits a well-formed tool call", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      toolUseResponse({
        sentiment_index: 72,
        confidence: 0.8,
        n_sources: 12,
      }),
    );

    const signal = await transformSignal({
      asset: "AAPL",
      upstreamText: "AAPL had mixed coverage today.",
      apiKey: "sk-ant-test",
      gatewayUrl: "https://gateway.example/anthropic",
      fetchImpl,
    });

    expect(signal.asset).toBe("AAPL");
    expect(signal.sentiment_index).toBe(72);
    expect(signal.model).toContain("claude");
  });

  it("throws TransformError (never a fake success) when Claude's response can't be parsed into a Signal", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      toolUseResponse({
        sentiment_index: "not-a-number", // malformed
        confidence: 0.8,
        n_sources: 12,
      }),
    );

    await expect(
      transformSignal({
        asset: "AAPL",
        upstreamText: "AAPL had mixed coverage today.",
        apiKey: "sk-ant-test",
        gatewayUrl: "https://gateway.example/anthropic",
        fetchImpl,
      }),
    ).rejects.toThrow(/transform/i);
  });

  it("throws TransformError when the upstream Claude call itself fails (never a fake 200)", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(new Response("upstream error", { status: 500 }));

    await expect(
      transformSignal({
        asset: "AAPL",
        upstreamText: "AAPL had mixed coverage today.",
        apiKey: "sk-ant-test",
        gatewayUrl: "https://gateway.example/anthropic",
        fetchImpl,
      }),
    ).rejects.toThrow(/transform/i);
  });

  it("throws TransformError when Claude replies with no tool_use block", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          id: "msg_1",
          type: "message",
          role: "assistant",
          content: [{ type: "text", text: "I refuse to use the tool." }],
          model: "claude-opus-5",
          stop_reason: "end_turn",
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      ),
    );

    await expect(
      transformSignal({
        asset: "AAPL",
        upstreamText: "AAPL had mixed coverage today.",
        apiKey: "sk-ant-test",
        gatewayUrl: "https://gateway.example/anthropic",
        fetchImpl,
      }),
    ).rejects.toThrow(/transform/i);
  });
});
