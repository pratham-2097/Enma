import { describe, it, expect } from "vitest";
import { decodeAbiParameters, recoverAddress, hashTypedData, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { createGuardSigner, GuardSignerError } from "../src/guardSigner";

const AGENT_KEY = "0xa1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1" as Hex;
const GUARD_ADDRESS = "0x11A05D6647AfB21d8C55a7729827546902259c47" as const;

const DOMAIN = {
  name: "BatchSettlement",
  version: "1",
  chainId: 84532,
  verifyingContract: "0x4020074e9dF2ce1deE5A9C1b5c3f541D02a10003",
} as const;

const VOUCHER_TYPES = {
  Voucher: [
    { name: "channelId", type: "bytes32" },
    { name: "maxClaimableAmount", type: "uint128" },
  ],
} as const;

describe("createGuardSigner", () => {
  it("exposes EnmaGuard's own address, not the agent's", () => {
    const signer = createGuardSigner({ guardAddress: GUARD_ADDRESS, agentPrivateKey: AGENT_KEY });
    expect(signer.address).toBe(GUARD_ADDRESS);
  });

  it("signTypedData on a Voucher request returns abi.encode(agentSig, channelId, maxClaimable)", async () => {
    const signer = createGuardSigner({ guardAddress: GUARD_ADDRESS, agentPrivateKey: AGENT_KEY });
    const channelId = ("0x" + "ab".repeat(32)) as Hex;
    const maxClaimableAmount = 10_000n;

    const blob = await signer.signTypedData({
      domain: DOMAIN,
      types: VOUCHER_TYPES,
      primaryType: "Voucher",
      message: { channelId, maxClaimableAmount },
    });

    const [agentSig, decodedChannelId, decodedAmount] = decodeAbiParameters(
      [{ type: "bytes" }, { type: "bytes32" }, { type: "uint128" }],
      blob,
    );

    expect(decodedChannelId).toBe(channelId);
    expect(decodedAmount).toBe(maxClaimableAmount);
    expect((agentSig as string).length).toBe(2 + 65 * 2); // 65-byte raw ECDSA sig

    // the recovered signer must be the agent, over the SAME digest a verifier
    // (the facilitator or EnmaGuard itself) would independently recompute
    const expectedDigest = hashTypedData({
      domain: DOMAIN,
      types: VOUCHER_TYPES,
      primaryType: "Voucher",
      message: { channelId, maxClaimableAmount },
    });
    const recovered = await recoverAddress({ hash: expectedDigest, signature: agentSig as Hex });
    const agent = privateKeyToAccount(AGENT_KEY);
    expect(recovered.toLowerCase()).toBe(agent.address.toLowerCase());
  });

  it("throws GuardSignerError on any non-Voucher signing request", async () => {
    const signer = createGuardSigner({ guardAddress: GUARD_ADDRESS, agentPrivateKey: AGENT_KEY });

    await expect(
      signer.signTypedData({
        domain: DOMAIN,
        types: { Deposit: [{ name: "amount", type: "uint256" }] },
        primaryType: "Deposit",
        message: { amount: 5_000_000n },
      }),
    ).rejects.toThrow(GuardSignerError);
  });

  it("throws on a Voucher-typed request missing channelId or maxClaimableAmount", async () => {
    const signer = createGuardSigner({ guardAddress: GUARD_ADDRESS, agentPrivateKey: AGENT_KEY });

    await expect(
      signer.signTypedData({
        domain: DOMAIN,
        types: VOUCHER_TYPES,
        primaryType: "Voucher",
        message: {},
      }),
    ).rejects.toThrow(GuardSignerError);
  });
});
