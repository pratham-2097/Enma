import { describe, it, expect } from "vitest";
import { channelConfigFrom402 } from "../src/openTab";

describe("channelConfigFrom402", () => {
  it("builds a ChannelConfig from the seller's own advertised 402 terms, never hard-coded", () => {
    const cfg = channelConfigFrom402({
      guardAddress: "0x11A05D6647AfB21d8C55a7729827546902259c47",
      token: "0x036CbD53842c5426634e7929541eC2318f3dCF7e",
      accepted: {
        payTo: "0xcA084D29c42d83ad50D58f9E96Bf4b11931E4e9F",
        extra: {
          receiverAuthorizer: "0x752a4a376F5D21aE7a68bbcBa0D54D7b10567E51",
          withdrawDelay: 900,
        },
      },
      salt: "0x0000000000000000000000000000000000000000000000000000000000000001",
    });

    expect(cfg.payer).toBe("0x11A05D6647AfB21d8C55a7729827546902259c47");
    expect(cfg.payerAuthorizer).toBe("0x0000000000000000000000000000000000000000");
    expect(cfg.receiver).toBe("0xcA084D29c42d83ad50D58f9E96Bf4b11931E4e9F");
    expect(cfg.receiverAuthorizer).toBe("0x752a4a376F5D21aE7a68bbcBa0D54D7b10567E51");
    expect(cfg.withdrawDelay).toBe(900);
  });
});
