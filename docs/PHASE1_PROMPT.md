You are a senior software developer with years of experience in AI agents, agentic payments, and Web3 / Solidity. You're picking up a project called Enma x402 partway through, at the start of Phase 1. Read this entire prompt before touching anything — it front-loads context a fresh session doesn't have.

# What Enma is, in one paragraph

Enma sells AI-generated market-sentiment signals to AI agents for $0.01 a call over the x402 payment protocol's `batch-settlement` scheme on Base Sepolia (testnet). The interesting part: the buyer pays from a smart-contract wallet (`EnmaGuard`), not a plain key. Coinbase's real, deployed x402 escrow contract asks that wallet "is this payment still valid?" at the moment the seller tries to collect — not when the buyer originally signed. If the buyer's own automated QA judge decides the data it received was garbage, it can flip that answer to "no" and the seller's collection attempt reverts on-chain, even though the buyer already has the data. That's the whole product.

# Where the project actually stands right now

Read these three files in the repo root, in this order, before writing any code:
1. `PLAN.md` — the authoritative build plan. Read it in full. Section 8 (`Test-driven deployment: the master test list`) governs how you must work. Section 10 (`Phase 1 — Contract`) is your task.
2. `PLAN.md` §2 — five specific things that changed from the original PRD, each with the fix already applied. §2.1 is the most important: a security fix already built and proven.
3. `RESEARCH.md` — background research. You don't need to re-derive anything from it; it's cited, not required reading, but skim §4–5 if you want the "why" behind the contract's design.

**Do not read `PLAN_EXPLAINED.md` or `PHASE0_SETUP.md`** — those are plain-language explainers for a non-technical stakeholder, not engineering references, and re-deriving from them risks losing precision that's already in PLAN.md.

# What's already built and proven — do not redo this work

`contracts/src/EnmaGuard.sol` and `contracts/src/EnmaCollector.sol` already exist, already compile clean, and already have 4 of 7 required tests written and passing. This was verified today, live, against two real networks — not simulated:

```
forge test --fork-url https://sepolia.base.org --match-contract EnmaGuardForkTest
forge test --fork-url https://mainnet.base.org --match-contract EnmaGuardMainnetForkTest
```

Both commands currently return **4 passed, 0 failed** (`test_openTab_recordsChannelReceiver_onRealEscrow`, `test_validVoucher_isAccepted_byRealEscrow`, `test_revokeAfterSigning_claimReverts_onRealEscrow`, `test_tamperedBlob_isRejected_byRealEscrow`), against the real, live Coinbase `x402BatchSettlement` escrow at `0x4020074e9dF2ce1deE5A9C1b5c3f541D02a10003` on both chains. Run these two commands yourself, first, before writing anything, to confirm your local environment reproduces this. If they don't pass, stop and figure out why before proceeding — don't paper over a broken starting state.

`contracts/.env` already has funded wallets (`OWNER_PRIVATE_KEY`, `AGENT_PRIVATE_KEY`, `GUARDIAN_PRIVATE_KEY` and their addresses) and a working dedicated RPC (`RPC_URL`) for Base Sepolia. Foundry (`forge`, `cast`) is installed at `~/.foundry/bin` — add it to PATH if it's not already there.

## The security property you must not regress

`EnmaGuard`'s `isValidSignature` function is the entire trust model. It intentionally does **not** trust a self-reported `seller` field inside the signature blob — that field doesn't exist in this design. Instead:
1. The blob only carries `(bytes agentSig, bytes32 channelId, uint128 maxClaimable)`.
2. The function recomputes the digest from the escrow's own `getVoucherDigest(channelId, maxClaimable)` and checks it matches what's being verified.
3. It looks up the seller from `channelReceiver[channelId]` — a mapping **only this contract writes**, set inside `openTab`/`openChannel` at the moment a channel is opened.

This is a deliberate fix for a real vulnerability found during design review: a design that trusts a self-reported seller field is only safe if a second party (a risk oracle) co-signs it, and this contract has no such second signer. `test_tamperedBlob_isRejected_byRealEscrow` is the regression test for exactly this. **If you ever find yourself wanting to add a `seller` parameter back into the signature blob, stop — that reintroduces the vulnerability. Read `EnmaGuard.sol`'s own doc comments on `isValidSignature` before touching it.**

## A naming constraint you must follow without exception

**No file, comment, variable name, commit message, or any other artifact in this repository may reference "Izanagi" or any other named prior implementation, by name, in any form.** This project studied a prior open-source claim-time-payer design as a reference during research, but that name must never appear anywhere in committed history or working files — not in code comments, not in commit messages, not in documentation you write. If you need to refer to it, say "a prior reference implementation" or "the reference design," exactly as `RESEARCH.md` and `PLAN.md` already do. This was a deliberate, explicit instruction from the project owner and git history was already rewritten once to enforce it — do not reintroduce it.

# Your task: finish Phase 1 (§10 of PLAN.md), test-driven, in order

Three tests are missing from `contracts/test/EnmaGuard.t.sol` (and should also be added to `contracts/test/EnmaGuardMainnet.t.sol`, which is the same suite pointed at mainnet-fork addresses — keep both files in sync). PLAN.md §8.1 names them:

1. `test_restore_makesVoucherClaimableAgain` — revoke a seller, confirm a claim reverts, then call `restore()`, then confirm the *same* voucher now claims successfully. Proves the kill switch is reversible, not permanent.
2. `test_unknownChannel_isRejected` — construct a valid-looking signature blob for a `channelId` that was never opened via `openTab`/`openChannel` (so `channelReceiver[channelId]` is still the zero address). Confirm `isValidSignature` returns `INVALID` (`0xffffffff`), not `MAGIC`. This is a second, distinct regression test protecting the same security property as `test_tamperedBlob_isRejected_byRealEscrow` — don't skip it just because it feels similar.
3. `test_onlyOwnerCanWithdrawOrSweep` — confirm `initiateWithdraw`, `finalizeWithdraw`, and `sweep` all revert (with `NotOwner()`) when called by `agent`, by `guardian`, or by an arbitrary third address — and succeed only when called by `owner`.

**Work test-driven, exactly as PLAN.md §8 prescribes:**
- Write each test first. Run it. Confirm it fails, and confirm it fails for the *right reason* (e.g., a revert you expected, not a compile error from a typo).
- Only then write or modify contract code if a test reveals a real gap — but based on the current `EnmaGuard.sol`, all three of these should already pass against the existing contract without any contract changes, since the underlying logic already exists (`revoke`/`restore`, the `channelReceiver` check, the `onlyOwner` modifier). If any of them fails against the current contract, that's a real finding — stop and report it precisely rather than silently patching around it.
- Run the full 7-test suite against **both** live forks (Sepolia and mainnet) before considering Phase 1 done. All 7 must pass on both, matching the pattern the existing 4 already established.

After all 7 tests are green on both networks, do the **real broadcast deployment** per PLAN.md §10, step 1.4 — this is different from a fork test:
```
forge script script/Deploy.s.sol --rpc-url $RPC_URL --broadcast
```
You will need to write `contracts/script/Deploy.s.sol` — it does not exist yet. It should deploy `EnmaCollector(escrow)` first, then `EnmaGuard(owner, escrow, agent, guardian, collector)`, reading `OWNER_ADDRESS`/`AGENT_ADDRESS`/`GUARDIAN_ADDRESS` and the escrow constant from `contracts/.env`. **A real broadcast spends real (testnet) gas and creates a permanent on-chain deployment — confirm with the user before running the actual `--broadcast` command**, even though it's testnet and the cost is negligible; a dry run (`forge script script/Deploy.s.sol --rpc-url $RPC_URL`, no `--broadcast`) is safe to run without asking first.

After a successful deploy, write the resulting contract addresses into `ENMA_GUARD_ADDRESS` and `ENMA_COLLECTOR_ADDRESS` in `contracts/.env`, `seller/.env`, and `buyer/.env` (those variables already exist as blank placeholders in each `.env.example`/`.env`).

Then have the owner wallet send 2–5 test USDC into the deployed `EnmaGuard` address (per PLAN.md §10, step 1.5) — you can do this yourself with `cast send`, since `OWNER_PRIVATE_KEY` is already funded with 20 test USDC per the verified balance in `contracts/.env`.

**Gate G1, per PLAN.md, is: 7/7 tests green on both networks, contract broadcast-deployed on Base Sepolia with a real address, and funded.** Do not report Phase 1 complete until all of that is true and verified — not assumed.

# House rules for this whole session

- Never fabricate a test result. If you say a test passed, you ran it and are looking at real terminal output showing it passed.
- Never touch `reference/` — it's gitignored, untracked, and irrelevant to your task; don't read from it or reference it.
- Never commit `.env` files (already gitignored) or `generate_wallets.sh` (also gitignored — leave it alone, it already did its job).
- Commit your work when Phase 1 is genuinely complete, with a clear message describing what was verified, not just what was written. Don't commit partial/broken states.
- If anything in PLAN.md conflicts with what you find in the actual code, the actual code and a live test result are ground truth — flag the discrepancy to the user rather than trusting the document blindly.
