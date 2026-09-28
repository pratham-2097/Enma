import { describe, it, expect } from "vitest";
import { env, runInDurableObject } from "cloudflare:test";
import type { Channel } from "@x402/evm/batch-settlement/server";
import { SellerDO } from "../src/sellerDO";

function sampleChannel(overrides: Partial<Channel> = {}): Channel {
  return {
    channelId: "0xabc",
    channelConfig: {
      payer: "0x1111111111111111111111111111111111111111" as `0x${string}`,
      payerAuthorizer: "0x0000000000000000000000000000000000000000" as `0x${string}`,
      receiver: "0x2222222222222222222222222222222222222222" as `0x${string}`,
      receiverAuthorizer: "0x3333333333333333333333333333333333333333" as `0x${string}`,
      token: "0x036CbD53842c5426634e7929541eC2318f3dCF7e" as `0x${string}`,
      withdrawDelay: 900,
      salt: "0x0000000000000000000000000000000000000000000000000000000000000001" as `0x${string}`,
    },
    chargedCumulativeAmount: "0",
    signedMaxClaimable: "0",
    signature: "0x",
    balance: "100000",
    totalClaimed: "0",
    withdrawRequestedAt: 0,
    refundNonce: 0,
    lastRequestTimestamp: Date.now(),
    ...overrides,
  };
}

async function freshStub() {
  const id = env.SELLER_DO.newUniqueId();
  return env.SELLER_DO.get(id);
}

describe("DoChannelStorage", () => {
  it("returns undefined for a channel that was never stored", async () => {
    const stub = await freshStub();
    await runInDurableObject(stub, async (instance: SellerDO) => {
      const got = await instance.channelStorage.get("does-not-exist");
      expect(got).toBeUndefined();
    });
  });

  it("stores and retrieves a channel round-trip", async () => {
    const stub = await freshStub();
    const channel = sampleChannel();
    await runInDurableObject(stub, async (instance: SellerDO) => {
      await instance.channelStorage.updateChannel(channel.channelId, () => channel);
      const got = await instance.channelStorage.get(channel.channelId);
      expect(got).toEqual(channel);
    });
  });

  it("list() returns every stored channel", async () => {
    const stub = await freshStub();
    const a = sampleChannel({ channelId: "0xa" });
    const b = sampleChannel({ channelId: "0xb" });
    await runInDurableObject(stub, async (instance: SellerDO) => {
      await instance.channelStorage.updateChannel(a.channelId, () => a);
      await instance.channelStorage.updateChannel(b.channelId, () => b);
      const all = await instance.channelStorage.list();
      expect(all.map((c) => c.channelId).sort()).toEqual(["0xa", "0xb"]);
    });
  });

  it("updateChannel(id, () => undefined) deletes the record", async () => {
    const stub = await freshStub();
    const channel = sampleChannel();
    await runInDurableObject(stub, async (instance: SellerDO) => {
      await instance.channelStorage.updateChannel(channel.channelId, () => channel);
      const result = await instance.channelStorage.updateChannel(channel.channelId, () => undefined);
      expect(result.status).toBe("deleted");
      const got = await instance.channelStorage.get(channel.channelId);
      expect(got).toBeUndefined();
    });
  });

  it("updateChannel reports 'unchanged' when the callback returns the same record", async () => {
    const stub = await freshStub();
    const channel = sampleChannel();
    await runInDurableObject(stub, async (instance: SellerDO) => {
      await instance.channelStorage.updateChannel(channel.channelId, () => channel);
      const result = await instance.channelStorage.updateChannel(channel.channelId, (current) => current);
      expect(result.status).toBe("unchanged");
    });
  });

  it("concurrent updateChannel calls on the same channel never corrupt each other", async () => {
    const stub = await freshStub();
    const channel = sampleChannel({ chargedCumulativeAmount: "0" });
    await runInDurableObject(stub, async (instance: SellerDO) => {
      await instance.channelStorage.updateChannel(channel.channelId, () => channel);

      // Fire 20 concurrent increments of chargedCumulativeAmount by 1 each.
      // A racy read-modify-write would lose updates; atomic ones must land all 20.
      const increments = Array.from({ length: 20 }, () =>
        instance.channelStorage.updateChannel(channel.channelId, (current) => {
          if (!current) return current;
          return {
            ...current,
            chargedCumulativeAmount: String(Number(current.chargedCumulativeAmount) + 1),
          };
        }),
      );
      await Promise.all(increments);

      const final = await instance.channelStorage.get(channel.channelId);
      expect(final?.chargedCumulativeAmount).toBe("20");
    });
  });
});
