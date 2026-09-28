# Enma x402: Research Dossier

Research date: 2026-09-28 (hackathon day). Everything marked **verified** was checked live today against a real endpoint, source file or chain. Everything else is cited to its source. Where a claim in the original project plan does not hold up, this document says so.

**Contents**

1. [TL;DR: what changes](#1-tldr-what-changes)
2. [The event](#2-the-event)
3. [x402 end to end](#3-x402-end-to-end)
4. [Reference implementation teardown](#4-reference-implementation-teardown)
5. [What to take from it, and what to fix](#5-what-to-take-from-it-and-what-to-fix)
6. [Sponsors, one by one](#6-sponsors-one-by-one)
7. [Non-sponsor dependencies: Intercepta and Jev](#7-non-sponsor-dependencies-intercepta-and-jev)
8. [Language and stack decision](#8-language-and-stack-decision)
9. [Fact-check of the original project plan](#9-fact-check-of-the-original-project-plan)
10. [Agentic concepts the project touches](#10-agentic-concepts-the-project-touches)
11. [Deeper sponsor integration ideas, ranked](#11-deeper-sponsor-integration-ideas-ranked)
12. [Risks and open questions](#12-risks-and-open-questions)
13. [Sources](#13-sources)

---

## 1. TL;DR: what changes

1. **The escrow doesn't need mocking.** Coinbase's `x402BatchSettlement` escrow (`0x4020074e9dF2ce1deE5A9C1b5c3f541D02a10003`) is deployed on **Base Sepolia**. The free `https://x402.org/facilitator` advertises `batch-settlement` on `eip155:84532` (both **verified** today). So Enma can run on the real contract, on testnet, with free test USDC. That's much more credible than an Express "ledger".
2. **"The agent revokes the IOU" is not an x402 feature.** A batch-settlement voucher stays claimable for as long as the escrow holds a balance. The only way to cancel a signed voucher is a trick borrowed from a prior claim-time-payer design we studied as a reference: make the channel's payer an **EIP-1271 smart contract** that the escrow asks *"is this signature valid?"* at **claim time**, and have that contract read a revocation flag. Enma has to adopt that mechanism. It's the core of the product.
3. **That reference design does not check data quality.** It revokes when an Intercepta risk score changes or when a human (or Claude, through an MCP tool) presses "close tab". Automated QA (schema check, then Jev) that triggers the on-chain revocation is Enma's real novelty on top of that mechanism.
4. **Jev is not deterministic.** It's TypeSafe AI's *probabilistic* judgment model ("probabilities and scores are predictions, not proof"). The deterministic referee has to be plain schema validation. Jev is a second, semantic layer.
5. **Use TypeScript, not Rust or Python.** The official batch-settlement **server + client + ChannelManager** exist in `@x402/evm` (TS). Cloudflare Workers, Durable Objects and the Agents SDK are TS-first. The reference implementation we studied is written in Rust targeting axum on Railway, which doesn't run on Workers — its **Solidity contract** is the one part worth carrying forward, under its permissive MIT license.
6. **The real build window is about 5 hours, not 8.** Hacking runs 9:30 AM to 3:30 PM, minus lunch (12:30) and the sponsor panel (1:00–1:45).
7. **Several add-ons need reframing:** Azure isn't a sponsor (use Cloudflare's MCP servers). Workers can't get a "fresh IP". Rotating IPs to dodge an upstream rate limit is ToS evasion and bad optics. Intercepta data is mainnet-only, so "switch the agent's wallet to a scammer address" can't work as written (you don't hold that key).

---

## 2. The event

Source: the [Luma page](https://luma.com/g42o84ln).

| | |
|---|---|
| Name | Startup Speedrun Hackathon, **presented by Brainbase Labs** |
| Venue | Cloudflare HQ, 101 Townsend St, San Francisco |
| Schedule | 9:30 kickoff · 12:30 lunch · 1:00–1:45 panel (Stripe, Cloudflare, Taste Labs) · **3:30 hacking ends** · 3:30–5:00 judging |
| Tracks (may be combined) | **Agentic Payments** (agents transact, buy, sell, provision services, manage budgets) · **Agents That Deploy Infrastructure** (idea → production: provision, deploy, domains, operate) · **Autonomous Organizations** (teams of agents coordinating through Slack, Linear and similar tools) |
| 1st prize | $2,000 cash, $3,000 Brainbase credits, $2,500 Cloudflare credits, up to $4,000 Anthropic credits, Stripe Atlas incorporation, $3,000 Stripe credits |
| Judging criteria | Not published. Assume "how much of a functioning startup" plus sponsor fit. |

**Strategic read:** Brainbase is the host. Enma's plan currently treats it as an add-on, which is the biggest strategic gap. The Autonomous Organizations track is literally Brainbase's product (orchestrations with Slack and Linear surfaces). Enma should run its operating agents on Brainbase (§11).

---

## 3. x402 end to end

### 3.1 The base protocol (v2)

x402 revives HTTP `402 Payment Required`. All protocol messages travel as **base64-encoded JSON in headers**:

| Header | Direction | Carries |
|---|---|---|
| `PAYMENT-REQUIRED` | server → client, on a 402 | `{x402Version: 2, resource, accepts: [PaymentRequirements…]}` |
| `PAYMENT-SIGNATURE` | client → server, on the retry | `{x402Version, accepted, payload}` |
| `PAYMENT-RESPONSE` | server → client, on success | settlement receipt (`success`, `transaction`, `network`, `payer`, `extra`) |

A `PaymentRequirements` entry has `scheme`, `network` (CAIP-2, e.g. `eip155:84532` for Base Sepolia), `amount` (atomic units as a string, USDC has 6 decimals, so `"10000"` = $0.01), `asset`, `payTo`, `maxTimeoutSeconds` and scheme-specific `extra`.

A **facilitator** is a service with `/verify`, `/settle` and `/supported` endpoints. It checks signatures and broadcasts transactions so the resource server needs no chain code. It never holds funds. `https://x402.org/facilitator` is **testnet-only and free**. For mainnet, use CDP's facilitator (needs CDP API keys) or another one.

### 3.2 Schemes

| Scheme | How money moves | Reversible after signing? | Fit for Enma |
|---|---|---|---|
| `exact` | EIP-3009 `transferWithAuthorization`. **Signing is spending.** Settled per request. | No | Simple, but no QA window. Useless for the escrow idea. |
| `upto` | Authorize a max, settle actual usage. | No | Nice for variable pricing. No QA window. |
| **`batch-settlement`** | Deposit once into an escrow channel, then sign off-chain **cumulative vouchers** per request. The seller `claim`s in batches later and `settle`s to its wallet. | **Only if the payer is an EIP-1271 contract that says no at claim time** | **The one Enma needs** |
| `batch-settlement` on `cloudflare:402` | Cloudflare is merchant of record. Requests are signed with HTTP Message Signatures (RFC 9421 / Web Bot Auth) and billed in fiat. | Trusted intermediary | Interesting for seller-side identity (§6.2). |

### 3.3 Batch-settlement in detail (EVM)

From [`scheme_batch_settlement_evm.md`](https://github.com/x402-foundation/x402/blob/main/specs/schemes/batch-settlement/scheme_batch_settlement_evm.md) and a prior open-source reference implementation studied for this design:

**Channel identity.** An immutable `ChannelConfig {payer, payerAuthorizer, receiver, receiverAuthorizer, token, withdrawDelay (uint40), salt}` is hashed under the EIP-712 domain `"x402 Batch Settlement"` into a `channelId`.

**Roles.**
- `payer` funds the channel. It can be an EOA or a smart wallet.
- `payerAuthorizer` is the EOA that signs vouchers. **If it's `address(0)`, the escrow validates every voucher through EIP-1271 `isValidSignature` on `payer`.** That's the hook everything in this project hangs on.
- `receiver` gets paid. `receiverAuthorizer` signs claims and refunds and must be non-zero.

**Lifecycle.**
1. **Deposit.** The first request funds the channel via ERC-3009 or Permit2 through a *deposit collector* (`ERC3009DepositCollector 0x4020806089470a89826cB9fB1f4059150b550004`, `Permit2DepositCollector 0x4020425FAf3B746C082C2f942b4E5159887B0005`). The TS client deposits `extra.minDeposit`, or `amount × depositMultiplier` (default 5).
2. **Voucher.** Each request signs `Voucher(bytes32 channelId, uint128 maxClaimableAmount)`, and the amount **only goes up**: it equals the charged total so far plus this request's price. The server rejects anything else. Newer vouchers supersede older ones, so no nonces are needed.
3. **Claim.** `claimWithSignature(VoucherClaim[], authorizerSig)` updates on-chain `totalClaimed`. **No tokens move yet.** One transaction can claim many channels.
4. **Settle.** `settle(receiver, token)` sweeps claimed funds to the receiver.
5. **Refund.** A cooperative refund returns `balance − totalClaimed`, signed by `receiverAuthorizer`.
6. **Withdraw.** The unilateral escape hatch: `initiateWithdraw` → wait `withdrawDelay` (**900 s to 2,592,000 s, i.e. 15 minutes to 30 days**) → `finalizeWithdraw`. The delay exists to give the *seller* time to claim first.

**Where the "QA window" really comes from.** It is **not** a protocol constant. It's the time between a voucher being signed and the seller choosing to claim it. A reference deployment measured active mainnet sellers claiming every **1–5 minutes** (median), while some go days without claiming. Because Enma *is* the seller, Enma sets it: the TS `ChannelManager.start({claimIntervalSecs})` knob. §5.3 shows how to make the window **enforced on-chain** instead of promised.

**Security notes from the spec.** Vouchers carry no expiry. Clients are exposed up to the signed ceiling. Separate type hashes for Voucher, Refund and ClaimBatch prevent cross-replay. The escrow needs EIP-1153 transient storage.

### 3.4 Official SDK support (verified in the repo today)

`git clone x402-foundation/x402` shows:

| Language | Batch-settlement support |
|---|---|
| **TypeScript** | `@x402/evm/batch-settlement/{client,server,facilitator}` plus file and **Redis storage adapters**, a `ChannelManager` for claim/settle/refund cron, cooperative refund, and corrective-402 recovery. **`ChannelStorage` is a pluggable interface**, so a Durable Object adapter is feasible. |
| Go | client, server, facilitator |
| Python | `python/x402/mechanisms/evm/batch_settlement/{client,server,facilitator}` exists, plus httpx examples. The docs FAQ still says "planned", so it's newer and less proven. |
| Rust | **none official.** The reference implementation we studied hand-rolled its own wire types. |

TS server skeleton (from the package README):

```ts
const scheme = new BatchSettlementEvmScheme(receiverAddress, {
  receiverAuthorizerSigner, withdrawDelay: 900, storage /* ChannelStorage */,
});
const server = new x402ResourceServer(facilitatorClient).register("eip155:84532", scheme);
const manager = scheme.createChannelManager(facilitatorClient, "eip155:84532");
manager.start({ claimIntervalSecs: 60, settleIntervalSecs: 300, refundIntervalSecs: 3600 });
```

TS client: `new BatchSettlementEvmScheme(signer, { depositPolicy: { depositMultiplier: 5 }, voucherSigner? })` registered on `x402Client`.

⚠️ **The SDK's EIP-1271 voucher gotcha.** The client README suggests *delegating* voucher signing to an EOA `payerAuthorizer` "for better performance" with smart wallets. **Enma must NOT do that.** A non-zero `payerAuthorizer` bypasses `isValidSignature`, and with it the whole revocation mechanism. EnmaGuard's channels use `payerAuthorizer = address(0)` on purpose, and `EnmaCollector` enforces it.

### 3.5 Testnet reality check (verified)

```
GET https://x402.org/facilitator/supported
→ {"x402Version":2,"scheme":"batch-settlement","network":"eip155:84532"}  ✓
→ facilitator EVM signer 0xd407e409E34E0b9afb99EcCeb609bDbcD5e7f1bf

eth_getCode(0x4020074e…0003) on https://sepolia.base.org → bytecode present ✓
```

- Test USDC comes from the Circle faucet. The guardian and receiver keys need a little Base Sepolia ETH for gas.
- A known lesson from prior deployments on this network: public RPCs rate-limit hard (`mainnet.base.org` has been observed returning HTTP 429 mid-test elsewhere). **Get a free Alchemy or QuickNode Base Sepolia endpoint at kickoff.**

---

## 4. Reference implementation teardown

We studied one prior open-source implementation of this exact mechanism in depth, as a design reference — not reused, cloned into the repo, or vendored in any form; its identity is deliberately omitted here.

### 4.1 What it is

A wallet contract for AI agents where a payment can still be stopped after it has been made. Everything runs on **Base mainnet with real USDC** against Coinbase's real, deployed escrow.

### 4.2 Stack (the part the user asked about)

| Layer | Tech | Notes |
|---|---|---|
| Contracts | **Solidity 0.8.24 + Foundry** | A single ~290-line payer contract plus a substantial fork-tested suite (40+ tests, forking **real** Base, OP and Arbitrum) |
| Backend | **Rust**: `axum`, `tokio`, an EVM signing/reading library, an HTTP client, an OIDC client for human-approval flows, an MCP server library | A multi-crate workspace with a large accompanying unit-test suite |
| Frontend | React + Vite + TS, wallet-connect | — |
| Hosting | A container platform + a static-site host | Not Cloudflare |
| Third-party risk/identity services used | A wallet risk-screening API, an OIDC human-approval identity provider | Specific to that build's own sponsor set, not ours |

So that implementation chose Rust for its services and Solidity for its contract. There's no Python anywhere in it.

### 4.3 The mechanism, precisely

```
Agent (hot key) ──asks──► a risk-scoring backend (oracle key, screening API, identity provider)
     │                        │  verdict ∈ {Pay, Cap, Ask(human), Refuse}
     │                        ▼
     │  voucher sig blob = abi.encode(agentSig, oracleSig, seller, expiry)
     ▼
Seller ──serves data first, holds the voucher──► later: claimWithSignature
                                                        │
Coinbase escrow ──isValidSignature(digest, blob)──► the payer contract
   checks: 1 agent signed · 2 oracle countersigned (digest, seller, expiry)
           3 not expired · 4 seller NOT revoked · 5 wallet NOT paused
   → 0x1626ba7e (pay) or 0xffffffff (claim reverts)
```

The core idea in one sentence: checks 4 and 5 read **live storage at claim time**, so `revoke(seller, reason)` (callable by the owner or the oracle, about 30k gas) makes every unclaimed voucher to that seller worthless, *even though it was already signed*.

Details worth copying:
- **Trust model.** The oracle holds a veto, never the funds. Agent key alone: can't move money. Oracle alone: can only block. If the oracle disappears, the owner recovers funds via `initiateWithdraw`/`finalizeWithdraw` after `withdrawDelay`.
- **The tab-opening function** approves the deposit collector for exactly the deposit, then resets it to 0, so no standing allowance is ever left.
- **The deposit collector** only pulls into channels where `payer == wallet && payerAuthorizer == 0`. The reference build **found an attack on a mainnet fork**: without that check, a stranger opens a channel funded by your allowance, names *themselves* the authorizer, and claims it all. (This is exactly the hole `EnmaCollector` is built to close — see §2.1 of PLAN.md.)
- **Malleability-safe `ecrecover`** (rejects high-`s`).
- **Reason codes** stored on-chain on revoke: sanction, known scammer, rug pull, wallet drainer, phishing, mixer, honeypot, other.

### 4.4 Seller side, in that reference build

- Implements the spec's verification rules with the exact spec error codes. The voucher must equal `charged + price`, must not exceed the escrow balance, and must be above `totalClaimed`. It sends a **corrective 402** carrying channel and voucher state when the client is out of sync.
- **Payer screening sets a credit line, not a yes/no**: low risk score → trusted, can carry up to 1 USDC unclaimed · mid → "careful", claim after *every* request · high → refuse outright.
- **Before serving, the seller calls `isValidSignature` itself**, so it sees a revocation the same way the escrow will.
- **Claims are simulated first**, so a rejected claim costs no gas and produces a readable reason: *"CLAIM REJECTED by the escrow … the payer's wallet revoked this seller … after we had served the requests."*
- **Demo determinism:** a configurable "go rogue after N paid calls" mode — after that many calls it serves obviously-junk data but keeps charging. (This is the direct ancestor of Enma's own rogue-seller mode.)

### 4.5 Buyer side, in that reference build

- **Policy engine.** Four verdicts map to its screening provider's brief ("pay, refuse, cap or ask a human"). Configurable thresholds for refuse, ask, cap, an autonomous spending limit, and a max price per call.
- **Multiple screening calls per payment:** payee address risk, token risk (fake-stablecoin check), and a check on the payment authorization itself.
- **A watcher loop** re-screens every open tab on an interval and auto-revokes when a score crosses the refuse threshold.
- **Human approval** via an OAuth device-authorization flow. An approval is bound to the voucher digest and used once. The spending budget is keyed on the human, not the agent, so multiple agents run by one person share one limit.
- **An MCP server** with tools to find services, check a seller's risk, buy, wait for a pending human approval, list open tabs, and close a tab. The close-tab tool's description reads roughly: *"Use when a seller sells junk or looks wrong."* **This is the only junk detector in that design: the LLM's own judgment, prompted by a tool description** — nothing automated checks the data itself. This is the gap Enma's QA Judge exists to fill.
- **Marketplace discovery** against a public x402 listings API: 1,000+ listings, hundreds of distinct sellers, a median price around $0.01, and a long tail of wildly mispriced listings — the "why a guard matters" statistic for that build.

### 4.6 Measured numbers published by that build

| | |
|---|---|
| `claimWithSignature` through EIP-1271 | 164,645 gas (~$0.0027 on Base) |
| `revoke` | ~30,000 gas (~$0.0005) |
| Whole mainnet demo | ~$0.0065 |
| Channels on the escrow, at the time they measured it | 1,724 from 201 payers to 75 sellers |
| Payers that were policy contracts before that build shipped | none |

---

## 5. What to take from it, and what to fix

### 5.1 Take (good parts)

| # | Take | Why |
|---|---|---|
| T1 | **The EIP-1271 claim-time gate on Coinbase's real escrow.** Fork the reference design's payer contract and collector (MIT). | It's the only real way to "revoke an IOU". "We didn't write the escrow" is what makes the guarantee credible. |
| T2 | `payerAuthorizer = 0` enforcement in the collector | Closes the allowance-theft hole they found on a fork. |
| T3 | Seller pre-checks `isValidSignature` before serving, and simulates before claiming | Gives Enma's seller-protection a signal for free, and costs no gas on rejection. |
| T4 | Score → credit line on the seller | The *correct* seller defense (§5.2, MAD critique). |
| T5 | Fail closed when screening is down, with an explicit reason | Judges trust guards that don't silently open. |
| T6 | Rogue-after-N knob for a deterministic demo | Makes "The Save" reproducible on stage. |
| T7 | Spec-exact headers and error codes, plus the corrective 402 | Interop with any x402 client. The TS SDK gives this for free. |
| T8 | One `.env.example` per service; secrets redacted in logs | Speed and safety. |
| T9 | README with measured numbers, tx links, diagrams, and a **"sponsor feedback" section** | Judges and sponsor DevRel love it. Cheap to do. |
| T10 | MCP server so Claude can be the buyer | Easy Anthropic points, natural demo ("ask Claude to buy AAPL sentiment"). |

### 5.2 Fix (their mistakes and limitations, and how Enma differs)

| # | Limitation in that reference design | Enma's answer |
|---|---|---|
| F1 | **No automated QA.** Revocation needs a risk-score change or a human or LLM "close tab" call. Junk data alone never triggers anything. | **QA Judge**: deterministic schema and invariant check → Jev semantic check → automatic `revoke`/`capChannel` tx. This is the headline feature. |
| F2 | **All-or-nothing, per seller.** Revoking kills payment for the good calls too. Their own docs warn *"Do not revoke an honest seller after it served you."* | **QA-precise cap** (stretch, §5.3): per channel `approvedCeiling`, so the buyer pays for the calls that passed QA and refuses only the bad ones. |
| F3 | **The window is whatever the seller feels like.** A seller that claims every block defeats revocation (their Known Limitation #1). | ~~On-chain QA window~~ **dropped** (see §5.3 note). Enma controls its own claim cadence and publishes it as policy. |
| F4 | Buyer-only protection. The seller has only a credit line. | **Mutual protection**: the seller tracks each payer's *revocation ratio*; abusers get a zero credit line, then an edge ban. |
| F5 | Oracle co-signature and World ID add a lot of surface (World device flow is sandbox-only). | Drop World ID and make the oracle co-sign optional. Human approval moves to **Slack via Brainbase** (a sponsor). |
| F6 | Mainnet plus real money makes judges wary and adds deploy friction. | Base Sepolia with the real escrow and facilitator. A mainnet toggle only for the Stripe demo (§6.3). |
| F7 | Rate-limited public RPC cancelled a revocation mid-run. | Dedicated RPC plus retry/backoff on every chain write. |
| F8 | Intercepta quota (1,000 calls) burned by the polling watcher. | Cache verdicts (1 h for tokens, 5–10 min for addresses). Screen on first contact and at claim time only. |
| F9 | One operator ran both signing keys. | Separate the guardian key (buyer side) from the receiver key (seller side), even in the demo. Say so in the pitch. |
| F10 | README shipped with a `YOUR_VIDEO_ID` placeholder. | Record the demo video *before* 3:30. |

### 5.3 The two contract upgrades (the novel part)

Both slot into EnmaGuard's `isValidSignature`. Both are **pure view reads**, which the escrow's static call allows. (A limitation shared with every design like this: no external API calls are possible inside the check.)

**(a) QA-precise cap.** The blob gains the voucher's `channelId` and `maxClaimableAmount`. The contract recomputes `escrow.getVoucherDigest(channelId, amount) == digest`, then requires `amount <= approvedCeiling[channelId]` whenever the channel is capped. When QA fails on request *n*, the guardian calls `capChannel(channelId, cumulativeThrough(n-1))`.
Caveat: the seller must then claim with the **older** voucher for exactly that ceiling. The SDK's server storage keeps only the latest voucher, so Enma's seller needs a small voucher-history table (in a Durable Object). Because Enma owns the seller, that's in our control.

**(b) On-chain QA window. ❌ DROPPED after verification (see PLAN.md §2):** the facilitator verifies every fresh voucher through the same `isValidSignature`, so this check would reject every payment at request time. Original idea, kept for the record: The agent signs an extra `Attestation(digest, signedAt)`. The contract rejects the claim while `block.timestamp < signedAt + qaWindow`. That makes "the seller can't cash in before QA had a chance" a contract guarantee, not a promise.
Caveat: each new cumulative voucher restarts its own clock. A busy channel should claim using an older voucher whose window has passed, which again needs the voucher history.

**MVP recommendation (updated):** ship per-seller revoke, with the seller derived from `channelReceiver[channelId]` rather than the blob (security fix, PLAN.md §2). (b) is dropped; (a) stays a Could.

---

## 6. Sponsors, one by one

### 6.1 Anthropic (Claude)

**Role in Enma:** the *transformer*. Raw upstream data → proprietary signal (for example `{asset: "AAPL", sentiment_index: 85.0, confidence, n_sources, window}`).

- Force the output shape with **tool use / structured output**, so the transformer can't emit prose. The same JSON Schema is reused by the QA judge. **One schema, three consumers**: transformer, 402 `resource` description, QA.
- Model choice: `claude-haiku-4-5-20251001` for per-request latency and cost; `claude-sonnet-5` if quality matters for the demo payload. (Model IDs per the environment.)
- **Unit economics:** at $0.01 per request, a per-request LLM call can eat the margin. **Transform once per (asset, time bucket) and serve many buyers from cache.** That's the arbitrage story told in numbers.
- Call Claude **through Cloudflare AI Gateway**: caching, logs, rate limiting, spend analytics. That's a Cloudflare integration point for free.
- **Second Anthropic surface:** Claude as the *buyer* through an MCP server (per the buyer-side MCP pattern in §4.5), and Claude Code as the builder.

### 6.2 Cloudflare (the venue)

| Capability | Use in Enma | Doc |
|---|---|---|
| **Workers + Hono** | Seller proxy. `@x402/hono` middleware plus the batch-settlement server scheme. | Agents docs → x402 → Charge for HTTP content |
| **Durable Objects** | (1) implement the SDK's `ChannelStorage` interface on a DO, giving strongly consistent per-channel state; (2) voucher history for the §5.3 upgrades; (3) per-payer revocation ratio and ban list; (4) **WebSocket hub for the live dashboard** (hibernation API). | |
| **Cron Triggers / DO alarms** | Replace `ChannelManager.start()` timers, which Workers can't hold. Run claim, settle and refund rounds on alarms. | |
| **AI Gateway** | In front of Anthropic. | |
| **WAF custom rules + Lists API** | The Worker computes the revocation ratio; when a payer crosses the threshold, it pushes the IP (or other signal) into a **Custom List** that a WAF rule blocks. That's a *real* edge drop, done by an agent: the Infrastructure track. The WAF has no native "revocation rate" rule, so this has to be Worker logic plus the Lists API. | |
| **Agents SDK x402** | `withX402Client` (MCP client that auto-pays, with an `onPaymentRequired` human-approval hook), `paidTool` (charge per MCP tool call). **Note:** the docs list the `exact` and `upto` schemes for these helpers, so for batch-settlement use `@x402/*` directly. | Agents docs → Payments |
| **Web Bot Auth / `cloudflare:402` network** | A `batch-settlement` variant where Cloudflare is merchant of record and requests are signed with RFC 9421 HTTP Message Signatures from a registered `Signature-Agent`. **This is the answer to Sybil-cheap wallet bans**: ban the *signature agent identity*, not the throwaway wallet. Pitch as the roadmap. | x402 spec `scheme_batch_settlement_cloudflare.md` |
| **Monetization Gateway** | Charge for any resource via rules, without code. Waitlist only; mention as the roadmap. | Cloudflare blog |
| Cloudflare co-founded the **x402 Foundation** with Coinbase. | Say it in the pitch. | Cloudflare blog "x402" |

### 6.3 Stripe

Facts ([docs.stripe.com/payments/machine/x402](https://docs.stripe.com/payments/machine/x402)):
- Create a **crypto deposit address** (`POST /v1/crypto/deposit_addresses`, `network=base`) and use it as the x402 `payTo`.
- After the facilitator settles, record the tx as a **PaymentIntent** with `payment_method_options.crypto.mode = "transaction_verification"` and the `transaction_hash`. Needs `Stripe-Version: 2026-05-27.preview`.
- **Constraints:** needs the *Stablecoins and Crypto* payment method **approved** (a review, so request it at kickoff). It's **live mode, mainnet only**. Networks are Base, Solana and Tempo (USDC). The guide uses the **`exact`** scheme and the CDP mainnet facilitator.
- **Machine Payments Protocol (MPP)**, launched by Stripe and Tempo on 2026-03-18: Stripe's own agent-billing protocol, which also accepts **cards**. The Cloudflare Agents SDK has MPP support too.
- **Climate Orders API**: `POST /v1/climate/orders {product, amount | metric_tons}`, paid from the Stripe balance.

How to use Stripe honestly in Enma, ranked:
1. **Revenue ledger.** Every settled x402 claim → a Stripe record. On mainnet use the real PaymentIntent (`transaction_verification`). On testnet, mirror claims into Stripe *test mode* (Billing meter events or test PaymentIntents), clearly labelled "testnet mirror". **Verify at kickoff** whether test mode accepts crypto PaymentIntents.
2. **One real mainnet $0.01 x402 payment** through a Stripe deposit address, shown in the Stripe Dashboard. That's the "it's real" moment, if approval lands in time.
3. **COGS side.** Enma's upstream Web2 subscription billed through Stripe, which gives a P&L: x402 revenue − Stripe-billed data cost − Claude cost.
4. **Climate.** Per-payment fiat bridging is impractical (fees dwarf $0.01). **Accrue** x% of settled revenue and place a Climate Order when a threshold is reached. Test mode is fine.
5. **Atlas.** The prize includes incorporation. The pitch can end with "Enma, Inc. is incorporating via Atlas."

### 6.4 Brainbase (the host)

What it is: *"the agentic operating system for your AI workforce."* Kafka is their generalist AI employee (SOTA on GAIA Level 3). Developer surface:
- **Managed Agents / Universal API**: one request and response shape across models and harnesses. Push an agent to the cloud with **one CLI command**; version agents, skills and tools like packages.
- **Orchestrations**: triggers (schedule, **webhook**, **Slack**, **Linear**, 1000+ app triggers) → edges → agent nodes. A trigger firing creates a *task* per edge, with the edge description plus the payload as the first user message.
- 3,000+ integrations, MCP servers, secrets management, browser, file system, memory, evaluations and benchmarks.
- A **Brainbase MCP server** you can connect Claude Code to.

Enma's fit (Autonomous Organizations track): run Enma's *company* as Brainbase agents coordinating in Slack. See §11.

---

## 7. Non-sponsor dependencies: Intercepta and Jev

### 7.1 Intercepta (Web3 Antivirus)

- Base URL `https://api.web3antivirus.io`, header `X-API-KEY`. Endpoints (confirmed live and working by the reference build studied in §4):
  - `GET /api/public/v2/extension/account/{addr}/quick-scan` → `{toxicScore, traits[{name, risk, description}]}`
  - `GET /api/public/v2/extension/token-intelligence/token/{addr}/risks?chainId=` → fake-token check
  - `POST /api/public/v2/extension/analysis/signature` `{from, message (JSON object, not a string), chainId}`
- ⚠️ **Mainnet data only.** A fresh Base Sepolia key scores as clean.
- ⚠️ **Key source:** the reference build used a free hackathon-specific key (1,000 calls) from that other event's sponsor allocation. **Intercepta is not a sponsor of this event.** Get a key before building on it, or treat it as optional with a local denylist fallback.
- The planned demo step "switch the agent's wallet to a known scammer address" **can't work**: you can't sign vouchers for an address whose key you don't hold. **Honest replacements:**
  1. **Buyer protects itself.** Point the buyer at a "shady seller" whose 402 `payTo` is a known-flagged *mainnet* address. The buyer screens `payTo` → refuses → no voucher is ever signed. Addresses are the same across EVM chains, so the mainnet reputation is real.
  2. **Seller protects itself.** The MAD ban list (written by Enma's own revocation-ratio logic) drops the abusive buyer at the edge. Intercepta screening of the payer runs too, but on testnet it will say "clean". Say that out loud.

### 7.2 Jev (TypeSafe AI)

- **What it is:** TypeSafe AI's "System One" model for **typed semantic judgments**. Primitives: `Choice`, `Score`, `Noul` (yes/no with probability). Python client (`jev`), CLI, and community MCP packages (`jev-agent-tool` is community, *not* official). Needs a TypeSafe API key. Fast and cheap, "a fraction of a cent", "fast enough for the agent loop".
- **It is probabilistic, not deterministic.** Its own docs say "probabilities and scores are predictions, not proof." The original plan's label "Deterministic Pipeline Governor … incorruptible referee" is wrong.
- **Correct layering for the QA Judge:**
  1. **Deterministic gate** (Zod or ajv against the shared JSON Schema, plus invariants: `0 ≤ index ≤ 100`, ticker regex, `window_end` fresh within N s, `n_sources ≥ 1`, no sentinel strings like `"error"`, `"N/A"`, `"¯\\_(ツ)_/¯"`). **Fail → revoke. No appeal.**
  2. **Semantic gate** (Jev `Noul`: "Is this a genuine market signal rather than placeholder, stale or fabricated data?"). Revoke only if `p(bad) ≥ 0.9`; otherwise flag and log.
  3. Log both verdicts with the request fingerprint Jev returns, so any revocation is auditable.
- Not a listed sponsor. Keep it, but it's a dependency, not prize leverage.

---

## 8. Language and stack decision

The user asked whether to move to Rust (the language a prior reference implementation used) or anything else.

| Option | For | Against | Verdict |
|---|---|---|---|
| **TypeScript everywhere** (Workers, DOs, dashboard, buyer agent) + **Solidity** (Foundry) | Official batch-settlement server, client and ChannelManager; Workers are JS-first; Cloudflare Agents SDK; Hono x402 middleware; viem; one language for the whole team. | Must write a DO `ChannelStorage` adapter and alarm-driven claims. | ✅ **Recommended** |
| Rust | The prior reference implementation's Rust code (x402 v2 types, EIP-712, a risk-screening client) is tested and spec-exact. | Built for axum/tokio on a container host, not Workers. `workers-rs` + `alloy` compiled to wasm is an 8-hour risk. No official Rust SDK for batch-settlement. | ❌ Only worth studying as a *reference*, not reusing |
| Python buyer (original plan) | The plan already assumed it; `x402` Python now has batch_settlement. | Newest, least-proven SDK; a second language; `eth-account` alone isn't enough. | ⚠️ Fine as a fallback |
| Solidity contract | Needed for the EIP-1271 gate; `EnmaGuard` builds on the mechanism studied in §4. | — | ✅ Required |

**Recommended stack:**
- `contracts/`: Foundry. `EnmaGuard.sol` is a fork of the reference design with QA hooks. Deploy to Base Sepolia. Fork tests against the real escrow.
- `seller/`: Cloudflare Worker (Hono, `@x402/hono`, `@x402/evm/batch-settlement/server`), Durable Objects (channel storage, voucher history, payer ledger, WS hub), Anthropic via AI Gateway.
- `buyer/`: Node or TS agent (`@x402/evm/batch-settlement/client`, viem), the QA Judge (ajv + Jev), guardian key that sends `revoke`/`capChannel`. Optionally exposed as an MCP server for Claude.
- `dashboard/`: static page (Workers Assets) with a canvas/WebGL flow view fed by the DO WebSocket.
- `ops/`: Brainbase agent definitions and orchestration configs.

---

## 9. Fact-check of the original project plan

| # | Plan says | Reality | Action |
|---|---|---|---|
| 1 | Seller "cashes in the IOU later (batch-settlement)" | ✅ Correct | — |
| 2 | "The agent immediately revokes the IOU" | ❌ Not a protocol feature. Needs an EIP-1271 payer contract, per the mechanism in §4. | Adopt the EnmaGuard contract. |
| 3 | "5-minute batch-settlement window" | ⚠️ Not a protocol constant. It's the seller's claim cadence. `withdrawDelay` (15 min–30 d) is a different thing. | Configure the claim cadence (DO alarm). The on-chain window was dropped. |
| 4 | Escrow Ledger = mocked Node/Express DB "for the sake of 8 hours" | ⚠️ Unnecessary. The real escrow and facilitator work on Base Sepolia (**verified**). | Use the real contract. The Worker DO keeps the *view* state only. |
| 5 | Buyer in Python (`requests`, `eth-account`) | ⚠️ Works now, but TS is the primary SDK. | Switch to TS. |
| 6 | Jev = "deterministic … incorruptible referee" | ❌ Jev is probabilistic. | Deterministic schema gate first, Jev second. |
| 7 | Cloudflare WAF "detects high revocation rate" | ⚠️ No native rule. | Worker + DO logic → WAF Custom List via API. |
| 8 | Intercepta "instantly drops traffic if a buyer's wallet is flagged" | ⚠️ Mainnet-only data; key not guaranteed at this event. | Screen `payTo` on the buyer side; ban list on the seller side. |
| 9 | Demo: "switch the agent's wallet to a known scammer address" | ❌ You can't sign as an address you don't hold. | Redesign (§7.1). |
| 10 | "Seller Proxy … TRANSACTION REVERTED" | ✅ The escrow's `claimWithSignature` reverts (via `isValidSignature → 0xffffffff`). **Simulate first**, show the decoded reason, don't burn gas. | — |
| 11 | "Substantial transformation" avoids Web2 ToS suits | ⚠️ Not legal advice. Many ToS also forbid *derived* products. | Use a mock or permissively-licensed source for the demo, and say so. Keep the claim as a thesis, not a guarantee. |
| 12 | Add-on: MCP rewriting **Azure** SQL firewall and Data Factory | ❌ Azure isn't a sponsor; off-theme. | Swap for Cloudflare (Workers deploy, WAF lists) via the Cloudflare API or MCP. |
| 13 | Add-on: Stripe Climate from a fraction of each $0.01 | ⚠️ Per-payment bridging is uneconomic. | Accrue, then place a Climate Order. |
| 14 | Add-on: Brainbase provisions a new Worker "with a fresh IP" to dodge upstream rate limits | ❌ Workers egress from Cloudflare's shared pool, so you can't choose a fresh IP. Dodging a rate limit is ToS evasion. | Reframe as self-healing: redeploy, **rotate compromised keys**, fail over to a secondary source, back off. |
| 15 | "8-hour build" | ⚠️ 9:30–3:30 minus lunch and panel ≈ **5 h** | Cut scope (see PRD). |
| 16 | Anthropic, Brainbase, Cloudflare, Stripe as "core sponsors" | ✅ Brainbase is the *presenter*. | Promote Brainbase from add-on to core. |

---

## 10. Agentic concepts the project touches

- **Machine-to-machine payments / agentic commerce.** Agents can't do KYC'd subscriptions; HTTP 402 plus stablecoins give per-request, accountless payment.
- **Payment channels / state channels.** A deposit, off-chain monotonically-increasing vouchers, batched on-chain claims. Classic unidirectional channel economics: gas is paid once per batch, not per request.
- **Account abstraction / smart-contract wallets (EIP-1271).** A contract can *be* the payer and define what counts as a valid signature. That's how policy moves on-chain.
- **Claim-time vs sign-time authorization.** The key insight behind the whole mechanism (§4). Every pre-signing guard is final once signed; a claim-time guard keeps a veto until settlement.
- **Escrow and optimistic settlement.** "Serve first, pay later, dispute within a window." Close to optimistic rollups' challenge period, and to chargebacks in card networks.
- **Credit risk on the seller side.** Batch-settlement sellers extend credit on every request; risk scores set credit lines.
- **Mutually assured destruction / reputation.** Each side can hurt the other; reputation (revocation ratio) makes defection expensive. Wallet bans are Sybil-cheap, so real identity needs Web Bot Auth, World ID, deposits or credit lines.
- **Probabilistic transformer + deterministic verifier.** The generate-then-verify pattern: LLM output is never trusted until a schema or program accepts it. Jev adds a calibrated probabilistic second opinion.
- **Tool use / MCP.** Claude as the buying agent; Brainbase agents with Cloudflare, Stripe and Slack tools.
- **Human-in-the-loop.** Cloudflare's `onPaymentRequired` hook, the reference build's OIDC device-grant approval flow (§4.5), and Enma's proposed Slack approvals via Brainbase.
- **Self-healing infrastructure agents.** Detect, diagnose, redeploy, rotate, verify: the Infrastructure track.
- **Autonomous organizations.** Specialised agents (procurement, QA, treasury, SRE) coordinating on shared surfaces.
- **Data arbitrage and substantial transformation.** Buy bulk, transform, resell per request. Margin comes from caching one transformation across many buyers.

---

## 11. Deeper sponsor integration ideas, ranked

Ranked by (demo value × sponsor fit) ÷ build cost.

| Rank | Idea | Sponsors | Build cost |
|---|---|---|---|
| 1 | **Enma's company runs on Brainbase.** Four agents in one orchestration, talking in a Slack channel the judges can watch: **Procurement** (buys data, manages channel deposits), **QA Judge** (posts every verdict, triggers revokes), **Treasury** (P&L, Stripe mirror, Climate accrual), **SRE** (webhook-triggered on upstream 429s or revocation spikes; redeploys the Worker, rotates keys, updates WAF lists via the Cloudflare API). | Brainbase, Cloudflare, Stripe, Anthropic | Medium |
| 2 | **Claude buys through MCP.** An Enma MCP server with `find_signals`, `buy_signal`, `list_tabs`, `dispute`. Ask Claude "get me AAPL sentiment"; it pays via x402 and the QA judge auto-disputes junk. | Anthropic | Low (the pattern is proven, §4.5) |
| 3 | **Edge ban as an infrastructure action.** The revocation-ratio threshold makes the SRE agent write a Cloudflare WAF Custom List entry; the next request dies at the edge (show the Cloudflare event log). | Cloudflare | Low–medium |
| 4 | **AI Gateway** in front of every Claude call; the dashboard shows the cache hit rate as margin. | Cloudflare, Anthropic | Low |
| 5 | **Stripe ledger:** test-mode mirror of every claim, plus one real mainnet $0.01 PaymentIntent if approval lands. | Stripe | Low (mirror) / gated (real) |
| 6 | **Human approval in Slack** for any tab above X USDC (Brainbase Slack surface, replacing World ID). | Brainbase | Low–medium |
| 7 | **Stripe Climate accrual** with an order placed at the threshold (test mode). | Stripe | Low |
| 8 | **MPP alongside x402**, so card-funded agents can buy too. | Stripe, Cloudflare | Medium–high: roadmap |
| 9 | **Web Bot Auth identity** for seller-side bans. | Cloudflare | High: roadmap |
| 10 | **List Enma on the x402 Bazaar** (CDP discovery). | Coinbase (not a sponsor) | Low, but mainnet only |

---

## 12. Risks and open questions

| Risk | Likelihood | Mitigation |
|---|---|---|
| `ChannelManager` timers don't run in Workers | High | Drive claim, settle and refund from DO alarms or Cron Triggers. Or run the claim loop in the buyer-side Node process for the demo. |
| SDK server storage keeps only the latest voucher | High (affects §5.3) | MVP uses per-seller revoke (no history needed). Add a history table for the upgrades. |
| Facilitator verifies EIP-1271 vouchers via `eth_call` → latency and RPC limits | Medium | Dedicated RPC; small demo volume. |
| Stripe crypto approval not granted today | Medium–high | Test-mode mirror is the default path. |
| No Intercepta key at this event | Medium | Local denylist plus a `payTo` screening stub, labelled clearly. Don't fake scores. |
| No TypeSafe (Jev) key | Medium | The deterministic gate alone still triggers revocation; Jev becomes an optional layer. |
| Base Sepolia faucet or RPC throttling at the venue | Medium | Fund all keys in the first 30 minutes. |
| ~5 h build window | Certain | Scope per the PRD's MoSCoW. Contract fork and deploy first; it's the long pole. |
| The demo shows *our own* seller serving garbage | Pitch risk | Frame it as a **second, rogue seller** (a "competitor" or "compromised upstream") in the marketplace, with Enma's guarantee as the product: *"you only pay for data that passes QA, enforced by a contract we didn't write."* |

**Open questions for the team:**
1. Do we have Intercepta and TypeSafe (Jev) API keys today?
2. Is anyone's Stripe account already approved for Stablecoins and Crypto?
3. Does Brainbase give hackers workspace access and credits at kickoff (Slack surface enabled)?
4. Who owns the Solidity fork? It's the critical path.

---

## 13. Sources

- Project plan: `Project Plan_ Enma x402.docx` (this repo)
- A prior open-source implementation of the claim-time EIP-1271 payer mechanism, studied in depth as a design reference (§4) and not otherwise cited, cloned, or vendored
- x402 spec, batch-settlement EVM: <https://github.com/x402-foundation/x402/blob/main/specs/schemes/batch-settlement/scheme_batch_settlement_evm.md>
- x402 spec, batch-settlement Cloudflare: `specs/schemes/batch-settlement/scheme_batch_settlement_cloudflare.md` in the same repo
- x402 TS batch-settlement README: `typescript/packages/mechanisms/evm/src/batch-settlement/README.md`
- x402 FAQ: <https://docs.x402.org/faq>
- Facilitator capabilities (live): <https://x402.org/facilitator/supported>
- Stripe x402: <https://docs.stripe.com/payments/machine/x402>
- Stripe MPP: <https://stripe.com/blog/machine-payments-protocol>
- Stripe Climate Orders API: <https://docs.stripe.com/api/climate/order/create>
- Cloudflare Agents x402: <https://developers.cloudflare.com/agents/tools/payments/x402/>
- Cloudflare: Charge for HTTP content: <https://developers.cloudflare.com/agents/tools/payments/x402/charge-for-http-content/>
- Cloudflare: Pay from Agents SDK: <https://developers.cloudflare.com/agents/tools/payments/x402/pay-from-agents-sdk/>
- Cloudflare blog, x402 Foundation: <https://blog.cloudflare.com/x402/>
- Cloudflare blog, Monetization Gateway: <https://blog.cloudflare.com/monetization-gateway/>
- Brainbase docs: <https://docs.brainbaselabs.com/docs/welcome>, including the orchestrations and scheduled-agents pages
- Brainbase Kafka: <https://brainbaselabs.com/blog/introducing-kafka-first-ai-employee>
- Jev: <https://pypi.org/project/jev-agent-tool/>, <https://github.com/v-modal/awesome-jev-tools>
- Event: <https://luma.com/g42o84ln>
- Comparison context: <https://workos.com/blog/x402-vs-stripe-mpp-how-to-choose-payment-infrastructure-for-ai-agents-and-mcp-tools-in-2026>
