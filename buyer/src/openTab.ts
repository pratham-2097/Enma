import {
  createPublicClient,
  createWalletClient,
  http,
  type Address,
  type Hex,
  type Chain,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";

export interface ChannelConfig {
  payer: Address;
  payerAuthorizer: Address;
  receiver: Address;
  receiverAuthorizer: Address;
  token: Address;
  withdrawDelay: number;
  salt: Hex;
}

const GUARD_ABI = [
  {
    type: "function",
    name: "openTab",
    stateMutability: "nonpayable",
    inputs: [
      {
        name: "cfg",
        type: "tuple",
        components: [
          { name: "payer", type: "address" },
          { name: "payerAuthorizer", type: "address" },
          { name: "receiver", type: "address" },
          { name: "receiverAuthorizer", type: "address" },
          { name: "token", type: "address" },
          { name: "withdrawDelay", type: "uint40" },
          { name: "salt", type: "bytes32" },
        ],
      },
      { name: "amount", type: "uint128" },
    ],
    outputs: [],
  },
  {
    type: "function",
    name: "channelReceiver",
    stateMutability: "view",
    inputs: [{ name: "", type: "bytes32" }],
    outputs: [{ type: "address" }],
  },
] as const;

const ESCROW_ABI = [
  {
    type: "function",
    name: "getChannelId",
    stateMutability: "view",
    inputs: [
      {
        name: "cfg",
        type: "tuple",
        components: [
          { name: "payer", type: "address" },
          { name: "payerAuthorizer", type: "address" },
          { name: "receiver", type: "address" },
          { name: "receiverAuthorizer", type: "address" },
          { name: "token", type: "address" },
          { name: "withdrawDelay", type: "uint40" },
          { name: "salt", type: "bytes32" },
        ],
      },
    ],
    outputs: [{ type: "bytes32" }],
  },
] as const;

/**
 * Builds a ChannelConfig for opening a tab on EnmaGuard, from the exact terms
 * a seller's 402 response advertised (PLAN.md R13: never hard-code these).
 */
export function channelConfigFrom402(opts: {
  guardAddress: Address;
  token: Address;
  accepted: { payTo: string; extra: { receiverAuthorizer: string; withdrawDelay: number } };
  salt: Hex;
}): ChannelConfig {
  return {
    payer: opts.guardAddress,
    payerAuthorizer: "0x0000000000000000000000000000000000000000",
    receiver: opts.accepted.payTo as Address,
    receiverAuthorizer: opts.accepted.extra.receiverAuthorizer as Address,
    token: opts.token,
    withdrawDelay: opts.accepted.extra.withdrawDelay,
    salt: opts.salt,
  };
}

/**
 * Opens (or tops up) a tab on EnmaGuard from the guard wallet's own funds and waits
 * for the tx to settle enough that a facilitator on a different RPC node can see it.
 *
 * @returns the channelId, confirmed to be recorded in EnmaGuard.channelReceiver.
 */
export async function openTab(opts: {
  chain: Chain;
  rpcUrl: string;
  escrowAddress: Address;
  guardAddress: Address;
  ownerPrivateKey: Hex;
  cfg: ChannelConfig;
  amount: bigint;
  settleDelayMs?: number;
}): Promise<Hex> {
  const publicClient = createPublicClient({ chain: opts.chain, transport: http(opts.rpcUrl) });
  const owner = privateKeyToAccount(opts.ownerPrivateKey);
  const ownerWallet = createWalletClient({ account: owner, chain: opts.chain, transport: http(opts.rpcUrl) });

  const channelId = (await publicClient.readContract({
    address: opts.escrowAddress,
    abi: ESCROW_ABI,
    functionName: "getChannelId",
    args: [opts.cfg],
  })) as Hex;

  const hash = await ownerWallet.writeContract({
    address: opts.guardAddress,
    abi: GUARD_ABI,
    functionName: "openTab",
    args: [opts.cfg, opts.amount],
  });
  await publicClient.waitForTransactionReceipt({ hash, confirmations: 2 });

  // The facilitator (and any other reader) may hit a different, lagging RPC node.
  await new Promise((resolve) => setTimeout(resolve, opts.settleDelayMs ?? 5000));

  return channelId;
}

/**
 * Reads EnmaGuard's own record of which seller a channel belongs to.
 */
export async function getChannelReceiver(opts: {
  chain: Chain;
  rpcUrl: string;
  guardAddress: Address;
  channelId: Hex;
}): Promise<Address> {
  const publicClient = createPublicClient({ chain: opts.chain, transport: http(opts.rpcUrl) });
  return (await publicClient.readContract({
    address: opts.guardAddress,
    abi: GUARD_ABI,
    functionName: "channelReceiver",
    args: [opts.channelId],
  })) as Address;
}
