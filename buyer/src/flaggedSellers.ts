import type { Address } from "viem";

/** Parses FLAGGED_SELLERS ("0xabc,0xdef") into the denylist `runShady` screens against. */
export function parseFlaggedSellers(env: string | undefined): Address[] {
  if (!env) return [];
  return env
    .split(",")
    .map((s) => s.trim())
    .filter((s) => s.length > 0) as Address[];
}
