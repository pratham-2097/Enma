import { describe, it, expect } from "vitest";
import { SELF } from "cloudflare:test";

describe("top-level Worker routing (src/index.ts)", () => {
  it("routes /healthz to the honest SellerDO", async () => {
    const res = await SELF.fetch("https://example.com/healthz");
    expect(res.status).toBe(200);
    expect(await res.text()).toBe("ok");
  });

  it("routes /rogue/healthz to the rogue SellerDO with the prefix stripped", async () => {
    const res = await SELF.fetch("https://example.com/rogue/healthz");
    expect(res.status).toBe(200);
    expect(await res.text()).toBe("ok");
  });

  it("upgrades /ws to the EventHub", async () => {
    const res = await SELF.fetch("https://example.com/ws", { headers: { Upgrade: "websocket" } });
    expect(res.webSocket).toBeTruthy();
    res.webSocket?.accept();
    res.webSocket?.close();
  });

  it("accepts a POST to /v1/events and forwards it to the EventHub", async () => {
    const res = await SELF.fetch("https://example.com/v1/events", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ kind: "qa_verdict", seller: "0xSeller", asset: "AAPL", ok: true }),
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
  });

  it("also accepts a POST to /rogue/v1/events — the buyer's sellerUrl is /rogue-prefixed when talking to the rogue seller", async () => {
    const res = await SELF.fetch("https://example.com/rogue/v1/events", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ kind: "qa_verdict", seller: "0xRogueSeller", asset: "AAPL", ok: false, reason: "junk data" }),
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
  });

  it("serves the dashboard's index.html for / from Workers Assets", async () => {
    const res = await SELF.fetch("https://example.com/");
    expect(res.status).toBe(200);
    const body = await res.text();
    expect(body).toContain("Enma");
    // Vite fingerprints its output, so assert on the built bundle's reference
    // rather than a literal filename.
    const scriptMatch = body.match(/src="(\/assets\/[^"]+\.js)"/);
    expect(scriptMatch).not.toBeNull();
  });

  it("serves the dashboard's built JS bundle from Workers Assets", async () => {
    const indexRes = await SELF.fetch("https://example.com/");
    const body = await indexRes.text();
    const [, scriptPath] = body.match(/src="(\/assets\/[^"]+\.js)"/) ?? [];
    expect(scriptPath).toBeTruthy();

    const res = await SELF.fetch(`https://example.com${scriptPath}`);
    expect(res.status).toBe(200);
  });
});
