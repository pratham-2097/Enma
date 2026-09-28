import { describe, it, expect } from "vitest";
import {
  laneFor,
  describeEvent,
  basescanLink,
  short,
  usd,
  initialCounters,
  reduceCounters,
  formatCounters,
} from "./dashboardLogic";

describe("laneFor", () => {
  it("puts payment_required and qa_verdict on the buyer lane", () => {
    expect(laneFor({ kind: "payment_required", seller: "enma", asset: "AAPL" })).toBe("buyer");
    expect(laneFor({ kind: "qa_verdict", seller: "enma", asset: "AAPL", ok: true })).toBe("buyer");
  });

  it("puts data_served on the seller lane", () => {
    expect(laneFor({ kind: "data_served", seller: "enma", asset: "AAPL", payer: "0xP", amount: "10000" })).toBe(
      "seller",
    );
  });

  it("puts claimed/incident/banned/revoked on the escrow lane", () => {
    expect(laneFor({ kind: "claimed", seller: "enma", payer: "0xP", amount: "10000" })).toBe("escrow");
    expect(laneFor({ kind: "incident", seller: "enma", payer: "0xP", amount: "10000" })).toBe("escrow");
    expect(laneFor({ kind: "banned", seller: "enma", payer: "0xP" })).toBe("escrow");
    expect(laneFor({ kind: "revoked", seller: "enma", payer: "0xP" })).toBe("escrow");
  });
});

describe("describeEvent", () => {
  it("marks a passing QA verdict as ok and a failing one as fail, with the reason included", () => {
    const pass = describeEvent({ kind: "qa_verdict", seller: "enma", asset: "AAPL", ok: true });
    expect(pass.tone).toBe("ok");

    const fail = describeEvent({ kind: "qa_verdict", seller: "enma", asset: "AAPL", ok: false, reason: "stale" });
    expect(fail.tone).toBe("fail");
    expect(fail.text).toContain("stale");
  });

  it("marks a ban distinctly from a plain incident", () => {
    expect(describeEvent({ kind: "banned", seller: "enma", payer: "0xPayer" }).tone).toBe("banned");
    expect(describeEvent({ kind: "incident", seller: "enma", payer: "0xPayer", amount: "10000" }).tone).toBe(
      "fail",
    );
  });

  it("carries the tx hash through for claimed/revoked events", () => {
    const claimed = describeEvent({ kind: "claimed", seller: "enma", payer: "0xP", amount: "10000", txHash: "0xabc" });
    expect(claimed.txHash).toBe("0xabc");
  });
});

describe("basescanLink", () => {
  it("builds a Base Sepolia explorer link from a tx hash", () => {
    const hash = "0x" + "deadbeef".repeat(8);
    expect(basescanLink(hash)).toBe(`https://sepolia.basescan.org/tx/${hash}`);
  });

  it("returns undefined when there's no hash yet", () => {
    expect(basescanLink(undefined)).toBeUndefined();
  });

  it("rejects a tx hash that isn't clean hex — the dashboard drops this straight into an href with no further escaping, so a value like a fake tx hash containing an HTML attribute break-out must never reach the DOM", () => {
    expect(basescanLink('0xabc" onmouseover="alert(1)')).toBeUndefined();
    expect(basescanLink("<script>alert(1)</script>")).toBeUndefined();
    expect(basescanLink("javascript:alert(1)")).toBeUndefined();
  });

  it("accepts real-shaped tx hashes (0x + 64 hex chars)", () => {
    const real = "0x" + "a".repeat(64);
    expect(basescanLink(real)).toBe(`https://sepolia.basescan.org/tx/${real}`);
  });
});

describe("short / usd formatting", () => {
  it("truncates a long address to a readable short form", () => {
    expect(short("0x1234567890abcdef1234567890abcdef12345678")).toBe("0x1234…5678");
  });

  it("formats atomic USDC (6 decimals) as dollars", () => {
    expect(usd("10000")).toBe("$0.01");
    expect(usd("1000000")).toBe("$1.00");
  });
});

describe("counters reducer", () => {
  it("accumulates claimed and refused amounts separately", () => {
    let state = initialCounters();
    state = reduceCounters(state, { kind: "claimed", seller: "enma", payer: "0xP", amount: "10000" });
    state = reduceCounters(state, { kind: "claimed", seller: "enma", payer: "0xP", amount: "20000" });
    state = reduceCounters(state, { kind: "incident", seller: "enma", payer: "0xQ", amount: "30000" });
    const formatted = formatCounters(state);
    expect(formatted.claimed).toBe("$0.03");
    expect(formatted.refused).toBe("$0.03");
  });

  it("tracks QA pass rate across verdicts", () => {
    let state = initialCounters();
    state = reduceCounters(state, { kind: "qa_verdict", seller: "enma", asset: "AAPL", ok: true });
    state = reduceCounters(state, { kind: "qa_verdict", seller: "enma", asset: "AAPL", ok: true });
    state = reduceCounters(state, { kind: "qa_verdict", seller: "enma", asset: "AAPL", ok: false });
    expect(formatCounters(state).qaRate).toBe("67%");
  });

  it("shows an em dash for QA rate before any verdict has arrived", () => {
    expect(formatCounters(initialCounters()).qaRate).toBe("—");
  });

  it("counts bans", () => {
    let state = initialCounters();
    state = reduceCounters(state, { kind: "banned", seller: "enma", payer: "0xCheat" });
    expect(formatCounters(state).bans).toBe("1");
  });
});
