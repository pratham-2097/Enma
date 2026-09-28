# Enma x402: Final Build Plan (Solo, Phased, Test-Driven)

**For:** Pratham — this is the plan to build from
**Date:** 2026-09-28 · Startup Speedrun Hackathon · hacking ends **3:30 PM**
**Builds on:** [RESEARCH.md](RESEARCH.md) (the why), [PRD.md](PRD.md) (the what), [PLAN_EXPLAINED.md](PLAN_EXPLAINED.md) (the plain-language walkthrough). This file supersedes the earlier three-lane draft — it's rewritten for a solo build with every open decision locked.

## How to read this

Every factual claim is tagged:

| Tag | Meaning |
|---|---|
| ✅ **Verified** | Checked today against source code, a live endpoint, or the chain — including two full fork-test runs against the real, live Base Sepolia *and* Base mainnet escrow, done during this planning conversation. |
| 📄 **Documented** | Taken from official docs, not independently tested by us. |
| ⚠️ **Unverified** | Plausible but unproven. **The plan tests it in a named step before building on it.** |
| 🔒 **Locked** | A decision you've made. Not open for silent revision. |

Nothing below is assumed without one of these tags.

---

## Contents

1. [Locked decisions](#1-locked-decisions)
2. [What changed since the PRD, and the fix for each](#2-what-changed-since-the-prd-and-the-fix-for-each)
3. [Sponsor automation: what we don't have to write](#3-sponsor-automation-what-we-dont-have-to-write)
4. [Testnet → mainnet: what's proven, what's still open](#4-testnet--mainnet-whats-proven-whats-still-open)
5. [The system in one picture](#5-the-system-in-one-picture)
6. [One purchase, end to end](#6-one-purchase-end-to-end)
7. [Repo layout](#7-repo-layout)
8. [Test-driven deployment: the master test list](#8-test-driven-deployment-the-master-test-list)
9. [Phase 0 — Setup](#9-phase-0--setup)
10. [Phase 1 — Contract](#10-phase-1--contract)
11. [Phase 2 — Seller](#11-phase-2--seller)
12. [Phase 3 — Buyer + QA](#12-phase-3--buyer--qa)
13. [Phase 4 — Ops (Brainbase + Stripe)](#13-phase-4--ops-brainbase--stripe)
14. [Phase 5 — Dashboard](#14-phase-5--dashboard)
15. [Phase 6 — Demo prep + mainnet readiness](#15-phase-6--demo-prep--mainnet-readiness)
16. [Demo script with fallbacks](#16-demo-script-with-fallbacks)
17. [Stretch goal: the request-aware transformer](#17-stretch-goal-the-request-aware-transformer)
18. [Risk register](#18-risk-register)
19. [Costs](#19-costs)
20. [Verification ledger](#20-verification-ledger)
21. [Sources](#21-sources)

---

## 1. Locked decisions

Every open question from earlier planning is now closed. This table is the single source of truth for scope — nothing here gets silently revisited.

| # | Decision | 🔒 Locked answer | What it means for the build |
|---|---|---|---|
| D1 | Team size | **Solo** | The schedule (§9–15) is strictly sequential, one phase gates the next. No parallel lanes. |
| D2 | Claude model | **`claude-opus-5`**, effort `low` | ~0.7¢ per fresh transform. AI Gateway caching (§3) is what actually protects margin. |
| D3 | Cloudflare domain | **No** | Bans live in Worker/DO code, not a WAF rule. |
| D4 | Jev | **You provide a real key** | The semantic QA gate (Hop 6b) is now a **Must**, not a fallback-first item. |
| D5 | Intercepta | **Skip** — moved to "later, if time permits" | No default attempt. Local denylist only, and only if Phase 6 has slack. |
| D6 | Stripe | **Default (sandbox mirror)**; real mainnet payment **if time permits** | Build the mirror in Phase 4; attempt the real PaymentIntent only after Phase 6's demo is locked. |
| D7 | Claude buys via MCP | **Yes** | Built in Phase 3, after the core buy/QA/revoke loop is proven. |
| D8 | Dashboard | **2D first, upgrade to 3D if time allows** — "more impressive, the better the chances" | 2D is the Phase 5 deliverable; 3D is an explicit Phase 6 stretch, attempted only after the demo is otherwise locked and rehearsed. |
| D9 *(new)* | Network | **Build and prove on Base Sepolia (testnet) first. Design every piece to be network-agnostic from the start, so migrating to Base mainnet is a config change, not a rewrite. Attempt the real mainnet migration once the testnet demo is fully working and rehearsed.** | See §4 — this is now tested, not assumed. |

---

## 2. What changed since the PRD, and the fix for each

Five things came out of reading the actual escrow contract and the actual payment SDK, each with a concrete, already-implemented fix.

### 2.1 A seller could have paid itself under a false name — FIXED

**The problem:** an early design let the seller's own signature blob say "I am seller X." That's only safe if a second party (a risk oracle) double-checks that claim. Our simpler contract was going to drop that oracle — which would have let any seller lie about who it is and get paid anyway.

**The fix, built and verified today:** the contract records which seller a channel belongs to **itself**, the moment the channel opens (`channelReceiver[channelId] = cfg.receiver`, written inside `openTab`) — before any payment happens. At verification time, it looks the seller up from its own memory instead of trusting anything in the payment proof. The proof itself now only carries what's needed to recompute the exact number being asked about (`channelId`, `maxClaimableAmount`), nothing self-reported.

✅ **Verified twice**, against two different live chains: a 4-test fork suite (happy path, revoke-then-claim-reverts, restore, and a dedicated test that a tampered proof is rejected) passed cleanly against the real Base Sepolia escrow *and*, unmodified, against the real Base mainnet escrow. Same contract, same result, only the USDC address in the test config differed.

### 2.2 The "5-minute safety window" — DROPPED, not fixed (it couldn't be fixed)

**The problem:** an idea to make the contract itself refuse to pay out anything younger than N minutes, guaranteeing QA a window. Turns out the same check that decides "can this ever be paid" runs on every payment the instant it's made — a time-lock there would reject every fresh payment, forever, immediately.

**The fix:** there isn't a contract-level one, and there doesn't need to be. We already fully control how often our own seller tries to collect (a timer we write). The "window" is simply that timer's interval — no protocol trick required.

### 2.3 One bad payment can jam a whole batch of good ones — FIXED

**The problem:** if the seller tries to collect several buyers' payments in one transaction and even one is flagged, Coinbase's contract fails the *entire* transaction, including the honest buyers.

**The fix:** the seller collects **one buyer at a time**, never bundled. `maxClaimsPerBatch: 1`.

### 2.4 The seller's brain needs one atomic "room," not scattered state — FIXED by design

**The problem:** the payment library's storage interface needs atomic read-modify-write, which doesn't survive being split across a stateless router and a separate storage service cleanly.

**The fix:** the entire seller — payments, the AI call, the ledger, the live event feed — runs inside **one Cloudflare Durable Object**. A DO is single-threaded per instance, which gives atomicity for free.

### 2.5 Brainbase's webhook trigger isn't live yet — ROUTED AROUND

**The problem:** the plan assumed events could auto-fire a Brainbase agent via webhook. Their own docs say that trigger type isn't available yet.

**The fix:** call Brainbase's regular API directly (`POST https://api.brainbaselabs.com/v2/threads`) instead of waiting on a feature that doesn't exist yet.

---

## 3. Sponsor automation: what we don't have to write

Checked directly against real published packages and live docs, not assumed. This is where sponsors genuinely reduce code, and where a shortcut would have quietly broken the product.

| Sponsor feature | Verdict | What it means |
|---|---|---|
| **Cloudflare AI Gateway response caching** | ✅ **Use it — replaces a whole hand-written component.** Two request headers (`cf-aig-cache-ttl: 60`, `cf-aig-cache-key: <ticker>`) make Cloudflare itself cache the Claude response for 60 seconds and key it on the ticker, not the exact prompt text. | Deletes the need to hand-write a cache table, TTL logic, or a "first buyer this minute" check. This is Hop 5's whole caching story, for two lines of header config. |
| **Cloudflare Agents SDK `paidTool`** | ❌ **Cannot use it.** Downloaded and inspected the real `agents@0.24.0` package: `paidTool` only supports the `exact` x402 scheme (instant pay, no revoke). The string "batch-settlement" appears nowhere in the package. | Using this "shortcut" would have silently removed the revoke mechanism — the entire product. We write the payment plumbing with `@x402/evm`'s batch-settlement modules directly, not this helper. |
| **Brainbase scheduling the claim loop for us** | ⚠️ **Possible, not recommended for the MVP.** Brainbase can fire on a cron schedule and call our endpoint. But that trades a few lines of reliable in-process code for a dependency on an external platform's scheduler firing on time — a new failure mode we can't easily debug mid-demo. | Keep the claim timer as our own Durable Object alarm. Brainbase's real value is narration (below), not scheduling. |
| **Brainbase as an event narrator** | ✅ **Use it — real value, low cost.** One agent, described once in plain English in Brainbase's UI, watches our events and posts human-readable narration to Slack. | Replaces hand-writing Slack message formatting. **One agent, not four** — a solo build doesn't need a multi-agent "company," it needs one visible, working narrator. |
| **CDP facilitator fee (for the mainnet stretch goal)** | ✅ **Verified negligible.** First 1,000 settlements/month free, $0.001 each after. A demo needs ~10–20. | Cost is not a blocker for the mainnet stretch goal. |

---

## 4. Testnet → mainnet: what's proven, what's still open

🔒 **Locked approach (D9):** build and prove everything on Base Sepolia first. Every piece of config that differs between networks is isolated in one place from day one, so migrating later is changing values, not code.

### What's already proven, today, by actually running it

✅ The identical, unmodified `EnmaGuard` contract passes the full test suite (open a channel, sign a voucher, verify it's accepted, revoke it, verify the claim then reverts, verify a tampered proof is rejected) against **both** the real Base Sepolia escrow and the real Base mainnet escrow, with no code differences — only the USDC token address in the test's own config changed. Both runs: 4/4 passing, ~8 seconds each. This is the strongest evidence "ready to migrate" can have: it's not a claim, it's two side-by-side runs against two live production contracts.

✅ Gas is a non-issue on either network today: mainnet gas price checked live at 0.006 gwei, same order of magnitude as testnet. Published mainnet numbers from a comparable prior claim-time-payer deployment (~$0.0065 for a full demo) back this up independently.

### What's still genuinely open (honest gaps, not guesses dressed as facts)

⚠️ **The free `x402.org/facilitator` we use on testnet does not support mainnet at all** — checked its live capability list directly; Base mainnet is absent. Mainnet requires Coinbase's own CDP facilitator, a separate signup.
⚠️ **CDP account/API-key signup speed is unverified.** Their docs say "minutes" and describe a self-serve flow, but I couldn't independently confirm this without creating an account on your behalf, which needs your identity/email — that's a Phase 0 action item for you specifically, done early, so we know immediately rather than discover it at 2:45 PM.
⚠️ Real USDC would need to be acquired and sent to the wallet — a small, real cost, not a testnet faucet.

### The migration checklist (built once, used only if D9's stretch goal is attempted)

Every one of these lives in a single `network.ts` config file from Phase 0 onward — nothing else in the codebase references a chain ID, an RPC URL, or a token address directly:

```ts
// buyer/src/network.ts and seller/src/network.ts (identical shape, different values)
export const NETWORKS = {
  testnet: {
    chainId: 84532,
    caip2: "eip155:84532",
    rpcUrl: process.env.RPC_URL_TESTNET,
    usdc: "0x036CbD53842c5426634e7929541eC2318f3dCF7e",
    facilitatorUrl: "https://x402.org/facilitator",
  },
  mainnet: {
    chainId: 8453,
    caip2: "eip155:8453",
    rpcUrl: process.env.RPC_URL_MAINNET,
    usdc: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
    facilitatorUrl: process.env.CDP_FACILITATOR_URL, // needs CDP_API_KEY_ID / CDP_API_KEY_SECRET
  },
} as const;
export const ACTIVE = (process.env.ENMA_NETWORK ?? "testnet") as keyof typeof NETWORKS;
```

Migrating is then: get CDP keys, redeploy `EnmaGuard` and `EnmaCollector` with the mainnet constructor args (already proven to work, §4 above), fund the guard wallet with a small amount of real USDC, flip `ENMA_NETWORK=mainnet`, redeploy the Worker. No contract code changes, no buyer/seller logic changes.

---

## 5. The system in one picture

```
  LOCAL LAPTOP (Node 22)                          CLOUDFLARE (Worker + one Durable Object)
 ┌───────────────────────────────┐              ┌────────────────────────────────────────────┐
 │ buyer/  (TypeScript, solo)     │   HTTP 402   │ Worker "enma" (thin router + dashboard)    │
 │  • x402Client + @x402/fetch    │ ───────────► │   /v1/signal/:asset  ─► DO "seller:enma"   │
 │  • BatchSettlementEvmScheme    │              │   /rogue/v1/signal/:a ─► DO "seller:rogue" │
 │    (custom EnmaGuard signer)   │ ◄─────────── │   /ws                 ─► DO "seller:enma"  │
 │  • QA Judge: zod ─► Jev        │  data + 200  │                                            │
 │  • guardian key ─► revoke()    │              │ DO "seller:<name>":                        │
 │  • MCP server for Claude (D7)  │              │   Hono + @x402/hono + batch server scheme  │
 └──────────────┬────────────────┘              │   ChannelStorage on DO SQLite              │
                │ openTab / revoke (viem)        │   Claude via AI Gateway, cf-aig-cache-ttl  │
                ▼                                │   Payer ledger + ban list                  │
 ┌──────────────────────────────────┐            │   Alarm: claim (1 ch/tx) + settle          │
 │ network.ts: ONE config swap      │            │   WebSocket hub (hibernation)              │
 │ moves everything below to        │◄───────────┤   Brainbase API call (one narrator agent)  │
 │ Base mainnet (§4)                │  verify /  └──────────────┬─────────────────────────────┘
 │                                  │  claim via                │ /verify /settle
 │ EnmaGuard (EIP-1271 payer)       │  facilitator               ▼
 │ EnmaCollector                    │◄──────────── https://x402.org/facilitator ✅ (testnet)
 │ Coinbase x402BatchSettlement     │             or CDP facilitator (mainnet, ⚠️ D9 stretch)
 │  0x4020074e…0003 — VERIFIED on   │
 │  BOTH Base Sepolia and mainnet   │             BRAINBASE: one narrator agent → Slack
 └──────────────────────────────────┘             (events only — not the claim scheduler)
```

---

## 6. One purchase, end to end

Every hop, in order — this is exactly what the demo shows.

**Setup (once per buyer–seller pair)**
1. `GET /v1/signal/AAPL` with no payment → **402**, `PAYMENT-REQUIRED` header: `batch-settlement`, `eip155:84532`, USDC, `amount: "10000"` ($0.01), `payTo`, `withdrawDelay: 900`.
2. Buyer builds `ChannelConfig {payer: EnmaGuard, payerAuthorizer: 0x0, receiver: payTo, ...}`.
3. Agent key calls `EnmaGuard.openTab(cfg, 50_000)` (0.05 USDC = 5 calls). Contract records `channelReceiver[channelId]`, deposits via the collector (which only pulls funds into channels the wallet itself gates — closing an allowance-theft hole this design is deliberately built to avoid).

**Each request**
4. Buyer's custom signer signs the voucher digest raw, returns `abi.encode(agentSig, channelId, amount)` — no in-band deposit, `depositStrategy: () => false`.
5. Seller DO gets `PAYMENT-SIGNATURE`. Because `payerAuthorizer == 0`, verification routes to the facilitator, which calls `EnmaGuard.isValidSignature` via `eth_call`: recompute the digest, check the agent's signature, look up the seller from `channelReceiver` (never from the blob), check not revoked, not paused.
6. Seller checks the payer ledger (banned? → 402, refused pre-verify), serves the signal — first request this minute for this ticker triggers Claude via AI Gateway with `cf-aig-cache-ttl: 60`; every other request in that window is served from Cloudflare's own cache, zero extra Claude calls.
7. Buyer's QA Judge runs: deterministic schema/range/freshness check first (can revoke unconditionally on its own) → Jev semantic check second (`POST https://api.typesafe.ai/v1/systemone`, a `noul` question asking "is this genuine"). Fail either in a way that crosses the threshold → guardian key sends `EnmaGuard.revoke(sellerReceiver, reasonCode)`.

**Settlement (DO alarm, every 75s)**
8. One channel per transaction, simulated first. Escrow re-checks `isValidSignature` at claim time: not revoked → claim lands, later `settle()` sweeps USDC to the seller. Revoked → `claimWithSignature` **reverts**, the seller gets nothing for that call, the buyer's money stays put.
9. Every event streams to the dashboard WebSocket (Phase 5's EventHub DO), and notable ones (revoke, ban, claim result) also go to `#enma-ops` in Slack via a direct Incoming Webhook (Phase 4's narrator — see §13's correction).

---

## 7. Repo layout

```
Enma/
├── RESEARCH.md  PRD.md  PLAN.md  PLAN_EXPLAINED.md
├── contracts/                    # Foundry
│   ├── src/EnmaGuard.sol          # claim-time EIP-1271 payer, with the fix in §2.1 — ALREADY WRITTEN & TESTED
│   ├── src/EnmaCollector.sol      # gated deposit collector — ALREADY WRITTEN & TESTED
│   ├── src/IX402.sol              # x402 batch-settlement escrow interface
│   ├── test/EnmaGuard.t.sol       # fork tests — ALREADY GREEN on Sepolia AND mainnet
│   └── script/Deploy.s.sol
├── shared/
│   └── signal.schema.ts           # ONE zod schema — seller, buyer, and QA all import this
├── network.ts                     # the single testnet/mainnet config switch (§4)
├── seller/                        # Cloudflare Worker + one Durable Object
│   ├── wrangler.jsonc
│   ├── src/index.ts               # thin router
│   ├── src/sellerDO.ts            # Hono + x402 + storage + alarm + WS, all in one DO
│   ├── src/doChannelStorage.ts    # ChannelStorage over DO SQLite
│   ├── src/transform.ts           # Claude via AI Gateway, cf-aig-cache-ttl header does the caching
│   ├── src/ledger.ts              # payer ledger, bans
│   ├── src/upstream.ts            # mock "Web2" source (+ rogue mode)
│   └── public/                    # dashboard (2D now, 3D stretch)
├── buyer/
│   ├── src/guardSigner.ts         # custom ClientEvmSigner → EIP-1271 blob
│   ├── src/openTab.ts
│   ├── src/qa.ts                  # zod gate + Jev gate
│   ├── src/agent.ts               # CLI: buy / cheat / shady modes
│   └── src/mcp.ts                 # MCP server for Claude (D7)
└── ops/
    └── brainbase/                 # one narrator agent's instructions, exported from the UI
```

`.env` files gitignored. A test file exists before its implementation file for every item above — the mapping is in §8.

---

## 8. Test-driven deployment: the master test list

**Rule, unchanged: write the test, watch it fail for the right reason, then write only enough code to pass it.** Nothing is "done" because it looks done.

### 8.1 Contract — ✅ already written and green, twice

| Test | Proves | Status |
|---|---|---|
| `test_openTab_recordsChannelReceiver_onRealEscrow` | The contract remembers the seller itself | ✅ green, Sepolia + mainnet |
| `test_validVoucher_isAccepted_byRealEscrow` | A correctly signed voucher is accepted by the real escrow | ✅ green, Sepolia + mainnet |
| `test_revokeAfterSigning_claimReverts_onRealEscrow` | **The product's headline claim** | ✅ green, Sepolia + mainnet |
| `test_tamperedBlob_isRejected_byRealEscrow` | The §2.1 security fix — regression test | ✅ green, Sepolia + mainnet |

Still to write before Phase 1 is fully closed: `test_restore_makesVoucherClaimableAgain`, `test_unknownChannel_isRejected`, `test_onlyOwnerCanWithdrawOrSweep` — the remaining three from the original seven-test plan, not yet spiked.

### 8.2 Seller (`seller/test/*.test.ts`, `vitest` + `@cloudflare/vitest-pool-workers`)

| Test | Proves | Written before |
|---|---|---|
| `doChannelStorage.test.ts` | Concurrent updates to one channel never corrupt each other | `doChannelStorage.ts` |
| `transform.test.ts` | A broken Claude response returns 503, never a fake 200 | `transform.ts` |
| `transform.cache.test.ts` | The AI Gateway header actually produces one Claude call per minute per ticker, not per request | `transform.ts`'s AI Gateway call |
| `ledger.test.ts` | The ban rule is exact: ≥2 incidents **and** ≥50% unclaimable → banned; one honest QA miss never bans | `ledger.ts` |
| `x402.integration.test.ts` (`wrangler dev` + live facilitator) | A real `openTab` → real voucher → **200** on Base Sepolia | full seller stack — **this is Gate G2** |
| `rogue.test.ts` | The rogue instance serves junk from call 2 onward, still charges | `upstream.ts` rogue mode |

### 8.3 Buyer (`buyer/test/*.test.ts`)

| Test | Proves | Written before |
|---|---|---|
| `guardSigner.test.ts` | The blob decodes correctly; throws on any non-Voucher signing request | `guardSigner.ts` |
| `qa.test.ts` | Every deterministic invariant fails independently, one row per case | `qa.ts` gate 1 |
| `qa.jev.test.ts` | A 3s timeout is "no opinion," not a revoke; a real low-confidence Jev response revokes with reason `11` | `qa.ts` gate 2 — **run once against your real Jev key before trusting the mock** |
| `openTab.integration.test.ts` | The on-chain `channelReceiver` mapping matches what we opened with | `openTab.ts` |

### 8.4 End-to-end (`buyer/test/e2e/*.test.ts`) — written before Gate G3

1. `e2e.purchase.test.ts` — buy → 200 → QA passes → no revoke
2. `e2e.claim.test.ts` — trigger the alarm → claim tx lands → `settle()` moves USDC (assert via `balanceOf`)
3. `e2e.save.test.ts` — buy from the rogue seller → QA fails → revoke tx → the seller's next claim for that channel reverts
4. `e2e.mad.test.ts` — the `cheat` buyer revokes 3 good responses → ledger flips to `banned` → a 4th request gets 402 (payment refused) before any Claude call

**All four green is the literal definition of Gate G3.** A red test at 2:45 PM drops that beat from the live demo and falls back to the recorded video — the test failing *is* the fallback trigger, not a judgment call.

---

## 9. Phase 0 — Setup

**Goal:** every account, key, and balance exists and is confirmed working. Nothing else starts until this phase's gate passes.

| Step | Action | Verify |
|---|---|---|
| 0.1 | Install Foundry | ✅ already confirmed: 14 seconds, cold |
| 0.2 | Cloudflare account, `wrangler login`, create an AI Gateway named `enma` | `wrangler whoami` succeeds |
| 0.3 | Anthropic API key | test call succeeds |
| 0.4 | Dedicated Base Sepolia RPC (Alchemy/QuickNode, free) | responds to `eth_blockNumber` |
| 0.5 | 6 EVM keys: `OWNER`, `AGENT`, `GUARDIAN`, `ENMA_RECEIVER`, `ENMA_AUTHORIZER`, `ROGUE_RECEIVER`+`ROGUE_AUTHORIZER` | `cast wallet new` ×6+ |
| 0.6 | Base Sepolia ETH for `OWNER`/`AGENT`/`GUARDIAN` | faucet, `cast balance` shows > 0 |
| 0.7 | Test USDC to `OWNER` | faucet.circle.com, `cast call ... balanceOf` shows 20 USDC |
| 0.8 | Brainbase account, one narrator agent created, Slack connected | manual smoke post succeeds |
| 0.9 | **Jev key** (you're providing this) | one live call to `POST https://api.typesafe.ai/v1/systemone` returns a real `noul` answer |
| 0.10 | Stripe sandbox account, request "Stablecoins and Crypto" | request submitted (approval may lag — non-blocking) |
| 0.11 | *(D9 prep, do this early, in parallel — it's the one unverified timing risk)* Try CDP account signup at `portal.cdp.coinbase.com/create-account` | note how long it actually takes — this answers the open question in §4 |

**Gate G0:** every balance and login above is confirmed working.

---

## 10. Phase 1 — Contract

**Goal:** `EnmaGuard` + `EnmaCollector` deployed on Base Sepolia, full test suite green.

**Status: mostly already done.** The core 4 tests are written and green on both networks (§8.1). This phase is finishing the remaining 3 tests and deploying for real (the spike ran against a fork, not a real broadcast deployment).

| Step | Action |
|---|---|
| 1.1 | Copy the spiked `EnmaGuard.sol`/`EnmaCollector.sol`/`IX402.sol` into `contracts/src/` |
| 1.2 | Write the 3 remaining tests (restore, unknown-channel, owner-only-withdraw) — red first |
| 1.3 | Confirm all 7 tests green on a Base Sepolia fork |
| 1.4 | `forge script script/Deploy.s.sol --rpc-url $RPC --broadcast` — real deployment, real transaction |
| 1.5 | Owner sends 2–5 test USDC into the deployed `EnmaGuard` |

**Gate G1:** 7/7 tests green, contract live on Base Sepolia with a real address, funded.

---

## 11. Phase 2 — Seller

**Goal:** the Worker + Durable Object serves a real, paid, AI-transformed signal — the riskiest integration in the whole plan.

| Step | Action |
|---|---|
| 2.1 | `wrangler init`, DO binding with SQLite migration, `network.ts` wired in from the start |
| 2.2 | Write `doChannelStorage.test.ts` red, then implement `doChannelStorage.ts` |
| 2.3 | Hono app inside the DO: `@x402/hono` + `@x402/evm/batch-settlement/server`, registered on `eip155:84532` |
| 2.4 | `transform.ts`: Claude call via AI Gateway with `cf-aig-cache-ttl: 60` and `cf-aig-cache-key: <ticker>` — write `transform.test.ts` and `transform.cache.test.ts` first |
| 2.5 | `ledger.ts` + `ledger.test.ts`: ban rule |
| 2.6 | DO alarm: claim loop, `maxClaimsPerBatch: 1`, simulate before sending |
| 2.7 | **`x402.integration.test.ts`**: a real buyer key, real `openTab`, real voucher, real 200 — against `wrangler dev` and the live facilitator |
| 2.8 | Rogue instance: `ROGUE_AFTER=1`, `rogue.test.ts` |

**Gate G2:** `x402.integration.test.ts` green — one real payment served, one real claim landed on Base Sepolia, tx link in hand. This is the single most important checkpoint in the plan; everything else assumes it works.

---

## 12. Phase 3 — Buyer + QA

**Goal:** the buyer pays, checks, and revokes — the full loop closes.

| Step | Action |
|---|---|
| 3.1 | `guardSigner.ts` + `guardSigner.test.ts`: the custom EIP-1271 signer |
| 3.2 | `openTab.ts` + `openTab.integration.test.ts` |
| 3.3 | `qa.ts` gate 1 (deterministic) + `qa.test.ts`, every invariant table-tested |
| 3.4 | `qa.ts` gate 2 (Jev) + `qa.jev.test.ts` — **one live call against your real key before trusting anything mocked** |
| 3.5 | `agent.ts`: `buy`, `cheat`, `shady` CLI modes |
| 3.6 | `mcp.ts` (D7): wrap the buyer as an MCP server, `claude mcp add enma -- node buyer/dist/mcp.js` |

**Gate G3-partial:** `e2e.purchase.test.ts` and `e2e.save.test.ts` green (the revoke path proven end to end, buyer side).

---

## 13. Phase 4 — Ops (Slack)

**Goal:** every notable seller-side event visible in `#enma-ops`, live.

**Correction (2026-09-28):** the original plan assumed a generic `POST api.brainbaselabs.com/v2/threads` event-relay endpoint and a Stripe `mode: deposit` + `simulate_crypto_deposit` sandbox mirror. Neither exists — see git history on this section for the full investigation. Stripe is dropped for this hackathon (manual "Stablecoins and Crypto" approval gate, no fake-deposit test helper). A Brainbase agent (`enma-ops-narrator`) was built and proven live in Slack, but its runtime "send a message" API is undocumented and its Slack integration is task/thread-based (each inbound Slack message spawns a task; the agent replies via a Slack MCP tool addressed to that specific thread) rather than a simple push endpoint our seller code could call directly. Given the hackathon time budget, Phase 4 ships as a **direct Slack Incoming Webhook** instead — same demo beat (events land in `#enma-ops` in real time), fully documented, zero unknowns.

| Step | Action |
|---|---|
| 4.1 | Slack app → Incoming Webhooks → Activate → Add New Webhook to Workspace → pick `#enma-ops`. Paste the resulting `https://hooks.slack.com/services/...` URL into `seller/.env` as `SLACK_OPS_WEBHOOK_URL`. |
| 4.2 | Seller code (`seller/src/narrator.ts`): `Narrator.notify(event)` POSTs `{"text": "<one sentence>"}` straight to that webhook for three event kinds — `incident` (claim failure = revoke observed), `banned` (ledger ban transition), `claimed` (successful claim). Wired into `sellerDO.ts`'s `alarm()` loop; never throws (best-effort, must not affect the claim/ledger path). |
| 4.3 | *(Dropped for this hackathon.)* Stripe `transaction_verification` PaymentIntents against a real deposit address remain a possible strictly-additive future step if approval clears — not attempted here. |

**Gate:** `e2e.mad.test.ts` green (the ban path, with the event visibly posted to `#enma-ops`).

**Setup:** `seller/test/integration/narrator.integration.test.ts` is the one live call proving the webhook works — gated behind `RUN_NARRATOR_SMOKE=1` (`npm run test:narrator-smoke` in `seller/`), per this project's no-mocks-only rule for external integrations.

---

## 14. Phase 5 — Dashboard

**Goal:** the live, watchable story. 2D only in this phase.

| Step | Action |
|---|---|
| 5.1 | Static page on Workers Assets, canvas with 3 lanes (Buyer ↔ Seller ↔ Escrow) |
| 5.2 | WebSocket client, animate: 402 → voucher → data → QA verdict → claim result |
| 5.3 | Counters: revenue claimed, revenue refused, cache hit rate, bans |
| 5.4 | Basescan links on every on-chain event |

**Gate:** `e2e.claim.test.ts` green, and watching the dashboard alone tells the whole story without narration.

---

## 15. Phase 6 — Demo prep + mainnet readiness

**Goal:** feature freeze, rehearsal, backup video, and — only if everything above is solid with time left — the mainnet migration.

| Step | Action |
|---|---|
| 6.1 | **Feature freeze.** No new code past this point except fixing a red test. |
| 6.2 | Full rehearsal, twice, timed |
| 6.3 | Record the backup video — every beat, in case anything live fails |
| 6.4 | README: tx links, measured gas, sponsor feedback |
| 6.5 | *(Stretch, only if 6.1–6.4 are done with real time left)* Attempt the mainnet migration per the §4 checklist: CDP keys (from the Phase 0.11 timing check), flip `network.ts` to `mainnet`, redeploy the contracts (already proven to work identically), fund with a small real USDC amount, re-run the exact same demo script once against real money |
| 6.6 | *(Stretch, after 6.5 or in place of it if 6.5 doesn't fit)* 3D dashboard upgrade (D8) |

**Gate G4:** backup video saved, regardless of whether the mainnet stretch is reached.

---

## 16. Demo script with fallbacks

| # | Beat | What judges see | If it breaks live |
|---|---|---|---|
| 1 | **The purchase** | 402 → voucher → `sentiment_index` → QA ✓, on the dashboard | Play the backup video segment |
| 2 | **The cash-out** | Claim tx on Basescan; the ops narrator posts it to Slack `#enma-ops` | Pre-captured tx link |
| 3 | **The save** | Rogue seller → junk → `DATA INVALID: REVOKING VOUCHER` → revoke tx | Pre-run revoke tx link |
| 4 | **The revert** | Rogue claim → `CLAIM REJECTED by the escrow … reason: qa_schema_fail`, enforced by Coinbase's contract | Captured simulated-revert output |
| 5 | **MAD** | 3 independent channels, genuinely good data paid for each, one revoke wipes all 3 at once → 2+ incidents cross the ban ratio → banned → dashboard shows it live | Screenshot |
| 6 | **Shady seller** | Refused before any voucher exists (D5 built in Phase 3 — `buyer/src/agent.ts`'s `runShady`) | Skip |
| 7 | *(if the Phase 6.5 stretch landed)* **"And this is real"** | Switch `ENMA_NETWORK=mainnet`, run beat 1 again against real Base mainnet, real tiny USDC amount | Skip entirely if the stretch didn't land — testnet alone is a complete, honest demo |
| 8 | **Close** | "Agents pay only for data that passes QA." | — |

**Say out loud:** the core demo runs on a free test network by design, safe to break and retry; if the mainnet stretch landed, that's real money, deliberately small; a landed claim is final (we control our own claim cadence, a third party wouldn't wait); wallet bans are cheap to route around today (roadmap: stronger identity).

---

## 17. Stretch goal: the request-aware transformer

You asked a real question: right now the demo has exactly one fixed transformation (raw posts → one sentiment shape). A real product would read *what the buyer actually asked for* and adapt both the depth of analysis and the output shape to that request — a trading agent wanting raw numeric signal looks different from a research agent wanting a narrative summary.

**Why this is a named stretch, not part of the MVP:** the moment the output shape can vary per request, the QA layer's job gets harder in a specific way — it first has to determine what shape was *promised* before it can check whether the response matches it. Solving that well is a second real problem sitting on top of the first, and attempting it before the fixed-shape version is fully proven risks neither one working reliably by 3:30.

**If Phase 6 has time left after the mainnet stretch (or instead of it), the smallest honest version:**
- The buyer's request includes a `mode` field: `"signal"` (a bare number, for algorithmic use) or `"brief"` (the number plus a one-sentence plain-English rationale, for a research use case).
- Two schemas in `shared/signal.schema.ts` instead of one, both known upfront — not truly open-ended adaptation, but a real, demoable instance of "the response shape depends on what was asked."
- The QA layer picks which schema to validate against based on the `mode` the buyer originally requested, which it already knows (it made the request) — so this doesn't actually require QA to guess the promised shape, sidestepping the hard version of the problem while still showing the real idea.

This is worth mentioning to judges as "here's exactly how this generalizes" even if it isn't built — it shows the team understands the gap between demo and product, which tends to land better than pretending there isn't one.

---

## 18. Risk register

| # | Risk | Status | Mitigation | Caught by |
|---|---|---|---|---|
| R1 | Hosted facilitator doesn't accept our EIP-1271 blob in a live buyer→seller flow (not just a fork-test call) | ⚠️ The contract side is now proven twice; the *live facilitator service* talking to a *live Worker* is still untested | Tested at G2. Fallback: run the facilitator in-process, or call `claimWithSignature` directly | `x402.integration.test.ts` |
| R2 | SDK doesn't bundle cleanly for Workers | ⚠️ unverified | `nodejs_compat`; avoid file-storage subpaths | `wrangler dev` boot, Phase 2 start |
| R3 | Batch revert blocks honest claims | ✅ confirmed, fixed | `maxClaimsPerBatch: 1` | design constant |
| R4 | Seller rewrites the blob to dodge revocation | ✅ found, fixed, **now verified on two live chains** | §2.1 | `test_tamperedBlob_isRejected_byRealEscrow` |
| R5 | Public RPC throttling | ✅ a known failure mode of public RPC endpoints under load | Dedicated RPC + retries | flaky (not failing) tests |
| R6 | Brainbase API shape unconfirmed | ✅ resolved (2026-09-28): a working `enma-ops-narrator` Brainbase agent was built and proven live in Slack, but its runtime send-message API is undocumented and task/thread-based, not a push endpoint — swapped for a direct Slack Incoming Webhook instead, given the hackathon time budget | §13 correction | Phase 4 research pass |
| R7 | Jev key issues | Locked as provided (D4) | — | Phase 0.9 smoke call |
| R8 | Stripe sandbox crypto access | ✅ resolved: dropped for this hackathon (manual approval gate, no fake-deposit test helper exists) — its own fallback (Slack-only P&L) is now the plan | §13 correction | Phase 4 research pass |
| R9 | Venue NAT — no IP-based bans | ✅ | Ban by payer address, never IP | `ledger.test.ts` |
| R10 | Faucet limits | 📄 20 USDC/2h/address | Fund early | Gate G0 |
| R11 | **CDP signup speed unknown** *(new)* | ⚠️ the one open unknown in the mainnet stretch | Test it in Phase 0.11, in parallel, so it's known long before it would block anything | Phase 0.11 |
| R12 | Solo build, single point of failure on time | ✅ certain given D1 | Sequential phase gates, explicit stretch goals that shed cleanly if time runs out | the schedule itself |
| R13 | `openTab` config diverges from the seller's live 402 terms | ✅ spec rule | Build `cfg` from the live 402, never hard-code | `openTab.integration.test.ts` |

---

## 19. Costs

| Item | Cost |
|---|---|
| Base Sepolia gas, USDC | Free (faucets); facilitator pays claim gas on testnet |
| Base mainnet gas (if the stretch lands) | ✅ measured live today: 0.006 gwei — effectively free even for real transactions |
| CDP facilitator (if the stretch lands) | ✅ verified: first 1,000 settlements/month free, $0.001 after — a demo costs $0 |
| Claude per fresh transform | ~0.7¢ (Opus 5, effort low) — but **most requests in a busy minute cost $0**, served from AI Gateway's cache |
| Jev per QA call | negligible, sub-cent |
| Whole demo, testnet only | under $2 |
| Whole demo, with the mainnet stretch | still under $3 — a few cents of real USDC plus the same API costs |

---

## 20. Verification ledger

| Claim | How it was verified |
|---|---|
| Escrow deployed identically on Base Sepolia **and** Base mainnet | `eth_getCode` on both, live, today |
| The exact same `EnmaGuard`/`EnmaCollector` contract works unmodified on both networks | Full 4-test fork suite run against both, live, today — 4/4 green each time |
| The security fix (seller identity from `channelReceiver`, not the blob) actually rejects a tampered proof | `test_tamperedBlob_isRejected_byRealEscrow`, green on both networks |
| The headline claim (revoke after signing → real claim reverts) | `test_revokeAfterSigning_claimReverts_onRealEscrow`, green on both networks |
| Foundry install time | timed live: ~14 seconds |
| Full contract-to-green-tests time | timed live: ~40 minutes total |
| `cf-aig-cache-ttl` / `cf-aig-cache-key` headers exist and do exactly this | Cloudflare AI Gateway docs, read directly |
| `paidTool` only supports `exact`, never mentions batch-settlement | the real `agents@0.24.0` npm package, downloaded and grepped directly |
| Base mainnet gas price | `eth_gasPrice`, live, today: 0.006 gwei |
| CDP facilitator free tier | Coinbase's own announcement, first 1,000/month free |
| CDP account signup speed | **not verified** — flagged honestly as open, tested in Phase 0.11 |
| Jev's exact request/response shape (`POST /v1/systemone`, `noul`/`score` types) | official TypeSafe API docs, read directly |
| Base Sepolia USDC vs. Base mainnet USDC are different contract addresses | confirmed via `eth_call` on both, live, today |

---

## 21. Sources

- `contracts/{src,test}`: `EnmaGuard.sol`, `EnmaCollector.sol`, `EnmaGuard.t.sol`, `EnmaGuardMainnet.t.sol` — all four tests green on both Base Sepolia and Base mainnet forks
- x402 repo: `typescript/packages/mechanisms/evm/src/batch-settlement/**`, `contracts/evm/src/x402BatchSettlement.sol`
- Facilitator capability lists (live): `https://x402.org/facilitator/supported`
- Cloudflare: AI Gateway caching docs · Agents SDK `agents@0.24.0` package (downloaded, inspected directly) · Durable Objects free-plan docs
- Coinbase: CDP facilitator fee announcement · CDP portal signup page
- Jev: `https://docs.typesafe.ai/api`
- Stripe: deposit-mode + `simulate_crypto_deposit` docs
- Brainbase: API + orchestrations docs
