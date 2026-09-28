import { describe, it, expect } from "vitest";
import { env, runInDurableObject } from "cloudflare:test";
import type { SellerDO } from "../src/sellerDO";

const PAYER = "0xAdminTestPayer";

describe("POST /admin/reset-ledger", () => {
  it("rejects a request with the wrong token", async () => {
    const id = env.SELLER_DO.newUniqueId();
    const stub = env.SELLER_DO.get(id);

    const res = await stub.fetch("https://do/admin/reset-ledger", {
      method: "POST",
      headers: { "Content-Type": "application/json", authorization: "Bearer wrong-token" },
      body: JSON.stringify({ payer: PAYER }),
    });
    expect(res.status).toBe(401);
  });

  it("rejects a request with no Authorization header at all", async () => {
    const id = env.SELLER_DO.newUniqueId();
    const stub = env.SELLER_DO.get(id);

    const res = await stub.fetch("https://do/admin/reset-ledger", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ payer: PAYER }),
    });
    expect(res.status).toBe(401);
  });

  it("rejects a request with no payer in the body", async () => {
    const id = env.SELLER_DO.newUniqueId();
    const stub = env.SELLER_DO.get(id);

    const res = await stub.fetch("https://do/admin/reset-ledger", {
      method: "POST",
      headers: { "Content-Type": "application/json", authorization: `Bearer ${env.ADMIN_TOKEN}` },
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(400);
  });

  it("with a valid token, actually un-bans a payer through the real ledger", async () => {
    const id = env.SELLER_DO.newUniqueId();
    const stub = env.SELLER_DO.get(id);

    await runInDurableObject(stub, async (instance: SellerDO) => {
      await instance.ledger.recordServed(PAYER, "10000");
      await instance.ledger.recordServed(PAYER, "10000");
      await instance.ledger.recordIncident(PAYER, "10000");
      await instance.ledger.recordIncident(PAYER, "10000");
      expect(await instance.ledger.isBanned(PAYER)).toBe(true);
    });

    const res = await stub.fetch("https://do/admin/reset-ledger", {
      method: "POST",
      headers: { "Content-Type": "application/json", authorization: `Bearer ${env.ADMIN_TOKEN}` },
      body: JSON.stringify({ payer: PAYER }),
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });

    await runInDurableObject(stub, async (instance: SellerDO) => {
      expect(await instance.ledger.isBanned(PAYER)).toBe(false);
    });
  });
});
