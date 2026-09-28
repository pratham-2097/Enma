import { describe, it, expect, vi } from "vitest";
import { checkJev, QA_REASON_JEV_FAIL } from "../src/qa";

function jevResponse(noul: number) {
  return new Response(
    JSON.stringify({
      model: "jev-1.13.0",
      answers: { is_genuine: { type: "noul", noul } },
      usage: { input_tokens: 100, output_tokens: 10 },
    }),
    { status: 200, headers: { "content-type": "application/json" } },
  );
}

const signalPayload = { asset: "AAPL", sentiment_index: 72 };

describe("checkJev (QA gate 2)", () => {
  it("passes when Jev is highly confident the data is genuine (noul close to 1)", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jevResponse(0.95));
    const result = await checkJev(signalPayload, { apiKey: "test-key", fetchImpl });
    expect(result.ok).toBe(true);
  });

  it("revokes with reason 11 when p(bad) >= 0.9 (noul <= 0.1, i.e. Jev is confident it's fake)", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jevResponse(0.05));
    const result = await checkJev(signalPayload, { apiKey: "test-key", fetchImpl });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reasonCode).toBe(QA_REASON_JEV_FAIL);
  });

  it("does NOT revoke on a merely-uncertain verdict (p(bad) below the 0.9 threshold)", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jevResponse(0.5)); // p(bad) = 0.5, below threshold
    const result = await checkJev(signalPayload, { apiKey: "test-key", fetchImpl });
    expect(result.ok).toBe(true);
  });

  it("a 3s timeout is treated as 'no opinion', not a revoke", async () => {
    const fetchImpl = vi.fn().mockImplementation(
      () => new Promise((_resolve, reject) => setTimeout(() => reject(new DOMException("Aborted", "AbortError")), 10)),
    );
    const result = await checkJev(signalPayload, { apiKey: "test-key", fetchImpl, timeoutMs: 5 });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.noOpinion).toBe(true);
  });

  it("an HTTP error from Jev is also 'no opinion', never a silent revoke", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(new Response("upstream error", { status: 500 }));
    const result = await checkJev(signalPayload, { apiKey: "test-key", fetchImpl });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.noOpinion).toBe(true);
  });
});
