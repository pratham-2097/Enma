import { describe, it, expect, vi } from "vitest";
import { reportEvent } from "../src/reportEvent";

describe("reportEvent", () => {
  it("POSTs the event to <sellerUrl>/v1/events as JSON", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(new Response("{}", { status: 200 }));

    await reportEvent(
      "http://localhost:8787",
      { kind: "qa_verdict", seller: "0xSeller", asset: "AAPL", ok: true },
      fetchImpl,
    );

    expect(fetchImpl).toHaveBeenCalledWith(
      "http://localhost:8787/v1/events",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({ "Content-Type": "application/json" }),
        body: JSON.stringify({ kind: "qa_verdict", seller: "0xSeller", asset: "AAPL", ok: true }),
      }),
    );
  });

  it("never throws when the POST fails — a dashboard outage must not affect the buyer's own flow", async () => {
    const fetchImpl = vi.fn().mockRejectedValue(new Error("network down"));

    await expect(
      reportEvent("http://localhost:8787", { kind: "revoked", seller: "0xSeller", payer: "0xPayer" }, fetchImpl),
    ).resolves.toBeUndefined();
  });

  it("never throws when the seller responds with a non-2xx status", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(new Response("nope", { status: 500 }));

    await expect(
      reportEvent("http://localhost:8787", { kind: "revoked", seller: "0xSeller", payer: "0xPayer" }, fetchImpl),
    ).resolves.toBeUndefined();
  });
});
