// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IX402BatchSettlement, IDepositCollector, IERC20, ChannelConfig} from "./IX402.sol";

/// @title EnmaCollector
/// @notice Pluggable deposit collector: pulls funds from an EnmaGuard wallet into the escrow.
/// @dev Wallets approve this contract, so whoever can make it call `transferFrom` can spend
///      their allowance. Only the escrow may, and the funds only ever go to the escrow -- into a
///      channel whose vouchers the wallet itself validates, withdrawable only by its owner.
///
///      That last part is checked here, not assumed: the escrow's `deposit` is open to anyone,
///      and a channel names its own `payerAuthorizer`. Without the check a stranger could open a
///      channel funded by the wallet, name themselves as its authorizer, sign their own vouchers
///      and claim the lot. So the depositor must pass the channel config as `collectorData`,
///      and it must be this wallet's, gated by the wallet (`payerAuthorizer == 0`).
contract EnmaCollector is IDepositCollector {
    address public immutable escrow;

    error NotEscrow();
    error WrongChannel();
    error NotGatedByPayer();

    constructor(address _escrow) {
        escrow = _escrow;
    }

    function collect(address payer, address token, uint256 amount, bytes32 channelId, bytes calldata data) external {
        if (msg.sender != escrow) revert NotEscrow();
        ChannelConfig memory cfg = abi.decode(data, (ChannelConfig));
        if (IX402BatchSettlement(escrow).getChannelId(cfg) != channelId) revert WrongChannel();
        if (cfg.payer != payer || cfg.token != token || cfg.payerAuthorizer != address(0)) revert NotGatedByPayer();
        require(IERC20(token).transferFrom(payer, escrow, amount), "pull failed");
    }
}

/// @title EnmaGuard
/// @notice A policy-gated EIP-1271 payer for x402 `batch-settlement` payment channels.
///
/// @dev EnmaGuard is the `payer` of an x402 channel whose `payerAuthorizer` is `address(0)`.
///      That configuration makes Coinbase's deployed `x402BatchSettlement` escrow validate every
///      voucher through `SignatureChecker.isValidSignatureNow(payer, ...)` -- i.e. through this
///      contract -- at CLAIM time rather than at signing time.
///
///      A voucher is only claimable if ALL of the following hold *when the seller cashes it in*:
///        1. the voucher's own `(channelId, maxClaimableAmount)` actually hashes to the digest
///           being checked (so nothing in the signature blob can be silently substituted),
///        2. the agent signed that digest,
///        3. the seller is one this wallet itself recorded at `openTab`/`openChannel` time
///           (never a value trusted from the blob -- see `isValidSignature` below),
///        4. that seller is not revoked,
///        5. the wallet is not paused.
///
///      Conditions 4 and 5 are read from storage during validation. Because they are evaluated at
///      claim time, a seller that turns malicious AFTER the agent has already paid -- but before
///      settlement -- can still be stopped. Every pre-signing payment guard validates at signing
///      time instead, where the signature is already final and nothing can be taken back.
///
///      Trust model: the guardian holds a revoke veto, never the funds. It cannot move money (the
///      agent must also sign), cannot redirect it (the digest binds the channel, which binds the
///      receiver), and cannot trap it (`initiateWithdraw`/`finalizeWithdraw` are owner-only and
///      need no guardian involvement).
///
///      The person deploys their own wallet and owns it from the first block: no operator ever
///      holds the owner role. Ownership moves only if the owner moves it.
contract EnmaGuard {
    /*//////////////////////////////////////////////////////////////
                                CONSTANTS
    //////////////////////////////////////////////////////////////*/

    bytes4 private constant MAGIC = 0x1626ba7e;
    bytes4 private constant INVALID = 0xffffffff;

    /// @dev secp256k1 curve order / 2; signatures with higher `s` are malleable duplicates.
    uint256 private constant HALF_N = 0x7FFFFFFFFFFFFFFFFFFFFFFFFFFFFFFF5D576E7357A4501DDFE92F46681B20A0;

    bytes32 public constant ATTESTATION_TYPEHASH =
        keccak256("Attestation(bytes32 digest,address seller,uint64 expiry)");

    /*//////////////////////////////////////////////////////////////
                                 STORAGE
    //////////////////////////////////////////////////////////////*/

    /// @notice Most time the agent may lock funds in a tab for. Real sellers ask for a day.
    uint40 public constant MAX_TAB_DELAY = 7 days;

    address public owner; // the human, from the first block
    address public immutable escrow; // Coinbase x402BatchSettlement
    address public collector; // the deposit collector the agent opens tabs through

    address public agent; // agent hot key (may be compromised; alone it can do nothing)
    address public guardian; // holds the revoke veto; no oracle co-signature in this MVP

    bool public paused;

    struct Revocation {
        bool revoked;
        uint32 reason; // QA failure code, for demo/audit visibility
        uint64 revokedAt; // when the kill switch was flipped
    }

    /// @notice Settlement-time kill switch, keyed by seller.
    mapping(address => Revocation) public revocations;

    /// @notice SPIKE FIX: which seller a channel belongs to, recorded by this contract at
    ///         `openTab` time. The seller is never trusted from the signature blob itself --
    ///         see `isValidSignature` below for why that matters.
    mapping(bytes32 => address) public channelReceiver;

    /*//////////////////////////////////////////////////////////////
                             ERRORS & EVENTS
    //////////////////////////////////////////////////////////////*/

    error NotOwner();
    error NotGuardian();
    error NotAgent();
    error ZeroOwner();
    error NoCollector();
    error BadChannel();

    event OwnerChanged(address indexed previousOwner, address indexed newOwner);
    event CollectorChanged(address indexed collector);
    event AgentChanged(address indexed agent);
    event OracleChanged(address indexed oracle);
    event PausedSet(bool paused);
    event SellerRevoked(address indexed seller, uint32 reason, uint64 revokedAt);
    event SellerRestored(address indexed seller);
    event ChannelOpened(bytes32 indexed channelId, address indexed seller, uint128 amount);

    modifier onlyOwner() {
        if (msg.sender != owner) revert NotOwner();
        _;
    }

    /// @param _collector the deposit collector the agent may open tabs through. Set here so a
    ///        person's wallet works from the transaction that creates it; the owner can change it.
    constructor(address _owner, address _escrow, address _agent, address _guardian, address _collector) {
        owner = _owner;
        escrow = _escrow;
        collector = _collector;
        agent = _agent;
        guardian = _guardian;
    }

    /*//////////////////////////////////////////////////////////////
                                 ADMIN
    //////////////////////////////////////////////////////////////*/

    /// @notice Hand the wallet to a new owner. Every owner power moves with it: withdrawals,
    ///         keys, the collector. The previous owner keeps none of them.
    function transferOwnership(address newOwner) external onlyOwner {
        if (newOwner == address(0)) revert ZeroOwner();
        emit OwnerChanged(owner, newOwner);
        owner = newOwner;
    }

    function setCollector(address c) external onlyOwner {
        collector = c;
        emit CollectorChanged(c);
    }

    function setAgent(address a) external onlyOwner {
        agent = a;
        emit AgentChanged(a);
    }

    function setOracle(address o) external onlyOwner {
        guardian = o;
        emit OracleChanged(o);
    }

    function setPaused(bool p) external {
        if (msg.sender != owner && msg.sender != guardian) revert NotGuardian();
        paused = p;
        emit PausedSet(p);
    }

    function approveToken(address token, address spender, uint256 amount) external onlyOwner {
        IERC20(token).approve(spender, amount);
    }

    /*//////////////////////////////////////////////////////////////
                      THE SETTLEMENT-TIME KILL SWITCH
    //////////////////////////////////////////////////////////////*/

    /// @notice Revoke a seller. Every voucher already signed for them becomes unclaimable.
    /// @dev Callable by the risk oracle (automated, when a score moves) or the owner (manual).
    ///      This is the one operation no pre-signature guard can offer.
    function revoke(address seller, uint32 reason) external {
        if (msg.sender != owner && msg.sender != guardian) revert NotGuardian();
        revocations[seller] = Revocation({revoked: true, reason: reason, revokedAt: uint64(block.timestamp)});
        emit SellerRevoked(seller, reason, uint64(block.timestamp));
    }

    /// @notice Clear a revocation (score recovered, or a false positive).
    function restore(address seller) external {
        if (msg.sender != owner && msg.sender != guardian) revert NotGuardian();
        delete revocations[seller];
        emit SellerRestored(seller);
    }

    function isRevoked(address seller) external view returns (bool) {
        return revocations[seller].revoked;
    }

    /*//////////////////////////////////////////////////////////////
                            CHANNEL LIFECYCLE
    //////////////////////////////////////////////////////////////*/

    function openChannel(ChannelConfig calldata cfg, uint128 amount, address _collector) external onlyOwner {
        bytes32 id = IX402BatchSettlement(escrow).getChannelId(cfg);
        IX402BatchSettlement(escrow).deposit(cfg, amount, _collector, abi.encode(cfg));
        channelReceiver[id] = cfg.receiver; // SPIKE FIX: the contract records this itself
        emit ChannelOpened(id, cfg.receiver, amount);
    }

    /// @notice Open (or top up) a tab from this wallet's own funds. The agent may: it spends
    ///         nothing, since the money stays in a channel only this wallet's vouchers unlock.
    /// @dev The collector is approved for exactly `amount` and reset after, so no allowance is
    ///      left standing between tabs for anyone else to use.
    function openTab(ChannelConfig calldata cfg, uint128 amount) external {
        if (msg.sender != agent && msg.sender != owner) revert NotAgent();
        if (cfg.payer != address(this) || cfg.payerAuthorizer != address(0) || cfg.withdrawDelay > MAX_TAB_DELAY) {
            revert BadChannel();
        }
        address c = collector;
        if (c == address(0)) revert NoCollector();
        bytes32 id = IX402BatchSettlement(escrow).getChannelId(cfg);
        IERC20(cfg.token).approve(c, amount);
        IX402BatchSettlement(escrow).deposit(cfg, amount, c, abi.encode(cfg));
        IERC20(cfg.token).approve(c, 0);
        channelReceiver[id] = cfg.receiver; // SPIKE FIX: seller identity now owned by us, not the blob
        emit ChannelOpened(id, cfg.receiver, amount);
    }

    /// @notice Escape hatch. Owner only -- never the agent, never the oracle.
    /// @dev If the oracle disappears forever, the owner still recovers the escrow after
    ///      `cfg.withdrawDelay` (15 minutes minimum) with no oracle involvement at all.
    function initiateWithdraw(ChannelConfig calldata cfg, uint128 amount) external onlyOwner {
        IX402BatchSettlement(escrow).initiateWithdraw(cfg, amount);
    }

    function finalizeWithdraw(ChannelConfig calldata cfg) external onlyOwner {
        IX402BatchSettlement(escrow).finalizeWithdraw(cfg);
    }

    function sweep(address token, address to, uint256 amount) external onlyOwner {
        IERC20(token).transfer(to, amount);
    }

    /*//////////////////////////////////////////////////////////////
                         EIP-1271: THE POLICY GATE
    //////////////////////////////////////////////////////////////*/

    /// @notice Called by the x402 escrow for every voucher, at claim time.
    /// @param digest    EIP-712 `Voucher(bytes32 channelId,uint128 maxClaimableAmount)` digest.
    /// @param signature abi.encode(bytes agentSig, bytes32 channelId, uint128 maxClaimable)
    /// @return MAGIC (0x1626ba7e) if the voucher may be claimed right now, else INVALID.
    /// @dev The seller is NEVER read from a field the signer wrote. A design that lets a
    ///      signature blob self-report a `seller` field is only safe if a second party
    ///      co-signs `(digest, seller, expiry)` to vouch for it. This contract carries no such
    ///      second signer, so instead it recomputes the digest itself from `(channelId, amount)`
    ///      and looks the seller up from `channelReceiver`, a mapping ONLY this contract writes
    ///      (in `openTab`/`openChannel`). A forged `seller` field can no longer matter, because
    ///      the blob no longer carries one at all.
    function isValidSignature(bytes32 digest, bytes calldata signature) external view returns (bytes4) {
        (bytes memory agentSig, bytes32 channelId, uint128 maxClaimable) =
            abi.decode(signature, (bytes, bytes32, uint128));

        // 1. the blob must actually describe the digest the escrow is asking about
        if (IX402BatchSettlement(escrow).getVoucherDigest(channelId, maxClaimable) != digest) return INVALID;

        // 2. the agent must have authorised this exact voucher
        if (_recover(digest, agentSig) != agent) return INVALID;

        // 3. the seller is a fact we recorded ourselves, never a claim in the blob
        address seller = channelReceiver[channelId];
        if (seller == address(0)) return INVALID;

        // --- everything above could be checked at signing time. Everything below could not. ---

        // 4. the seller must not have been revoked since the agent paid
        if (revocations[seller].revoked) return INVALID;

        // 5. global stop
        if (paused) return INVALID;

        return MAGIC;
    }

    /// @dev Malleability-safe ECDSA recovery (rejects high-`s` and bad `v`).
    function _recover(bytes32 hash, bytes memory sig) internal pure returns (address) {
        if (sig.length != 65) return address(0);
        bytes32 r;
        bytes32 s;
        uint8 v;
        assembly {
            r := mload(add(sig, 0x20))
            s := mload(add(sig, 0x40))
            v := byte(0, mload(add(sig, 0x60)))
        }
        if (uint256(s) > HALF_N) return address(0);
        if (v < 27) v += 27;
        if (v != 27 && v != 28) return address(0);
        return ecrecover(hash, v, r, s);
    }
}
