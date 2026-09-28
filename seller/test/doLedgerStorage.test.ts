import { describe, it, expect } from "vitest";
import { env, runInDurableObject } from "cloudflare:test";
import { Ledger } from "../src/ledger";
import { SellerDO } from "../src/sellerDO";

async function freshStub() {
  const id = env.SELLER_DO.newUniqueId();
  return env.SELLER_DO.get(id);
}

describe("DoLedgerStorage (via SellerDO.ledger)", () => {
  it("persists incidents so a payer can be banned through the DO's own storage", async () => {
    const stub = await freshStub();
    await runInDurableObject(stub, async (instance: SellerDO) => {
      const ledger = instance.ledger;
      expect(ledger).toBeInstanceOf(Ledger);

      await ledger.recordServed("0xPayer", "10000");
      await ledger.recordServed("0xPayer", "10000");
      await ledger.recordIncident("0xPayer", "10000");
      await ledger.recordIncident("0xPayer", "10000");

      expect(await ledger.isBanned("0xPayer")).toBe(true);
    });
  });

  it("reset() clears a payer's ban through the DO's own storage", async () => {
    const stub = await freshStub();
    await runInDurableObject(stub, async (instance: SellerDO) => {
      const ledger = instance.ledger;

      await ledger.recordServed("0xPayer", "10000");
      await ledger.recordServed("0xPayer", "10000");
      await ledger.recordIncident("0xPayer", "10000");
      await ledger.recordIncident("0xPayer", "10000");
      expect(await ledger.isBanned("0xPayer")).toBe(true);

      await ledger.reset("0xPayer");

      expect(await ledger.isBanned("0xPayer")).toBe(false);
    });
  });
});
