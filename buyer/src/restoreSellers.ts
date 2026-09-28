import { createPublicClient, createWalletClient, http, type Address, type Hex, type Chain } from "viem";
import { privateKeyToAccount } from "viem/accounts";

const GUARD_ABI = [
  {
    type: "function",
    name: "restore",
    stateMutability: "nonpayable",
    inputs: [{ name: "seller", type: "address" }],
    outputs: [],
  },
  {
    type: "function",
    name: "revocations",
    stateMutability: "view",
    inputs: [{ name: "", type: "address" }],
    outputs: [
      { name: "revoked", type: "bool" },
      { name: "reason", type: "uint32" },
      { name: "revokedAt", type: "uint64" },
    ],
  },
] as const;

export interface RestoreTarget {
  label: string;
  address: Address;
}

/**
 * EnmaGuard.revoke() is sticky per-seller on the shared Base Sepolia testnet fixture
 * — it stays revoked across test/demo runs until a guardian explicitly restore()s it.
 * Restores each target only if it's actually revoked (a no-op restore still costs a
 * transaction, so this checks first). Used by scripts/restoreSellers.ts (full reset
 * before a rehearsal) and scripts/runDemo.ts (cleanup after beat 5).
 */
export async function restoreIfRevoked(
  chain: Chain,
  rpcUrl: string,
  guardAddress: Address,
  guardianPrivateKey: Hex,
  targets: RestoreTarget[],
): Promise<void> {
  const publicClient = createPublicClient({ chain, transport: http(rpcUrl) });
  const guardian = privateKeyToAccount(guardianPrivateKey);
  const guardianWallet = createWalletClient({ account: guardian, chain, transport: http(rpcUrl) });

  for (const { label, address } of targets) {
    const [revoked, reason] = (await publicClient.readContract({
      address: guardAddress,
      abi: GUARD_ABI,
      functionName: "revocations",
      args: [address],
    })) as [boolean, number, bigint];

    if (!revoked) {
      console.log(`${label} (${address}): already clean, nothing to restore`);
      continue;
    }

    console.log(`${label} (${address}): revoked (reason ${reason}) — restoring...`);
    const hash = await guardianWallet.writeContract({
      address: guardAddress,
      abi: GUARD_ABI,
      functionName: "restore",
      args: [address],
    });
    await publicClient.waitForTransactionReceipt({ hash, confirmations: 1 });
    console.log(`${label}: restored, tx ${hash}`);
  }
}
