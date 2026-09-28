import type { Address, Chain, Hex } from "viem";
import { buySignal, SpendLimitExceededError } from "./buySignal";
import { checkDeterministic, checkJev, QA_REASON_JEV_FAIL } from "./qa";
import { revokeSeller } from "./revoke";
import { reportEvent } from "./reportEvent";
import { SpendLimiter, type SpendLimitConfig } from "./spendLimit";

export interface AgentConfig {
  chain: Chain;
  rpcUrl: string;
  sellerUrl: string;
  escrowAddress: Address;
  usdcAddress: Address;
  guardAddress: Address;
  ownerPrivateKey: Hex;
  agentPrivateKey: Hex;
  guardianPrivateKey: Hex;
  jevApiKey?: string;
  /** Mainnet addresses the buyer refuses to pay, screened before ever signing a voucher. */
  flaggedSellers?: Address[];
  /** Pre-payment spend caps, screened before ever signing a voucher (see runFirewall). */
  spendLimit?: SpendLimitConfig;
}

export interface AgentRunResult {
  mode: "buy" | "cheat" | "shady" | "firewall";
  status?: number;
  body?: unknown;
  revoked: boolean;
  revokeTx?: Hex;
  refused?: boolean;
  reason?: string;
}

/**
 * `buy`: the honest path. Pay, run QA, revoke only if QA genuinely fails.
 */
export async function runBuy(config: AgentConfig, asset: string): Promise<AgentRunResult> {
  const purchase = await buySignal({
    chain: config.chain,
    rpcUrl: config.rpcUrl,
    sellerUrl: config.sellerUrl,
    asset,
    escrowAddress: config.escrowAddress,
    usdcAddress: config.usdcAddress,
    guardAddress: config.guardAddress,
    ownerPrivateKey: config.ownerPrivateKey,
    agentPrivateKey: config.agentPrivateKey,
  });

  if (purchase.status !== 200) {
    return { mode: "buy", status: purchase.status, body: purchase.body, revoked: false };
  }

  const gate1 = checkDeterministic(purchase.body);
  if (!gate1.ok) {
    console.log("DATA INVALID: REVOKING VOUCHER");
    await reportEvent(config.sellerUrl, {
      kind: "qa_verdict",
      seller: purchase.seller,
      asset,
      ok: false,
      reason: gate1.message,
    });
    const revokeTx = await revokeSeller({
      chain: config.chain,
      rpcUrl: config.rpcUrl,
      guardAddress: config.guardAddress,
      guardianPrivateKey: config.guardianPrivateKey,
      seller: purchase.seller,
      reasonCode: gate1.reasonCode,
    });
    await reportEvent(config.sellerUrl, { kind: "revoked", seller: purchase.seller, payer: purchase.cfg.payer, txHash: revokeTx });
    return { mode: "buy", status: purchase.status, body: purchase.body, revoked: true, revokeTx };
  }

  if (config.jevApiKey) {
    const gate2 = await checkJev(purchase.body, { apiKey: config.jevApiKey });
    if (!gate2.ok) {
      console.log("DATA INVALID: REVOKING VOUCHER (Jev)");
      await reportEvent(config.sellerUrl, {
        kind: "qa_verdict",
        seller: purchase.seller,
        asset,
        ok: false,
        reason: gate2.message,
      });
      const revokeTx = await revokeSeller({
        chain: config.chain,
        rpcUrl: config.rpcUrl,
        guardAddress: config.guardAddress,
        guardianPrivateKey: config.guardianPrivateKey,
        seller: purchase.seller,
        reasonCode: QA_REASON_JEV_FAIL,
      });
      await reportEvent(config.sellerUrl, { kind: "revoked", seller: purchase.seller, payer: purchase.cfg.payer, txHash: revokeTx });
      return { mode: "buy", status: purchase.status, body: purchase.body, revoked: true, revokeTx };
    }
  }

  await reportEvent(config.sellerUrl, { kind: "qa_verdict", seller: purchase.seller, asset, ok: true });
  return { mode: "buy", status: purchase.status, body: purchase.body, revoked: false };
}

/**
 * `cheat`: accepts genuinely good data, then revokes anyway — proves the seller's
 * MAD ledger, not QA correctness. Used to demo the ban path (e2e.mad.test.ts).
 */
export async function runCheat(config: AgentConfig, asset: string): Promise<AgentRunResult> {
  const purchase = await buySignal({
    chain: config.chain,
    rpcUrl: config.rpcUrl,
    sellerUrl: config.sellerUrl,
    asset,
    escrowAddress: config.escrowAddress,
    usdcAddress: config.usdcAddress,
    guardAddress: config.guardAddress,
    ownerPrivateKey: config.ownerPrivateKey,
    agentPrivateKey: config.agentPrivateKey,
  });

  if (purchase.status !== 200) {
    return { mode: "cheat", status: purchase.status, body: purchase.body, revoked: false };
  }

  // Revoke regardless of what QA would say — this buyer is the abuser, not the seller.
  const revokeTx = await revokeSeller({
    chain: config.chain,
    rpcUrl: config.rpcUrl,
    guardAddress: config.guardAddress,
    guardianPrivateKey: config.guardianPrivateKey,
    seller: purchase.seller,
    reasonCode: 99, // reason "cheat" — distinct from any real QA failure code
  });
  await reportEvent(config.sellerUrl, { kind: "revoked", seller: purchase.seller, payer: purchase.cfg.payer, txHash: revokeTx });

  return { mode: "cheat", status: purchase.status, body: purchase.body, revoked: true, revokeTx };
}

/**
 * `shady`: screens the seller's payTo against a local denylist of known-flagged
 * mainnet addresses before ever signing a voucher (RESEARCH.md §7.1's honest
 * replacement for on-chain reputation screening — Intercepta scores testnet clean).
 */
export async function runShady(config: AgentConfig, asset: string): Promise<AgentRunResult> {
  const unpaidRes = await fetch(`${config.sellerUrl}/v1/signal/${asset}`);
  if (unpaidRes.status !== 402) {
    return { mode: "shady", status: unpaidRes.status, revoked: false };
  }
  const header = unpaidRes.headers.get("payment-required");
  const required = header
    ? (JSON.parse(Buffer.from(header, "base64").toString("utf8")) as {
        accepts: { scheme: string; payTo: string }[];
      })
    : undefined;
  const accepted = required?.accepts.find((a) => a.scheme === "batch-settlement");
  const payTo = accepted?.payTo?.toLowerCase();

  const flagged = (config.flaggedSellers ?? []).some((addr) => addr.toLowerCase() === payTo);
  if (flagged) {
    console.log(`REFUSED: payTo ${payTo} is a known-flagged address — no voucher signed`);
    return { mode: "shady", revoked: false, refused: true, reason: "payTo flagged" };
  }

  const purchase = await buySignal({
    chain: config.chain,
    rpcUrl: config.rpcUrl,
    sellerUrl: config.sellerUrl,
    asset,
    escrowAddress: config.escrowAddress,
    usdcAddress: config.usdcAddress,
    guardAddress: config.guardAddress,
    ownerPrivateKey: config.ownerPrivateKey,
    agentPrivateKey: config.agentPrivateKey,
  });
  return { mode: "shady", status: purchase.status, body: purchase.body, revoked: false };
}

/**
 * `firewall`: same honest path as `buy`, but with a spend cap enforced BEFORE any
 * channel is opened or gas is spent — refuses a call whose price exceeds the
 * configured limit outright, the same "protect the payer before the fact" idea as
 * QA's revoke does after the fact. Demo beat: point a cap below the seller's price
 * and show the refusal happen with zero gas spent.
 */
export async function runFirewall(config: AgentConfig, asset: string): Promise<AgentRunResult> {
  const spendLimiter = new SpendLimiter(config.spendLimit ?? {});
  try {
    const purchase = await buySignal({
      chain: config.chain,
      rpcUrl: config.rpcUrl,
      sellerUrl: config.sellerUrl,
      asset,
      escrowAddress: config.escrowAddress,
      usdcAddress: config.usdcAddress,
      guardAddress: config.guardAddress,
      ownerPrivateKey: config.ownerPrivateKey,
      agentPrivateKey: config.agentPrivateKey,
      spendLimiter,
    });
    return { mode: "firewall", status: purchase.status, body: purchase.body, revoked: false };
  } catch (err) {
    if (err instanceof SpendLimitExceededError) {
      console.log(`REFUSED: ${err.message}`);
      return { mode: "firewall", revoked: false, refused: true, reason: err.message };
    }
    throw err;
  }
}
