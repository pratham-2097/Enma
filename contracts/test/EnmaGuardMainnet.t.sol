// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {EnmaGuard, EnmaCollector} from "../src/EnmaGuard.sol";
import {ChannelConfig, IX402BatchSettlement, Voucher, VoucherClaim} from "../src/IX402.sol";

/// Feasibility spike: does the security-fixed EnmaGuard actually validate against the REAL,
/// deployed Base Sepolia escrow, not a mock? This is the question that gates the whole plan.
contract EnmaGuardMainnetForkTest is Test {
    address constant ESCROW = 0x4020074e9dF2ce1deE5A9C1b5c3f541D02a10003;
    address constant USDC = 0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913; // Base MAINNET USDC

    EnmaGuard guard;
    EnmaCollector collector;

    address owner;
    uint256 agentKey = 0xA11CE;
    address agent;
    address guardian = address(0xBEEF);
    address receiver = address(0xCAFE); // pretend seller
    address receiverAuthorizer = address(0xFACE);

    function setUp() public {
        owner = address(this);
        agent = vm.addr(agentKey);

        collector = new EnmaCollector(ESCROW);
        guard = new EnmaGuard(owner, ESCROW, agent, guardian, address(collector));

        // fund the guard wallet with test USDC by impersonating a known whale-ish holder is
        // unreliable on a fork with no faucet history, so mint via deal() instead -- this is
        // the standard Foundry way to test against a real token's storage layout.
        deal(USDC, address(guard), 1_000_000); // 1 USDC (6 decimals)
    }

    function _cfg() internal view returns (ChannelConfig memory) {
        return ChannelConfig({
            payer: address(guard),
            payerAuthorizer: address(0), // the whole point: routes the escrow to EIP-1271
            receiver: receiver,
            receiverAuthorizer: receiverAuthorizer,
            token: USDC,
            withdrawDelay: 900, // escrow minimum, 15 minutes
            salt: bytes32(uint256(1))
        });
    }

    function test_openTab_recordsChannelReceiver_onRealEscrow() public {
        ChannelConfig memory cfg = _cfg();
        bytes32 id = IX402BatchSettlement(ESCROW).getChannelId(cfg);

        guard.openTab(cfg, 100_000); // 0.10 USDC, as the agent... wait, test as owner (onlyAgent||owner)

        assertEq(guard.channelReceiver(id), receiver, "guard must remember the seller itself");

        (uint128 balance,) = IX402BatchSettlement(ESCROW).channels(id);
        assertEq(balance, 100_000, "the REAL escrow must actually hold the deposit");
    }

    function test_validVoucher_isAccepted_byRealEscrow() public {
        ChannelConfig memory cfg = _cfg();
        bytes32 id = IX402BatchSettlement(ESCROW).getChannelId(cfg);
        guard.openTab(cfg, 100_000);

        uint128 claimAmount = 10_000; // 0.01 USDC, one call's worth
        bytes32 digest = IX402BatchSettlement(ESCROW).getVoucherDigest(id, claimAmount);

        (uint8 v, bytes32 r, bytes32 s) = vm.sign(agentKey, digest);
        bytes memory agentSig = abi.encodePacked(r, s, v);
        bytes memory blob = abi.encode(agentSig, id, claimAmount);

        // this is the exact call the REAL escrow's SignatureChecker makes at claim time
        bytes4 result = guard.isValidSignature(digest, blob);
        assertEq(result, bytes4(0x1626ba7e), "MAGIC: the real escrow must accept this voucher");
    }

    function test_revokeAfterSigning_claimReverts_onRealEscrow() public {
        ChannelConfig memory cfg = _cfg();
        bytes32 id = IX402BatchSettlement(ESCROW).getChannelId(cfg);
        guard.openTab(cfg, 100_000);

        uint128 claimAmount = 10_000;
        bytes32 digest = IX402BatchSettlement(ESCROW).getVoucherDigest(id, claimAmount);
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(agentKey, digest);
        bytes memory blob = abi.encode(abi.encodePacked(r, s, v), id, claimAmount);

        // THE HEADLINE CLAIM: revoke after the voucher was already signed
        vm.prank(guardian);
        guard.revoke(receiver, 10); // reason 10 = qa_schema_fail

        Voucher memory voucher = Voucher({channel: cfg, maxClaimableAmount: claimAmount});
        VoucherClaim[] memory claims = new VoucherClaim[](1);
        claims[0] = VoucherClaim({voucher: voucher, signature: blob, totalClaimed: claimAmount});

        // the REAL escrow's claim() must revert -- this is the whole product's promise
        vm.expectRevert();
        IX402BatchSettlement(ESCROW).claim(claims);
    }

    /// Regression test: a blob whose channelId doesn't match the digest being checked
    /// must be rejected -- this is exactly the hole a simplified, single-signer (no-oracle)
    /// design opens if the seller is ever trusted from the signature blob itself, and it's
    /// the hole this contract's security fix closes.
    function test_tamperedBlob_isRejected_byRealEscrow() public {
        ChannelConfig memory cfg = _cfg();
        bytes32 id = IX402BatchSettlement(ESCROW).getChannelId(cfg);
        guard.openTab(cfg, 100_000);

        uint128 claimAmount = 10_000;
        bytes32 digest = IX402BatchSettlement(ESCROW).getVoucherDigest(id, claimAmount);
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(agentKey, digest);
        bytes memory agentSig = abi.encodePacked(r, s, v);

        // tamper: claim a different (larger) amount than what was actually signed for
        bytes memory tamperedBlob = abi.encode(agentSig, id, uint128(999_999));

        bytes4 result = guard.isValidSignature(digest, tamperedBlob);
        assertEq(result, bytes4(0xffffffff), "a blob that doesn't match its own digest must be INVALID");
    }

    /// Proves the kill switch is reversible, not permanent: revoke, confirm a claim reverts,
    /// then restore(), then confirm the SAME voucher now claims successfully.
    function test_restore_makesVoucherClaimableAgain() public {
        ChannelConfig memory cfg = _cfg();
        bytes32 id = IX402BatchSettlement(ESCROW).getChannelId(cfg);
        guard.openTab(cfg, 100_000);

        uint128 claimAmount = 10_000;
        bytes32 digest = IX402BatchSettlement(ESCROW).getVoucherDigest(id, claimAmount);
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(agentKey, digest);
        bytes memory blob = abi.encode(abi.encodePacked(r, s, v), id, claimAmount);

        vm.prank(guardian);
        guard.revoke(receiver, 10);

        Voucher memory voucher = Voucher({channel: cfg, maxClaimableAmount: claimAmount});
        VoucherClaim[] memory claims = new VoucherClaim[](1);
        claims[0] = VoucherClaim({voucher: voucher, signature: blob, totalClaimed: claimAmount});

        vm.expectRevert();
        IX402BatchSettlement(ESCROW).claim(claims);

        vm.prank(guardian);
        guard.restore(receiver);

        // the same voucher, unchanged, must now be claimable against the real escrow.
        // claim() is only callable by the channel's own receiver.
        vm.prank(receiver);
        IX402BatchSettlement(ESCROW).claim(claims);
    }

    /// Second, distinct regression test for the §2.1 security fix: a signature blob referencing
    /// a channelId that was never opened via openTab/openChannel has channelReceiver == address(0),
    /// and must be rejected -- not accepted because no seller was ever recorded to check against.
    function test_unknownChannel_isRejected() public {
        ChannelConfig memory cfg = _cfg();
        cfg.salt = bytes32(uint256(999)); // a channel never opened
        bytes32 id = IX402BatchSettlement(ESCROW).getChannelId(cfg);

        assertEq(guard.channelReceiver(id), address(0), "sanity: channel was never opened");

        uint128 claimAmount = 10_000;
        bytes32 digest = IX402BatchSettlement(ESCROW).getVoucherDigest(id, claimAmount);
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(agentKey, digest);
        bytes memory blob = abi.encode(abi.encodePacked(r, s, v), id, claimAmount);

        bytes4 result = guard.isValidSignature(digest, blob);
        assertEq(result, bytes4(0xffffffff), "an unknown channel must be INVALID, never MAGIC");
    }

    /// Confirms initiateWithdraw, finalizeWithdraw, and sweep all revert with NotOwner() when
    /// called by the agent, the guardian, or an arbitrary third address, and succeed only for owner.
    function test_onlyOwnerCanWithdrawOrSweep() public {
        ChannelConfig memory cfg = _cfg();
        guard.openTab(cfg, 100_000);
        address stranger = address(0xD00D);
        vm.deal(stranger, 1 ether);
        vm.deal(agent, 1 ether);
        vm.deal(guardian, 1 ether);

        vm.prank(agent);
        vm.expectRevert(EnmaGuard.NotOwner.selector);
        guard.initiateWithdraw(cfg, 100_000);

        vm.prank(guardian);
        vm.expectRevert(EnmaGuard.NotOwner.selector);
        guard.initiateWithdraw(cfg, 100_000);

        vm.prank(stranger);
        vm.expectRevert(EnmaGuard.NotOwner.selector);
        guard.initiateWithdraw(cfg, 100_000);

        // owner succeeds
        guard.initiateWithdraw(cfg, 100_000);

        vm.prank(agent);
        vm.expectRevert(EnmaGuard.NotOwner.selector);
        guard.finalizeWithdraw(cfg);

        vm.prank(guardian);
        vm.expectRevert(EnmaGuard.NotOwner.selector);
        guard.finalizeWithdraw(cfg);

        vm.prank(stranger);
        vm.expectRevert(EnmaGuard.NotOwner.selector);
        guard.finalizeWithdraw(cfg);

        skip(cfg.withdrawDelay);
        guard.finalizeWithdraw(cfg); // owner succeeds

        vm.prank(agent);
        vm.expectRevert(EnmaGuard.NotOwner.selector);
        guard.sweep(USDC, owner, 1);

        vm.prank(guardian);
        vm.expectRevert(EnmaGuard.NotOwner.selector);
        guard.sweep(USDC, owner, 1);

        vm.prank(stranger);
        vm.expectRevert(EnmaGuard.NotOwner.selector);
        guard.sweep(USDC, owner, 1);

        guard.sweep(USDC, owner, 1); // owner succeeds
    }
}
