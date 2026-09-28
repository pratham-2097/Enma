export interface SpendLimitConfig {
  /** Refuse any single call quoted above this many atomic USDC units. */
  maxPerCallAtomicUnits?: bigint;
  /** Refuse a call if it would push this seller's rolling-window spend over this total. */
  maxWindowAtomicUnits?: bigint;
  /** Width of the rolling spend window, in ms. Required if maxWindowAtomicUnits is set. */
  windowMs?: number;
}

export type SpendLimitCheck = { allowed: true } | { allowed: false; reason: string };

/** USDC has 6 decimals; atomic units only ever appear in log/error text, never in comparisons. */
function formatUsdc(atomicUnits: bigint): string {
  return `$${(Number(atomicUnits) / 1_000_000).toFixed(3)}`;
}

interface Spend {
  amount: bigint;
  at: number;
}

/**
 * Buyer-side firewall: refuses to spend before any channel is opened or gas is spent,
 * the same "protect the payer before the fact" idea as QA's revoke does after the fact.
 * Pure in-memory state — one process's lifetime, not persisted (this is a demo-scope
 * safety net, not a durable ledger).
 */
export class SpendLimiter {
  private readonly spends = new Map<string, Spend[]>();

  constructor(
    private readonly config: SpendLimitConfig,
    private readonly now: () => number = Date.now,
  ) {}

  check(seller: string, amountAtomicUnits: bigint): SpendLimitCheck {
    const { maxPerCallAtomicUnits, maxWindowAtomicUnits, windowMs } = this.config;

    if (maxPerCallAtomicUnits !== undefined && amountAtomicUnits > maxPerCallAtomicUnits) {
      return {
        allowed: false,
        reason: `per-call limit exceeded: seller quoted ${formatUsdc(amountAtomicUnits)}, cap is ${formatUsdc(maxPerCallAtomicUnits)}`,
      };
    }

    if (maxWindowAtomicUnits !== undefined && windowMs !== undefined) {
      const spentInWindow = this.spentInWindow(seller, windowMs);
      if (spentInWindow + amountAtomicUnits > maxWindowAtomicUnits) {
        return {
          allowed: false,
          reason: `rolling window limit exceeded: ${formatUsdc(spentInWindow)} already spent + ${formatUsdc(amountAtomicUnits)} would exceed cap of ${formatUsdc(maxWindowAtomicUnits)}`,
        };
      }
    }

    return { allowed: true };
  }

  /** Call only after a payment actually goes through — checking alone must not record spend. */
  record(seller: string, amountAtomicUnits: bigint): void {
    const list = this.spends.get(seller) ?? [];
    list.push({ amount: amountAtomicUnits, at: this.now() });
    this.spends.set(seller, list);
  }

  private spentInWindow(seller: string, windowMs: number): bigint {
    const cutoff = this.now() - windowMs;
    const list = this.spends.get(seller) ?? [];
    return list.filter((s) => s.at > cutoff).reduce((sum, s) => sum + s.amount, 0n);
  }
}
