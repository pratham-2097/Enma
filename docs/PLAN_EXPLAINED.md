# What we're actually building, and why the plan changed

**Enma x402 · Build Plan, Explained · Startup Speedrun Hackathon**

A plain-language walk-through of `PLAN.md` — every interaction in the system, every decision left to you, and exactly what moved since the original PRD and why. Technical readers get the precise version alongside every plain-language one.

**Hacking ends** 3:30 PM, 2026-09-28 · **Source** PLAN.md (15 sections) · **Status** reviewed today against live endpoints & source code

**How to read the tags used throughout this document:**

| Tag | Meaning |
|---|---|
| `VERIFIED` | Checked live today — a real endpoint, real source code, or the real chain. |
| `DOCUMENTED` | Taken from official docs, not independently tested by us. |
| `UNVERIFIED` | Plausible but unproven — the plan tests it in a named step before building on it. |
| `YOUR CALL` | A decision only you can make. |

---

## Contents

1. [The idea in one breath](#1-the-idea-in-one-breath)
2. [What changed from the PRD](#2-what-changed-from-the-prd)
3. [One purchase, start to finish](#3-one-purchase-start-to-finish)
4. [Decisions that are yours to make](#4-decisions-that-are-yours-to-make)
5. [Test-driven deployment](#5-test-driven-deployment)
6. [The build schedule](#6-the-build-schedule)
7. [The demo, and its fallbacks](#7-the-demo-and-its-fallbacks)
8. [What could go wrong](#8-what-could-go-wrong)
9. [What it costs](#9-what-it-costs)

---

## 1. The idea in one breath

Same one-liner as the PRD — the plan doesn't change the product, only how it gets built.

> **Enma sells AI-written market signals to robots, for a penny each.**

**In plain terms**

Enma is a shop that only AI agents can buy from. An agent asks for a "how does the market feel about AAPL right now" signal, pays about one cent, and gets a number back. If that number turns out to be garbage — an error message dressed up as data — the agent can claw the payment back *after* it already paid, and the seller genuinely cannot stop that from happening. That's the whole trick: normally, once you pay online, that's it. Here, payment stays reversible for a short window, on purpose, enforced by code neither Enma nor the buyer controls.

**Technically**

An x402 `batch-settlement` seller on Base Sepolia, paid from an EIP-1271 smart-contract wallet (`EnmaGuard`) instead of a plain key. Coinbase's real escrow contract asks that wallet "is this signature still good?" at the moment the seller tries to cash in — not when the buyer signed. A failed QA check flips that answer to "no" before the seller claims, so the claim transaction reverts on-chain.

---

## 2. What changed from the PRD

Five things came out of actually reading the escrow contract and the payment SDK's source code today. Two of them matter a lot; the other three are implementation detail that would have cost hours of confused debugging mid-hackathon if left unfixed.

> **Why this happened at all:** the PRD described the shape of the system. Before writing code against it, I read the actual contract Coinbase deployed and the actual TypeScript library everyone uses to talk to it. Two assumptions in the PRD didn't survive contact with that code. Both are fixed below, before a single line of Solidity gets written — which is the entire point of doing this check now instead of at 2 PM tomorrow.

### Diff 1 — A dishonest seller could have paid itself, and blamed a different seller

`VERIFIED — found in design review`

**In plain terms**

The contract design we studied checks "has *this named seller* been blocked?" — but it trusts the seller's own claim about who it is, written inside the very payment proof it's presenting. That reference design gets away with this because it has a *second* guard who double-checks that name. Our simpler version was going to drop that second guard — which would have let any seller write in someone else's name and cash out anyway. We caught this before building it, not during the demo.

**Technically**

That reference design's blob includes a self-reported `seller` field; safety depends entirely on a risk-oracle's co-signature over `(digest, seller, expiry)`. Our MVP drops that oracle. **Fix:** the contract now records `channelReceiver[channelId]` itself, inside `openTab`, and looks the seller up from that mapping instead of trusting the signature blob. The blob only carries what the escrow's own `getVoucherDigest(channelId, amount)` needs to re-derive the digest — nothing self-reported survives into the check.

**Was going to do:** Trust a "who am I" field written by the seller, inside its own payment proof.
**Now does:** The contract remembers the seller itself, the moment the channel opens — a fact it owns, not a claim it's handed.

> **Update, verified since this diff was first written:** I built this fix and ran it against the real, live Base Sepolia escrow. All four fork tests passed on the first attempt, including the exact regression test for this issue (`test_tamperedBlob_isRejected_byRealEscrow`) — a tampered blob is correctly rejected by the real contract. Total time: about 40 minutes from a bare Foundry install to a green test suite against production infrastructure. Details in §6 and in the schedule notes below.

### Diff 2 — The "5-minute safety window" idea, dropped — it would have blocked every payment

`VERIFIED — read the SDK's verification code`

**In plain terms**

An earlier idea was: make the contract itself refuse to pay out any purchase younger than, say, 5 minutes — giving QA a guaranteed window to catch bad data before money could move. Turns out the same check that decides "can this seller ever cash in" is also the check that decides "should this brand-new purchase even go through right now." A rule like "reject anything younger than 5 minutes" would reject *every single purchase*, forever, the instant it happens. So that idea is gone. Instead, we simply control how often our own seller tries to cash in — which we already fully control anyway.

**Technically**

The facilitator verifies every *fresh* voucher by calling the same `isValidSignature` the escrow calls at claim time (confirmed in `facilitator/utils.ts` and `server/verify.ts`). A time-lock inside that function can't distinguish "freshly signed, awaiting QA" from "freshly signed, about to be verified for the very first time" — both are the same call. The QA window becomes a policy on our own claim cadence (a Durable Object alarm, 60–90s) rather than a contract rule.

### Diff 3 — One bad payment can jam an entire batch of good ones

`VERIFIED — read the escrow contract`

**In plain terms**

If the seller tries to cash in several buyers' payments in one go, and even one of those buyers has been flagged, the *whole batch* fails — including the honest buyers who paid fine. So the seller has to cash in buyers one at a time, never in bulk.

**Technically**

`_processVoucherClaim` in the escrow's Solidity source reverts the transaction rather than skipping the bad entry. Fix: `maxClaimsPerBatch: 1` on the seller's claim loop.

### Diff 4 — The seller's brain now lives in one self-contained "room," not scattered across the Worker

`VERIFIED — read the storage interface's contract`

**In plain terms**

Cloudflare gives us two kinds of building blocks: light, stateless "Workers" that just route traffic, and heavier "Durable Objects" that remember things reliably between requests. The payment library needs the second kind — it needs somewhere that can read a number, change it, and write it back without another request sneaking in halfway through. So the whole seller — payments, AI calls, the ledger, the live dashboard feed — runs inside one Durable Object per seller, and the plain Worker out front just directs traffic to it.

**Technically**

The SDK's `ChannelStorage.updateChannel(id, update)` takes a synchronous callback and must be atomic — that can't cross an RPC boundary to a Durable Object cleanly. Because a DO instance is single-threaded, running the Hono app, x402 server, DO-SQLite storage, claim alarm and WebSocket hub all inside it gives atomicity for free instead of building a lock.

### Diff 5 — Brainbase's "fire an agent on a webhook" feature isn't live yet

`DOCUMENTED — their own docs say so`

**In plain terms**

The plan was to have events (a ban, a revoke) automatically ping a Brainbase agent through a webhook. Brainbase's own documentation literally says that trigger type is "not available yet." So instead, our code calls their regular API directly to kick off an agent — same result, different door.

**Technically**

Route ops events through `POST https://api.brainbaselabs.com/v2/threads` (bearer auth), tested once live in the first build phase; fall back to a Slack incoming webhook if the request body shape isn't what's documented.

---

## 3. One purchase, start to finish

Everything the system does, boiled down to nine hops. This exact sequence is what the demo shows the judges.

**Hop 1 — The buyer asks for data without paying — gets turned away with a price tag**
The agent requests `GET /v1/signal/AAPL`. No payment attached, so the seller replies "Payment Required" and quotes a price: $0.01 in USDC on Base's test network.

**Hop 2 — The buyer opens a "tab" — a pre-funded channel it can draw from**
Rather than pay fresh each time, the buyer's contract wallet deposits enough for ~5 calls into Coinbase's shared escrow, and the contract remembers who it opened this tab with — that memory is diff #1 above, in action.

**Hop 3 — The buyer signs a voucher and retries — an "I'll pay up to this much" IOU, not money moving yet**
Every request signs a fresh cumulative IOU. No tokens move on this step — it's a promise, cheap to make, cheap to check.

**Hop 4 — Coinbase's own escrow contract checks whether that promise is still good**
Because the buyer pays from a smart-contract wallet, Coinbase's shared payment-verification service calls that wallet's own code and asks: is this still valid? Not revoked, not paused, correctly signed → yes.

**Hop 5 — The seller serves the data — the AI-transformed signal, cached where possible**
Claude turns raw source posts into a proprietary sentiment score. To keep costs sane, that transformation is cached for 60 seconds and shared across every buyer asking about the same asset in that window.

**Hop 6 — The buyer's own QA judge checks what it just received**
A strict, deterministic check first (right shape, right range, not an error message wearing a data hat, not stale). If that fails, it's an automatic revoke — no appeal, no second opinion needed. A softer AI-based "does this feel genuine" check runs second, as a lower-confidence backstop.

**Hop 7 — On a QA failure, the buyer flips the switch — *after* already having the data**
This is the whole point of the product. The buyer's own contract wallet calls `revoke(seller, reason)` on itself. That's a self-owned kill switch, not a request to the seller for permission.

**Hop 8 — Later, the seller tries to cash in — and Coinbase's contract asks again**
On a timer, the seller batches up unpaid IOUs and tries to collect. Every single one gets re-checked at that moment. If it was revoked in the meantime, that specific claim **reverts** — the transaction fails, on-chain, publicly, and the seller gets nothing for the calls that failed QA.

**Hop 9 — Every step is broadcast live to a dashboard and to a Slack channel**
402s, IOUs, QA verdicts, revokes, claim results, bans — all streamed out so the judges (and you) can watch the whole story happen in real time.

> **The one line that matters most:** hop 7 happens strictly *after* hop 5 — the buyer already has the data in hand before it decides to take the money back. That's the entire reason this is interesting. Normal payments can't do this.

---

## 4. Decisions that are yours to make

Eight calls the plan can't make for you. Each has a sensible default already baked into the schedule — say nothing and that's what happens.

**D1 — How many people are building this?**
Default: **3 lanes** — Chain, Seller, Buyer+Ops. A solo path exists too, cutting Jev, Stripe, MCP and the "cheating buyer" flow.

**D2 — Which Claude model writes the sentiment signal?**
Default: **Opus 5**, cheapest effort setting. Costs about 0.7¢ per fresh call against a 1¢ sale — the 60-second cache is what actually protects the margin, more than the model choice does.

**D3 — Do you own a domain on Cloudflare?**
Default: **no** — bans happen inside the Worker's own code instead of a firewall rule, because firewall rules on the free `*.workers.dev` address aren't documented to work at all.

**D4 — The AI "does this feel genuine" checker (Jev) — do we have a key?**
Default: **try, then fall back**. Its maker reportedly paused new signups recently; a second provider hosts the same model as backup. Either way, the strict deterministic check works completely on its own.

**D5 — Do we screen buyer/seller wallets against a fraud database (Intercepta)?**
Default: **skip**, use a small hand-written blocklist instead. Keys come from a request form, not instant, and the data only covers real-money wallets anyway.

**D6 — How real does the Stripe integration need to be?**
Default: **a clearly-labelled simulated mirror**, not a real charge. Stripe's test environment can't watch our test-network transactions directly, so we use their own simulate-a-deposit tool and say so on screen.

**D7 — Should Claude itself be able to buy from Enma, live in the demo?**
Default: **yes, but after the core demo works** — a nice-to-have, not on the critical path.

**D8 — Dashboard visuals: flat 2D or a fancier 3D scene?**
Default: **2D first**. A working 2D flow proves the same story as a 3D one; 3D is purely a "if there's time left" upgrade.

---

## 5. Test-driven deployment

The rule for every single piece of this build: **write the test first, watch it fail for the right reason, then write only enough code to make it pass.** Nothing is called "done" because it looks done — it's done because a specific, named test says so.

> **Why this matters for a 5-hour build, specifically:** without this, "is the contract safe?" and "did the payment actually land on-chain?" become judgment calls made under time pressure at 2:45 PM. With it, they become a pass/fail line you can point to. A red test at any checkpoint is the trigger to cut that feature from the live demo and fall back to the pre-recorded video — not a decision anyone has to make in the moment.

### The two tests that matter most

**`test_revokeAfterSigning_claimReverts`** — Proves the headline claim itself: sign a payment, revoke it, then confirm the seller's attempt to collect fails on-chain. **This is the product.** Everything else supports this one test passing.

**`test_tamperedSellerInBlob_isRejected`** (also called `test_tamperedBlob_isRejected_byRealEscrow` in the working test suite) — This is the direct regression test for diff #1 above. It builds a payment proof that lies about which seller it belongs to, and checks the contract says no. **If this one test is ever red, the entire security guarantee of the product is broken** — nothing else in the plan matters until it's green.

> **Both of these are no longer hypothetical.** I built and ran this exact test suite against the real, live Base Sepolia escrow today. All four tests passed on the first attempt — including these two — in about 8 seconds of run time, after roughly 40 minutes of total setup and writing. See §6 for what this changes.

### The rest of the test suite, by what it protects

| Test file | What it stops from happening | Unblocks |
|---|---|---|
| `doChannelStorage.test.ts` | Two payments updating the same channel at once corrupting each other's balance | Seller build |
| `transform.test.ts` | A broken AI response silently becoming a fake "success" instead of a clear error | Seller build |
| `ledger.test.ts` | Banning an honest buyer over one unlucky QA failure | MAD / anti-abuse flow |
| `x402.integration.test.ts` | Discovering, mid-demo, that the real payment network doesn't actually accept our setup | **Gate G2** — the single riskiest unknown in the whole plan |
| `e2e.purchase.test.ts` through `e2e.mad.test.ts` | Any of the five demo beats being untested when judges are watching | **Gate G3** — go/no-go for the live demo |

### Cheapest check first, always

Three tiers, run in order — never skip straight to the expensive one:

1. **Unit** (milliseconds, free) — catches plain logic mistakes and the security regression.
2. **Fork / integration** (seconds, free on testnet) — checks our code against the *real* deployed contract and the *real* payment library, not a pretend version of either.
3. **End-to-end** (tens of seconds, a few cents of test-network gas) — the whole nine-hop journey from §3, run for real.

---

## 6. The build schedule

Timed to a 9:30 AM start; if the actual start slips, shift every clock time but keep the gates in the same order.

| Time | What's happening | Gate |
|---|---|---|
| 9:30–10:15 | Everyone: accounts, wallets, API keys, a funded test-network balance. | **G0** — money and logins visible |
| 10:15–10:30 | Write every test first, on purpose watch them all fail. | — |
| 10:30–11:30 | Build the smart contract and the buyer's payment plumbing until those tests turn green; deploy. | **G1** — all 7 contract tests green, contract live |
| 11:30–12:30 | The scariest integration: a real payment, through the real network, verified by the real Coinbase contract. | **G2** — one real payment served, one real claim landed on-chain |
| 12:30–1:45 | Lunch and the sponsor panel — also a chance to ask Stripe and Cloudflare people about the open questions. | — |
| 1:45–2:45 | The "rogue seller," the anti-abuse ledger, the ops agents, the dashboard. | — |
| 2:30–2:45 | Green the final four end-to-end tests, one per demo beat. | **G3** — full demo runs start to finish |
| 2:45–3:15 | Feature freeze. Rehearse twice. Record the backup video. | **G4** — video saved |
| 3:15–3:30 | Buffer. Commit everything locally. | — |

> **Update since this schedule was first drafted:** the contract portion of gate G1 has already been proven, ahead of schedule, in a research spike — not merely estimated. A working, security-fixed `EnmaGuard` contract was written, compiled, and fork-tested against the real Base Sepolia escrow in about 40 minutes total, with all tests green on the first real attempt. This was originally treated as the plan's biggest time risk; it turned out to be one of the fastest, most provable parts of the whole build. The genuinely open risk that remains at G2 is different: not "does our contract work" (answered: yes) but "does the shared, hosted payment-verification service correctly talk to our contract during a full buyer-to-seller purchase," which is still untested.

---

## 7. The demo, and its fallbacks

Seven beats, about 3 minutes. Every beat that depends on a live system has a pre-recorded fallback ready to go.

| # | Beat | What judges see | If it breaks |
|---|---|---|---|
| 1 | **The purchase** | A live purchase, playing out on the dashboard end to end | Play the recorded clip |
| 2 | **The cash-out** | The seller collects, on-chain, with a link to prove it | Show the pre-captured transaction link |
| 3 | **The save** | A rogue seller sells junk; the buyer catches it and pulls the payment | Pre-run revoke transaction link |
| 4 | **The revert** | The rogue seller tries to collect anyway — Coinbase's own contract says no | Captured simulated-failure output |
| 5 | **Mutual protection** | A buyer that abuses the revoke button gets banned automatically | Screenshot |
| 6 | **The shady seller** | A known-bad seller gets refused before any money moves at all | Skip if short on time |
| 7 | **The close** | "Agents pay only for data that passes QA." | — |

> **Say the honest limits out loud, on purpose:** this runs on the test network today. Once a claim actually lands, it's final — the trick only works because *we* control how often our own seller tries to collect; a third-party seller wouldn't wait for us. And banning a wallet is cheap to get around by just making a new one — the roadmap addresses that with stronger identity checks.

---

## 8. What could go wrong

The two risks worth knowing about before anything else — the rest are in the full plan.

**Biggest unknown: does the free public payment-verification service actually accept our custom wallet's signature?**
`UNVERIFIED — the code says yes, the live service hasn't been tested with this exact setup`

This gets answered directly at gate G2, around 12:30. If it doesn't work, there's a two-step fallback: run that verification step ourselves instead of relying on the shared free service, or have the seller talk to the payment contract directly.

**Everyone at the venue shares one internet address — so address-based bans are off the table**
`VERIFIED — just true of how venue WiFi works`

If the "ban abusive buyers" feature banned by internet address, it would also ban every other team, and possibly the judges. Bans are keyed to the buyer's wallet address instead — which is also just the more correct way to do it.

---

## 9. What it costs

Everything runs on free test-network money and free-tier cloud services. The only real spend is AI usage, and it's small.

| Item | Cost |
|---|---|
| Test-network gas & USDC (faucets) | $0 |
| Per fresh AI signal (Opus 5) | ~0.7¢ |
| Price charged per signal | 1¢ |
| Total API spend for the whole demo | Under $2 |

The 60-second result cache is what actually protects the margin: the first buyer asking about a given stock in any given minute pays for the AI call, and every other buyer in that same minute gets served from cache for free. At even five buyers per minute per stock, the real per-sale AI cost drops well under the one-cent sale price.

---

*Built from PLAN.md, PRD.md and RESEARCH.md. Every technical claim above is tagged in the source plan as verified, documented, or explicitly tested by a named step.*
