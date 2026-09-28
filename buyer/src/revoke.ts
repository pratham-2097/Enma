import { createPublicClient, createWalletClient, http, type Address, type Chain, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";

const GUARD_ABI = [
  {
    type: "function",
    name: "revoke",
    stateMutability: "nonpayable",
    inputs: [
      { name: "seller", type: "address" },
      { name: "reason", type: "uint32" },
    ],
    outputs: [],
  },
] as const;

/**
 * Sends EnmaGuard.revoke(seller, reasonCode) with the guardian key. This is the one
 * operation no pre-signature guard can offer — flips every already-signed voucher for
 * this seller unclaimable, checked at the escrow's own claim-time EIP-1271 call.
 */
export async function revokeSeller(opts: {
  chain: Chain;
  rpcUrl: string;
  guardAddress: Address;
  guardianPrivateKey: Hex;
  seller: Address;
  reasonCode: number;
}): Promise<Hex> {
  const publicClient = createPublicClient({ chain: opts.chain, transport: http(opts.rpcUrl) });
  const guardian = privateKeyToAccount(opts.guardianPrivateKey);
  const guardianWallet = createWalletClient({ account: guardian, chain: opts.chain, transport: http(opts.rpcUrl) });

  const hash = await guardianWallet.writeContract({
    address: opts.guardAddress,
    abi: GUARD_ABI,
    functionName: "revoke",
    args: [opts.seller, opts.reasonCode],
  });
  await publicClient.waitForTransactionReceipt({ hash, confirmations: 1 });
  return hash;
}
