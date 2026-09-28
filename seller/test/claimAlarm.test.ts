import { describe, it, expect, vi } from "vitest";
import { env, runInDurableObject } from "cloudflare:test";
import { SellerDO } from "../src/sellerDO";

const PAYER = "0xPayer" as const;

function claimableVoucher(overrides: { payer?: string; salt?: string; totalClaimed?: string } = {}) {
  return {
    voucher: {
      channel: {
        payer: overrides.payer ?? PAYER,
        payerAuthorizer: "0x0000000000000000000000000000000000000000",
        receiver: "0xReceiver",
        receiverAuthorizer: "0xAuthorizer",
        token: "0xToken",
        withdrawDelay: 900,
        salt: overrides.salt ?? "0xsalt1",
      },
      maxClaimableAmount: "10000",
    },
    signature: "0xsig",
    totalClaimed: overrides.totalClaimed ?? "10000",
  };
}

describe("SellerDO claim alarm", () => {
  it("claims one voucher at a time via selectClaimChannels, never bundling", async () => {
    const id = env.SELLER_DO.newUniqueId();
    const stub = env.SELLER_DO.get(id);

    await runInDurableObject(stub, async (instance: SellerDO) => {
      const voucher = claimableVoucher();
      vi.spyOn(instance.channelManager, "getClaimableVouchers").mockResolvedValue([voucher]);
      const claimSpy = vi.spyOn(instance.channelManager, "claim").mockResolvedValue([]);
      vi.spyOn(instance.channelManager, "settle").mockResolvedValue({ transaction: "0xsettle" });

      await instance.alarm();

      expect(claimSpy).toHaveBeenCalledWith(expect.objectContaining({ maxClaimsPerBatch: 1 }));
    });
  });

  it("reschedules the next alarm even when a claim fails", async () => {
    const id = env.SELLER_DO.newUniqueId();
    const stub = env.SELLER_DO.get(id);

    await runInDurableObject(stub, async (instance: SellerDO, state: DurableObjectState) => {
      vi.spyOn(instance.channelManager, "getClaimableVouchers").mockResolvedValue([claimableVoucher()]);
      vi.spyOn(instance.channelManager, "claim").mockRejectedValue(new Error("Claim failed: reverted"));
      const setAlarmSpy = vi.spyOn(state.storage, "setAlarm");

      await instance.alarm();

      expect(setAlarmSpy).toHaveBeenCalled();
    });
  });

  it("reschedules the next alarm when there is nothing to claim", async () => {
    const id = env.SELLER_DO.newUniqueId();
    const stub = env.SELLER_DO.get(id);

    await runInDurableObject(stub, async (instance: SellerDO, state: DurableObjectState) => {
      vi.spyOn(instance.channelManager, "getClaimableVouchers").mockResolvedValue([]);
      const setAlarmSpy = vi.spyOn(state.storage, "setAlarm");

      await instance.alarm();

      expect(setAlarmSpy).toHaveBeenCalled();
    });
  });

  it("a failed claim (e.g. a revoked voucher) records an incident against that payer", async () => {
    const id = env.SELLER_DO.newUniqueId();
    const stub = env.SELLER_DO.get(id);

    await runInDurableObject(stub, async (instance: SellerDO) => {
      const voucher = claimableVoucher({ payer: PAYER, totalClaimed: "10000" });
      vi.spyOn(instance.channelManager, "getClaimableVouchers").mockResolvedValue([voucher]);
      vi.spyOn(instance.channelManager, "claim").mockRejectedValue(new Error("Claim failed: reverted"));
      const recordIncidentSpy = vi.spyOn(instance.ledger, "recordIncident");

      await instance.alarm();

      expect(recordIncidentSpy).toHaveBeenCalledWith(PAYER, "10000");
    });
  });

  it("a successful claim never records an incident, and settles once", async () => {
    const id = env.SELLER_DO.newUniqueId();
    const stub = env.SELLER_DO.get(id);

    await runInDurableObject(stub, async (instance: SellerDO) => {
      vi.spyOn(instance.channelManager, "getClaimableVouchers").mockResolvedValue([claimableVoucher()]);
      vi.spyOn(instance.channelManager, "claim").mockResolvedValue([]);
      const settleSpy = vi.spyOn(instance.channelManager, "settle").mockResolvedValue({ transaction: "0xsettle" });
      const recordIncidentSpy = vi.spyOn(instance.ledger, "recordIncident");

      await instance.alarm();

      expect(recordIncidentSpy).not.toHaveBeenCalled();
      expect(settleSpy).toHaveBeenCalledTimes(1);
    });
  });

  it("one failed claim among several doesn't block the others from claiming", async () => {
    const id = env.SELLER_DO.newUniqueId();
    const stub = env.SELLER_DO.get(id);

    await runInDurableObject(stub, async (instance: SellerDO) => {
      const good = claimableVoucher({ payer: "0xGoodPayer", salt: "0xsaltGood" });
      const bad = claimableVoucher({ payer: "0xBadPayer", salt: "0xsaltBad" });
      vi.spyOn(instance.channelManager, "getClaimableVouchers").mockResolvedValue([bad, good]);
      const claimSpy = vi
        .spyOn(instance.channelManager, "claim")
        .mockImplementation(async (opts?: { selectClaimChannels?: (channels: unknown[]) => unknown[] }) => {
          const selected = opts?.selectClaimChannels?.([
            { channelConfig: bad.voucher.channel },
            { channelConfig: good.voucher.channel },
          ]) as { channelConfig: { salt: string } }[] | undefined;
          if (selected?.[0]?.channelConfig.salt === "0xsaltBad") {
            throw new Error("Claim failed: reverted");
          }
          return [];
        });
      vi.spyOn(instance.channelManager, "settle").mockResolvedValue({ transaction: "0xsettle" });
      const recordIncidentSpy = vi.spyOn(instance.ledger, "recordIncident");

      await instance.alarm();

      expect(claimSpy).toHaveBeenCalledTimes(2);
      expect(recordIncidentSpy).toHaveBeenCalledWith("0xBadPayer", "10000");
      expect(recordIncidentSpy).not.toHaveBeenCalledWith("0xGoodPayer", "10000");
    });
  });

  it("3 failed claims for the SAME payer in one alarm cycle accumulate to incidentCount=3, not 1", async () => {
    // Regression check for a live-only discrepancy found during Phase 6 rehearsal:
    // 3 real revoked vouchers for the same payer, all failing in the same real
    // wrangler dev alarm cycle, only left incidentCount=1 in the DO's persisted
    // SQLite ledger — despite recordIncident being awaited sequentially 3 times, and
    // despite doLedgerStorage.test.ts already proving 2 sequential calls DO
    // accumulate correctly when invoked directly (not through alarm()'s claim loop).
    const id = env.SELLER_DO.newUniqueId();
    const stub = env.SELLER_DO.get(id);

    await runInDurableObject(stub, async (instance: SellerDO) => {
      const vouchers = [
        claimableVoucher({ payer: PAYER, salt: "0xsaltA", totalClaimed: "10000" }),
        claimableVoucher({ payer: PAYER, salt: "0xsaltB", totalClaimed: "10000" }),
        claimableVoucher({ payer: PAYER, salt: "0xsaltC", totalClaimed: "10000" }),
      ];
      vi.spyOn(instance.channelManager, "getClaimableVouchers").mockResolvedValue(vouchers);
      vi.spyOn(instance.channelManager, "claim").mockRejectedValue(new Error("Claim failed: reverted"));

      await instance.alarm();

      // isBanned() needs servedValue on record to say anything (its own guard
      // against a divide-by-zero-shaped ratio), so provide it after the fact purely
      // to make the accumulated incidentValue observable: 3 incidents x 10000 = 30000.
      // If incidentCount/incidentValue were actually stuck at 1 (10000) rather than
      // genuinely 3 (30000), a 40000 servedValue would land at a 25% ratio — below
      // the 50% ban threshold — instead of the correct 75%.
      await instance.ledger.recordServed(PAYER, "40000");
      expect(await instance.ledger.isBanned(PAYER)).toBe(true);
    });
  });

  it("notifies the narrator of a claim failure/incident", async () => {
    const id = env.SELLER_DO.newUniqueId();
    const stub = env.SELLER_DO.get(id);

    await runInDurableObject(stub, async (instance: SellerDO) => {
      const voucher = claimableVoucher({ payer: PAYER, totalClaimed: "10000" });
      vi.spyOn(instance.channelManager, "getClaimableVouchers").mockResolvedValue([voucher]);
      vi.spyOn(instance.channelManager, "claim").mockRejectedValue(new Error("Claim failed: reverted"));
      const notifySpy = vi.spyOn(instance.narrator, "notify").mockResolvedValue(undefined);

      await instance.alarm();

      expect(notifySpy).toHaveBeenCalledWith({ kind: "incident", payer: PAYER, amount: "10000" });
    });
  });

  it("notifies the narrator of a ban only on the transition into banned, not every incident", async () => {
    const id = env.SELLER_DO.newUniqueId();
    const stub = env.SELLER_DO.get(id);

    await runInDurableObject(stub, async (instance: SellerDO) => {
      const notifySpy = vi.spyOn(instance.narrator, "notify").mockResolvedValue(undefined);
      vi.spyOn(instance.channelManager, "claim").mockRejectedValue(new Error("Claim failed: reverted"));

      // First incident: served once, so ratio is 100% but incidentCount < MIN_INCIDENTS_TO_BAN (2) — not banned yet.
      await instance.ledger.recordServed(PAYER, "10000");
      vi.spyOn(instance.channelManager, "getClaimableVouchers").mockResolvedValueOnce([
        claimableVoucher({ payer: PAYER, totalClaimed: "10000" }),
      ]);
      await instance.alarm();
      expect(notifySpy).not.toHaveBeenCalledWith({ kind: "banned", payer: PAYER });

      // Second incident crosses MIN_INCIDENTS_TO_BAN with ratio still >= 50% — this is the transition.
      await instance.ledger.recordServed(PAYER, "10000");
      vi.spyOn(instance.channelManager, "getClaimableVouchers").mockResolvedValueOnce([
        claimableVoucher({ payer: PAYER, totalClaimed: "10000", salt: "0xsalt2" }),
      ]);
      await instance.alarm();
      expect(notifySpy).toHaveBeenCalledWith({ kind: "banned", payer: PAYER });
    });
  });

  it("notifies the narrator of a successful claim", async () => {
    const id = env.SELLER_DO.newUniqueId();
    const stub = env.SELLER_DO.get(id);

    await runInDurableObject(stub, async (instance: SellerDO) => {
      vi.spyOn(instance.channelManager, "getClaimableVouchers").mockResolvedValue([
        claimableVoucher({ payer: PAYER, totalClaimed: "10000" }),
      ]);
      vi.spyOn(instance.channelManager, "claim").mockResolvedValue([]);
      vi.spyOn(instance.channelManager, "settle").mockResolvedValue({ transaction: "0xsettle" });
      const notifySpy = vi.spyOn(instance.narrator, "notify").mockResolvedValue(undefined);

      await instance.alarm();

      expect(notifySpy).toHaveBeenCalledWith({ kind: "claimed", payer: PAYER, amount: "10000" });
    });
  });
});
