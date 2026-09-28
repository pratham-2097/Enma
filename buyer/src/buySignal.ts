import { randomBytes } from "node:crypto";
import type { Address, Chain, Hex } from "viem";
import { signVoucher } from "@x402/evm/batch-settlement/client";
import { createGuardSigner } from "./guardSigner";
import { channelConfigFrom402, openTab, type ChannelConfig } from "./openTab";
import type { SpendLimiter } from "./spendLimit";

export interface BuySignalOptions {
  chain: Chain;
  rpcUrl: string;
  sellerUrl: string;
  asset: string;
  escrowAddress: Address;
  usdcAddress: Address;
  guardAddress: Address;
  ownerPrivateKey: Hex;
  agentPrivateKey: Hex;
  /** Skip openTab and reuse an already-open channel (avoids re-funding on every call). */
  existingChannel?: { channelId: Hex; cfg: ChannelConfig };
  tabAmount?: bigint;
  /** Optional pre-payment firewall: refuses before openTab if the seller's quote exceeds a cap. */
  spendLimiter?: SpendLimiter;
}

export class SpendLimitExceededError extends Error {}

export interface BuySignalResult {
  status: number;
  body: unknown;
  channelId: Hex;
  cfg: ChannelConfig;
  seller: Address;
}

/**
 * Timestamp plus 16 random bytes: two calls landing in the same millisecond (e.g. a
 * retry fired right after the first attempt) must never produce the same channel salt.
 */
function freshSalt(): Hex {
  const timestamp = Date.now().toString(16).padStart(16, "0"); // 8 bytes
  const random = randomBytes(24).toString("hex"); // 24 bytes, so total = 32 bytes (bytes32)
  return ("0x" + timestamp + random) as Hex;
}

/**
 * Full buyer-side purchase: read the seller's live 402 terms, open (or reuse) a tab,
 * sign a voucher with guardSigner, and fetch the paid resource. This is the one real
 * payment path every CLI mode (buy/cheat/shady) and the e2e tests build on.
 */
export async function buySignal(opts: BuySignalOptions): Promise<BuySignalResult> {
  const unpaidRes = await fetch(`${opts.sellerUrl}/v1/signal/${opts.asset}`);
  if (unpaidRes.status !== 402) {
    throw new Error(`expected 402 from seller, got ${unpaidRes.status}: ${await unpaidRes.text()}`);
  }
  const header = unpaidRes.headers.get("payment-required");
  if (!header) throw new Error("seller's 402 had no payment-required header");
  const required = JSON.parse(Buffer.from(header, "base64").toString("utf8")) as {
    accepts: { scheme: string; payTo: string; amount: string; extra: { receiverAuthorizer: string; withdrawDelay: number } }[];
  };
  const accepted = required.accepts.find((a) => a.scheme === "batch-settlement");
  if (!accepted) throw new Error("seller did not offer batch-settlement");

  if (opts.spendLimiter) {
    const verdict = opts.spendLimiter.check(accepted.payTo, BigInt(accepted.amount));
    if (!verdict.allowed) {
      throw new SpendLimitExceededError(`refused before opening a channel: ${verdict.reason}`);
    }
  }

  let channelId: Hex;
  let cfg: ChannelConfig;
  const freshlyOpened = !opts.existingChannel;
  if (opts.existingChannel) {
    ({ channelId, cfg } = opts.existingChannel);
  } else {
    cfg = channelConfigFrom402({
      guardAddress: opts.guardAddress,
      token: opts.usdcAddress,
      accepted,
      salt: freshSalt(),
    });
    channelId = await openTab({
      chain: opts.chain,
      rpcUrl: opts.rpcUrl,
      escrowAddress: opts.escrowAddress,
      guardAddress: opts.guardAddress,
      ownerPrivateKey: opts.ownerPrivateKey,
      cfg,
      amount: opts.tabAmount ?? 50_000n,
    });
  }

  const guardSigner = createGuardSigner({ guardAddress: opts.guardAddress, agentPrivateKey: opts.agentPrivateKey });
  const claimAmount = "10000"; // one call's worth, $0.01 at 6 decimals
  const voucher = await signVoucher(guardSigner, channelId, claimAmount, "eip155:84532");

  const paymentPayload = {
    x402Version: 2,
    accepted,
    payload: { type: "voucher", channelConfig: cfg, voucher },
  };
  const paymentHeader = Buffer.from(JSON.stringify(paymentPayload)).toString("base64");

  const { status, body } = await fetchWithSettleRetry(
    `${opts.sellerUrl}/v1/signal/${opts.asset}`,
    { headers: { "payment-signature": paymentHeader } },
    freshlyOpened,
  );

  if (opts.spendLimiter && status === 200) {
    opts.spendLimiter.record(accepted.payTo, BigInt(accepted.amount));
  }

  return { status, body, channelId, cfg, seller: accepted.payTo as Address };
}

/**
 * Right after opening a fresh channel, the facilitator's own RPC node can still lag
 * ours by a block or two even after our confirmations settle — retry a paid request a
 * few times rather than fail on what is genuinely eventual consistency, not a real error.
 */
export async function fetchWithSettleRetry(
  url: string,
  init: RequestInit,
  freshlyOpenedChannel: boolean,
): Promise<{ status: number; body: unknown }> {
  const attempts = freshlyOpenedChannel ? 3 : 1;
  let res!: Response;
  let body: unknown;
  for (let attempt = 1; attempt <= attempts; attempt++) {
    res = await fetch(url, init);
    body = res.headers.get("content-type")?.includes("json") ? await res.json() : await res.text();
    if (res.status !== 402 || attempt === attempts) break;
    await new Promise((resolve) => setTimeout(resolve, 4000));
  }
  return { status: res.status, body };
}
