// Ported 1:1 from seller/public/dashboardLogic.js — same event contract, same
// pure reducer behavior. Logic stays framework-free and DOM-free on purpose.

export type EnmaEvent =
  | { kind: "payment_required"; asset: string; seller: string }
  | { kind: "voucher_opened"; asset: string; seller?: string; txHash?: string }
  | { kind: "data_served"; asset: string; payer: string; amount: number | string; seller?: string }
  | { kind: "qa_verdict"; asset: string; ok: boolean; reason?: string; seller?: string }
  | { kind: "revoked"; payer: string; txHash?: string; seller?: string }
  | { kind: "claimed"; amount: number | string; payer: string; txHash?: string; seller?: string }
  | { kind: "incident"; amount: number | string; payer: string; seller?: string }
  | { kind: "banned"; payer: string; seller?: string };

export type Lane = "buyer" | "seller" | "escrow";

const BASESCAN_TX_BASE = "https://sepolia.basescan.org/tx/";
// A real tx hash is always 0x + 64 hex chars. The dashboard drops this value straight
// into an href with no further escaping, so anything not matching this shape (e.g. a
// crafted event carrying an HTML/JS attribute break-out in place of a hash) must be
// refused here rather than trusted to reach the DOM.
const TX_HASH_RE = /^0x[0-9a-fA-F]{64}$/;

export function basescanLink(txHash?: string): string | undefined {
  return txHash && TX_HASH_RE.test(txHash) ? `${BASESCAN_TX_BASE}${txHash}` : undefined;
}

export function laneFor(event: EnmaEvent): Lane {
  switch (event.kind) {
    case "payment_required":
    case "voucher_opened":
      return "buyer";
    case "data_served":
      return "seller";
    case "qa_verdict":
      return "buyer";
    case "revoked":
      return "escrow";
    case "claimed":
    case "incident":
    case "banned":
      return "escrow";
    default:
      return "buyer";
  }
}

export type EventTone = "" | "ok" | "fail" | "banned";

export function describeEvent(event: EnmaEvent): { text: string; tone: EventTone; txHash?: string } {
  switch (event.kind) {
    case "payment_required":
      return { text: `402 Payment Required — ${event.asset} (${event.seller})`, tone: "" };
    case "voucher_opened":
      return { text: `Voucher opened for ${event.asset}`, tone: "", txHash: event.txHash };
    case "data_served":
      return { text: `Served ${event.asset} to ${short(event.payer)} for ${usd(event.amount)}`, tone: "" };
    case "qa_verdict":
      return {
        text: event.ok ? `QA passed for ${event.asset}` : `QA FAILED for ${event.asset}: ${event.reason ?? ""}`,
        tone: event.ok ? "ok" : "fail",
      };
    case "revoked":
      return { text: `Voucher revoked for ${short(event.payer)}`, tone: "fail", txHash: event.txHash };
    case "claimed":
      return { text: `Claimed ${usd(event.amount)} from ${short(event.payer)}`, tone: "ok", txHash: event.txHash };
    case "incident":
      return { text: `Claim failed — ${usd(event.amount)} from ${short(event.payer)} unclaimable`, tone: "fail" };
    case "banned":
      return { text: `${short(event.payer)} BANNED for excessive revocations`, tone: "banned" };
    default:
      return { text: JSON.stringify(event), tone: "" };
  }
}

export function short(addr?: string): string {
  if (!addr || addr.length < 10) return addr ?? "?";
  return `${addr.slice(0, 6)}…${addr.slice(-4)}`;
}

/** Amounts are USDC atomic units at 6 decimals (PLAN.md's $0.01 = 10000). */
export function usd(amountAtomic?: number | string): string {
  const n = Number(amountAtomic ?? 0) / 1e6;
  return `$${n.toFixed(2)}`;
}

export function isRogue(event: EnmaEvent): boolean {
  return event.seller === "rogue";
}

export interface Counters {
  claimedAtomic: bigint;
  refusedAtomic: bigint;
  qaOk: number;
  qaTotal: number;
  bans: number;
}

export function initialCounters(): Counters {
  return { claimedAtomic: 0n, refusedAtomic: 0n, qaOk: 0, qaTotal: 0, bans: 0 };
}

export function reduceCounters(state: Counters, event: EnmaEvent): Counters {
  switch (event.kind) {
    case "claimed":
      return { ...state, claimedAtomic: state.claimedAtomic + BigInt(event.amount) };
    case "incident":
      return { ...state, refusedAtomic: state.refusedAtomic + BigInt(event.amount) };
    case "qa_verdict":
      return { ...state, qaOk: state.qaOk + (event.ok ? 1 : 0), qaTotal: state.qaTotal + 1 };
    case "banned":
      return { ...state, bans: state.bans + 1 };
    default:
      return state;
  }
}

export function formatCounters(state: Counters) {
  return {
    claimed: `$${(Number(state.claimedAtomic) / 1e6).toFixed(2)}`,
    refused: `$${(Number(state.refusedAtomic) / 1e6).toFixed(2)}`,
    qaRate: state.qaTotal === 0 ? "—" : `${Math.round((100 * state.qaOk) / state.qaTotal)}%`,
    bans: String(state.bans),
  };
}
