import { describe, it, expect } from "vitest";
import { checkDeterministic, QA_REASON_SCHEMA_FAIL } from "../src/qa";

const goodSignal = {
  asset: "AAPL",
  sentiment_index: 72,
  confidence: 0.8,
  n_sources: 3,
  window_start: new Date(Date.now() - 60_000).toISOString(),
  window_end: new Date().toISOString(),
  model: "claude-opus-5",
};

describe("checkDeterministic (QA gate 1)", () => {
  it("passes a well-formed, fresh signal", () => {
    const result = checkDeterministic(goodSignal);
    expect(result.ok).toBe(true);
  });

  it("fails a payload that doesn't parse against the shared schema at all", () => {
    const result = checkDeterministic({ not: "a signal" });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reasonCode).toBe(QA_REASON_SCHEMA_FAIL);
  });

  it.each([
    ["sentiment_index below range", { ...goodSignal, sentiment_index: -1 }],
    ["sentiment_index above range", { ...goodSignal, sentiment_index: 101 }],
    ["confidence below range", { ...goodSignal, confidence: -0.1 }],
    ["confidence above range", { ...goodSignal, confidence: 1.1 }],
    ["n_sources below minimum (zero sources)", { ...goodSignal, n_sources: 0 }],
    ["asset fails the ticker format", { ...goodSignal, asset: "not a ticker!!" }],
    ["window_end stale beyond the freshness window", { ...goodSignal, window_end: new Date(Date.now() - 10 * 60_000).toISOString() }],
    ["sentinel string 'error'", { ...goodSignal, model: "error" }],
    ["sentinel string 'N/A'", { ...goodSignal, asset: "N/A" }],
    ["sentinel shrug string", { ...goodSignal, model: "¯\\_(ツ)_/¯" }],
  ])("fails independently: %s", (_label, signal) => {
    const result = checkDeterministic(signal);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reasonCode).toBe(QA_REASON_SCHEMA_FAIL);
  });
});
