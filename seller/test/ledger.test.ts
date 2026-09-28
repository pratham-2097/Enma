import { describe, it, expect } from "vitest";
import { Ledger, type LedgerStorage } from "../src/ledger";

function inMemoryStorage(): LedgerStorage {
  const data = new Map<string, unknown>();
  return {
    async get(key) {
      return data.get(key) as never;
    },
    async put(key, value) {
      data.set(key, value);
    },
    async delete(key) {
      data.delete(key);
    },
  };
}

const PAYER = "0xPayer";

describe("Ledger", () => {
  it("a payer with no history is not banned", async () => {
    const ledger = new Ledger(inMemoryStorage());
    expect(await ledger.isBanned(PAYER)).toBe(false);
  });

  it("one honest QA miss (a single incident) never bans, regardless of ratio", async () => {
    const ledger = new Ledger(inMemoryStorage());
    await ledger.recordServed(PAYER, "10000");
    await ledger.recordIncident(PAYER, "10000"); // 1 incident, ratio 100%
    expect(await ledger.isBanned(PAYER)).toBe(false);
  });

  it("2+ incidents with <50% unclaimable is not banned", async () => {
    const ledger = new Ledger(inMemoryStorage());
    // 4 served calls, 2 revoked (2 incidents) -> revoked-value ratio 50%... use unequal amounts
    // to keep this under 50%: 3 served at 10000 each (30000 total), 2 incidents worth 10000 (33%)
    await ledger.recordServed(PAYER, "10000");
    await ledger.recordServed(PAYER, "10000");
    await ledger.recordServed(PAYER, "10000");
    await ledger.recordIncident(PAYER, "5000");
    await ledger.recordIncident(PAYER, "5000");
    expect(await ledger.isBanned(PAYER)).toBe(false);
  });

  it("2+ incidents AND >=50% unclaimable value bans the payer", async () => {
    const ledger = new Ledger(inMemoryStorage());
    await ledger.recordServed(PAYER, "10000");
    await ledger.recordServed(PAYER, "10000");
    await ledger.recordIncident(PAYER, "10000");
    await ledger.recordIncident(PAYER, "10000");
    expect(await ledger.isBanned(PAYER)).toBe(true);
  });

  it("the cheat scenario: 3 good responses all revoked bans the payer (3 incidents, 100% unclaimable)", async () => {
    const ledger = new Ledger(inMemoryStorage());
    await ledger.recordServed(PAYER, "10000");
    await ledger.recordIncident(PAYER, "10000");
    await ledger.recordServed(PAYER, "10000");
    await ledger.recordIncident(PAYER, "10000");
    await ledger.recordServed(PAYER, "10000");
    await ledger.recordIncident(PAYER, "10000");
    expect(await ledger.isBanned(PAYER)).toBe(true);
  });

  it("bans are keyed per payer address, never shared across payers", async () => {
    const ledger = new Ledger(inMemoryStorage());
    const other = "0xOtherPayer";
    await ledger.recordServed(PAYER, "10000");
    await ledger.recordServed(PAYER, "10000");
    await ledger.recordIncident(PAYER, "10000");
    await ledger.recordIncident(PAYER, "10000");
    expect(await ledger.isBanned(PAYER)).toBe(true);
    expect(await ledger.isBanned(other)).toBe(false);
  });

  it("reset() clears a payer's history, un-banning them", async () => {
    const ledger = new Ledger(inMemoryStorage());
    await ledger.recordServed(PAYER, "10000");
    await ledger.recordServed(PAYER, "10000");
    await ledger.recordIncident(PAYER, "10000");
    await ledger.recordIncident(PAYER, "10000");
    expect(await ledger.isBanned(PAYER)).toBe(true);

    await ledger.reset(PAYER);

    expect(await ledger.isBanned(PAYER)).toBe(false);
  });

  it("reset() only clears the given payer, not others", async () => {
    const ledger = new Ledger(inMemoryStorage());
    const other = "0xOtherPayer";
    await ledger.recordServed(PAYER, "10000");
    await ledger.recordServed(PAYER, "10000");
    await ledger.recordIncident(PAYER, "10000");
    await ledger.recordIncident(PAYER, "10000");
    await ledger.recordServed(other, "10000");
    await ledger.recordServed(other, "10000");
    await ledger.recordIncident(other, "10000");
    await ledger.recordIncident(other, "10000");

    await ledger.reset(PAYER);

    expect(await ledger.isBanned(PAYER)).toBe(false);
    expect(await ledger.isBanned(other)).toBe(true);
  });

  it("reset() on a payer with no history is a harmless no-op", async () => {
    const ledger = new Ledger(inMemoryStorage());
    await expect(ledger.reset("0xNeverSeen")).resolves.toBeUndefined();
  });
});
