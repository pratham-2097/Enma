import { type Address, type Hex, encodeAbiParameters, hashTypedData } from "viem";
import { privateKeyToAccount } from "viem/accounts";

export class GuardSignerError extends Error {}

interface TypedDataSignRequest {
  domain: Record<string, unknown>;
  types: Record<string, unknown>;
  primaryType: string;
  message: Record<string, unknown>;
}

/**
 * A ClientEvmSigner whose `address` is EnmaGuard's own address, but whose
 * `signTypedData` produces EnmaGuard's custom voucher blob instead of a normal
 * EIP-712 signature: abi.encode(bytes agentSig, bytes32 channelId, uint128
 * maxClaimable).
 *
 * EnmaGuard's isValidSignature does not trust a standard voucher signature —
 * it recomputes the digest itself and expects this specific triple, so this
 * signer only knows how to answer the SDK's "Voucher" typed-data request
 * (the one `signVoucher()` sends before every payment) and refuses everything
 * else: a deposit/refund/permit signing request would either be meaningless
 * in this blob format or, worse, silently produce a signature for something
 * the caller didn't intend.
 */
export function createGuardSigner(opts: { guardAddress: Address; agentPrivateKey: Hex }) {
  const agent = privateKeyToAccount(opts.agentPrivateKey);

  return {
    address: opts.guardAddress,

    async signTypedData(request: TypedDataSignRequest): Promise<Hex> {
      if (request.primaryType !== "Voucher") {
        throw new GuardSignerError(
          `guardSigner only signs Voucher requests for EnmaGuard, got primaryType "${request.primaryType}"`,
        );
      }

      const { channelId, maxClaimableAmount } = request.message as {
        channelId?: Hex;
        maxClaimableAmount?: bigint | string;
      };
      if (typeof channelId !== "string" || maxClaimableAmount === undefined) {
        throw new GuardSignerError("Voucher request is missing channelId or maxClaimableAmount");
      }

      const digest = hashTypedData({
        domain: request.domain as never,
        types: request.types as never,
        primaryType: request.primaryType,
        message: request.message,
      } as never);
      const agentSig = await agent.sign({ hash: digest });

      return encodeAbiParameters(
        [{ type: "bytes" }, { type: "bytes32" }, { type: "uint128" }],
        [agentSig, channelId, BigInt(maxClaimableAmount)],
      );
    },
  };
}
