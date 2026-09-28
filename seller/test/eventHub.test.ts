import { describe, it, expect } from "vitest";
import { env, SELF } from "cloudflare:test";

async function connect(): Promise<WebSocket> {
  const res = await SELF.fetch("https://example.com/ws", {
    headers: { Upgrade: "websocket" },
  });
  const ws = res.webSocket;
  if (!ws) throw new Error("expected a WebSocket in the 101 response");
  ws.accept();
  return ws;
}

function nextMessage(ws: WebSocket): Promise<string> {
  return new Promise((resolve) => {
    ws.addEventListener("message", (event) => resolve(event.data as string), { once: true });
  });
}

describe("EventHub", () => {
  it("rejects a non-WebSocket request with 426", async () => {
    const res = await SELF.fetch("https://example.com/ws");
    expect(res.status).toBe(426);
  });

  it("broadcasts a claimed event to a connected dashboard client", async () => {
    const ws = await connect();
    const received = nextMessage(ws);

    const hub = env.EVENT_HUB.get(env.EVENT_HUB.idFromName("global"));
    await hub.broadcast({ kind: "claimed", seller: "enma", payer: "0xPayer", amount: "10000" });

    const message = JSON.parse(await received);
    expect(message).toEqual({ kind: "claimed", seller: "enma", payer: "0xPayer", amount: "10000" });
    ws.close();
  });

  it("fans one event out to every connected client", async () => {
    const wsA = await connect();
    const wsB = await connect();
    const receivedA = nextMessage(wsA);
    const receivedB = nextMessage(wsB);

    const hub = env.EVENT_HUB.get(env.EVENT_HUB.idFromName("global"));
    await hub.broadcast({ kind: "banned", seller: "rogue", payer: "0xCheat" });

    expect(JSON.parse(await receivedA)).toEqual({ kind: "banned", seller: "rogue", payer: "0xCheat" });
    expect(JSON.parse(await receivedB)).toEqual({ kind: "banned", seller: "rogue", payer: "0xCheat" });
    wsA.close();
    wsB.close();
  });

  it("drops a malformed event without throwing across the RPC boundary", async () => {
    const hub = env.EVENT_HUB.get(env.EVENT_HUB.idFromName("global"));
    await expect(hub.broadcast({ kind: "not_a_real_kind" } as never)).resolves.toBeUndefined();
  });

  it("never delivers a dropped malformed event to a connected client", async () => {
    const ws = await connect();
    let received: string | undefined;
    ws.addEventListener("message", (event) => {
      received = event.data as string;
    });

    const hub = env.EVENT_HUB.get(env.EVENT_HUB.idFromName("global"));
    await hub.broadcast({ kind: "not_a_real_kind" } as never);
    await hub.broadcast({ kind: "banned", seller: "enma", payer: "0xPayer" });
    await new Promise((resolve) => setTimeout(resolve, 50));

    expect(received).toBe(JSON.stringify({ kind: "banned", seller: "enma", payer: "0xPayer" }));
    ws.close();
  });
});
