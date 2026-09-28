import { describe, it, expect, vi } from "vitest";
import { Narrator, formatNarratorMessage } from "../src/narrator";

const WEBHOOK_URL = "https://hooks.slack.com/services/T000/B000/xxxxxxxxxxxx";

function fakeFetch(status = 200, body = "ok") {
  return vi.fn().mockResolvedValue(new Response(body, { status }));
}

describe("formatNarratorMessage", () => {
  it("formats a revoke/incident event as a plain-English sentence", () => {
    const text = formatNarratorMessage({
      kind: "incident",
      payer: "0xPayer",
      amount: "10000",
    });
    expect(text).toContain("0xPayer");
    expect(text.toLowerCase()).toContain("revoke");
  });

  it("formats a ban event as a plain-English sentence", () => {
    const text = formatNarratorMessage({ kind: "banned", payer: "0xPayer" });
    expect(text).toContain("0xPayer");
    expect(text.toLowerCase()).toContain("banned");
  });

  it("formats a successful claim/settle event as a plain-English sentence", () => {
    const text = formatNarratorMessage({
      kind: "claimed",
      payer: "0xPayer",
      amount: "10000",
    });
    expect(text).toContain("0xPayer");
    expect(text.toLowerCase()).toContain("claim");
  });
});

describe("Narrator", () => {
  it("POSTs the formatted message as Slack's {text} payload to the webhook URL", async () => {
    const fetchImpl = fakeFetch();
    const narrator = new Narrator(WEBHOOK_URL, fetchImpl);

    await narrator.notify({ kind: "banned", payer: "0xPayer" });

    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const [url, init] = fetchImpl.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(WEBHOOK_URL);
    const body = JSON.parse(init.body as string);
    expect(body.text).toBe(formatNarratorMessage({ kind: "banned", payer: "0xPayer" }));
  });

  it("never throws when the Slack webhook is unreachable — ops notification is best-effort", async () => {
    const fetchImpl = vi.fn().mockRejectedValue(new Error("network down"));
    const narrator = new Narrator(WEBHOOK_URL, fetchImpl);

    await expect(narrator.notify({ kind: "banned", payer: "0xPayer" })).resolves.toBeUndefined();
  });

  it("never throws when Slack returns a non-2xx status", async () => {
    const fetchImpl = fakeFetch(500, "internal_error");
    const narrator = new Narrator(WEBHOOK_URL, fetchImpl);

    await expect(narrator.notify({ kind: "banned", payer: "0xPayer" })).resolves.toBeUndefined();
  });

  it("is a no-op (never calls fetch) when not configured", async () => {
    const fetchImpl = fakeFetch();
    const narrator = new Narrator(undefined, fetchImpl);

    await narrator.notify({ kind: "banned", payer: "0xPayer" });

    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("the default fetchImpl (no explicit override, as production code uses via sellerDO.ts) is callable without a detached-`this` error", async () => {
    // Regression test: Workers' native fetch is sensitive to its receiver. Calling it
    // later as `this.fetchImpl(...)`, detached from globalThis, throws "Illegal
    // invocation" unless the constructor's default binds it up front. Every other test
    // in this file passes an explicit fetchImpl mock, so none of them would have
    // caught this — it only ever showed up live, via `new Narrator(url)` with no
    // second argument, exactly as sellerDO.ts constructs it.
    const originalFetch = globalThis.fetch;
    let sawUnboundCall = false;
    // A stand-in for a receiver-sensitive native method, same shape as the real bug:
    // throws if invoked with anything other than `globalThis` as `this`. Never calls
    // through to the real network either way — this test only checks binding.
    globalThis.fetch = function (this: unknown) {
      if (this !== globalThis) {
        sawUnboundCall = true;
        throw new TypeError("Illegal invocation");
      }
      return Promise.resolve(new Response("ok", { status: 200 }));
    } as typeof fetch;

    try {
      const narrator = new Narrator(WEBHOOK_URL);
      await expect(narrator.notify({ kind: "banned", payer: "0xPayer" })).resolves.toBeUndefined();
      expect(sawUnboundCall).toBe(false);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});
