# Enma x402: Project Requirements (v2)

**Event:** Startup Speedrun Hackathon, presented by Brainbase Labs · Cloudflare HQ, SF · 2026-09-28
**Lead:** Pratham Prabhu
**Supersedes:** `Project Plan_ Enma x402.docx` (v1). The reasons for every change are in [RESEARCH.md](RESEARCH.md) §9.
**Build details:** [PLAN.md](PLAN.md) is authoritative wherever the two differ.

---

## 1. One-liner

**Enma sells AI-derived market signals to agents for $0.01 a call over x402, with a guarantee enforced by a contract we didn't write: if the data fails QA, the payment never settles.**

## 2. Problem

- Agents can't buy subscriptions; x402 lets them pay per request.
- With `exact` x402, **signing is spending**. An agent that pays for junk has no recourse.
- Sellers on `batch-settlement` serve first and are paid later, so they extend credit to strangers.
- A prior claim-time-payer-contract design (studied as a reference implementation, not reused directly) proved a payment can be stopped *after* signing, but only when a risk score changes or a human clicks "close tab". **Nothing checks the data.**

## 3. Solution

1. **Transformer (seller, Cloudflare + Claude).** Buy bulk upstream data, transform it with Claude into a proprietary signal (`sentiment_index`) under a strict JSON Schema, and sell it per request via x402 `batch-settlement` on Base Sepolia.
2. **QA escrow (buyer protection).** The buyer pays from **EnmaGuard**, our own EIP-1271 wallet contract. Coinbase's escrow asks EnmaGuard *"is this voucher valid?"* at **claim time**. The buyer's **QA Judge** (deterministic schema gate → Jev semantic gate) revokes on failure, so the seller's claim reverts.
3. **MAD (seller protection).** The seller tracks each payer's revocation ratio. Abusers drop to a zero credit line (claim after every call), then get **banned at the Cloudflare edge** via a WAF Custom List written by an agent.
4. **Autonomous org (Brainbase).** Enma is run by four Brainbase agents coordinating in Slack: Procurement, QA Judge, Treasury, SRE.

## 4. Tracks covered

| Track | How |
|---|---|
| Agentic Payments | x402 batch-settlement on the real Coinbase escrow; agents buy, sell, dispute, and manage deposits |
| Agents That Deploy Infrastructure | The SRE agent redeploys the Worker, rotates keys, and writes WAF lists via the Cloudflare API |
| Autonomous Organizations | Four Brainbase agents with a shared Slack surface and webhook and schedule triggers |

## 5. Architecture

```
                         ┌──────────────── Brainbase orchestration (Slack surface) ───────────────┐
                         │ Procurement ─ QA Judge ─ Treasury ─ SRE   (webhook + schedule triggers) │
                         └──────┬──────────────┬──────────────┬─────────────────┬──────────────────┘
                                │              │              │                 │ Cloudflare API
 Claude (MCP client) ──► BUYER AGENT (TS)      │         Stripe (test mirror,   │ (deploy, WAF list)
                         │ x402 client         │          Climate accrual)      ▼
                         │ QA Judge: ajv ─► Jev│                         ┌───────────────────────────┐
                         │ guardian key ───────┼── revoke/capChannel ──► │ EnmaGuard.sol (payer,     │
                         │                     │                         │ EIP-1271) · Base Sepolia  │
                         ▼  402 / vouchers     │                         └────────────▲──────────────┘
          ┌───────────────────────────────────────────────┐                           │ isValidSignature
          │ SELLER · Cloudflare Worker (Hono + @x402)     │   claimWithSignature      │ at claim time
          │  ├─ upstream fetch (mock Web2 source)         │ ────────────────► Coinbase x402BatchSettlement
          │  ├─ Claude via AI Gateway → signal (schema)   │                  0x4020074e…0003 (Base Sepolia)
          │  ├─ DO: channel storage + voucher history     │                  via x402.org/facilitator
          │  ├─ DO: payer ledger (revocation ratio, bans) │
          │  ├─ DO alarm: claim / settle rounds           │
          │  └─ DO: WebSocket hub ──► DASHBOARD (canvas)  │
          └───────────────────────────────────────────────┘
```

## 6. Stack (decided)

| Component | Language / tech | Notes |
|---|---|---|
| `contracts/` | Solidity 0.8.24, Foundry | `EnmaGuard` + `EnmaCollector`, a claim-time EIP-1271 payer contract we own outright. Fork tests against Base Sepolia and Base mainnet. |
| `seller/` | TypeScript, Cloudflare Workers, Hono, `@x402/hono`, `@x402/evm/batch-settlement/server`, Durable Objects, AI Gateway | Custom `ChannelStorage` on a DO; claims driven by a DO alarm, not `setInterval`. |
| `buyer/` | TypeScript (Node), `@x402/evm/batch-settlement/client`, viem, ajv, Jev | Channel `payerAuthorizer` **must be `address(0)`**; never delegate the voucher signer. |
| `dashboard/` | Static HTML + canvas, served from Workers Assets | Live feed from the DO WebSocket |
| `ops/` | Brainbase agent and orchestration configs | Slack surface |

**Why not Rust or Python:** see RESEARCH.md §8. Short version: the official batch-settlement server and client are TypeScript, and Cloudflare is JS-first.

## 7. Functional requirements

### 7.1 Seller (Worker)
- **S1** `GET /v1/signal/:asset` returns a 402 with `batch-settlement`, `eip155:84532`, USDC, price `10000` (= $0.01), `withdrawDelay: 900`.
- **S2** On a valid voucher: fetch upstream → transform with Claude (tool-use structured output, shared schema) → return `{asset, sentiment_index 0–100, confidence, n_sources, window_start, window_end, model}` plus `PAYMENT-RESPONSE`.
- **S3** Cache transformations per `(asset, 60 s bucket)` so many buyers share one Claude call.
- **S4** Before serving, call `isValidSignature` on the payer; if it's revoked, refuse with a reason.
- **S5** Claim round on a DO alarm (demo: every 60–120 s, plus a manual `POST /admin/claim`). **Simulate before sending**; record `claimed` or `rejected` with the decoded reason.
- **S6** Payer ledger: `served_value`, `rejected_value`, `ratio`. Ratio ≥ threshold (demo 0.5 over ≥ 3 calls) → standing `careful` (claim each call) → `banned` → emit a webhook to the SRE agent.
- **S7** Rogue mode: `ROGUE_AFTER=N` makes the "rogue seller" route serve junk (`{"error":"API down"}` / sentinel values) while still charging.
- **S8** Broadcast every event (402, voucher, serve, QA verdict, revoke, claim result, ban) to the dashboard WebSocket.

### 7.2 EnmaGuard contract
- **C1** `EnmaGuard` roles and lifecycle: owner, agent, guardian; `revoke(seller, reason)`, `restore`, `setPaused`, `openTab`, owner-only withdraw and sweep, malleability-safe ecrecover.
- **C2** Collector enforces `payer == wallet && payerAuthorizer == 0`.
- **C3 (MVP)** `isValidSignature` checks agent signature, seller not revoked, not paused. The oracle co-signature is **optional** (off in MVP).
- **C4 (dropped)** ~~On-chain `qaWindow`~~: not viable, because the facilitator calls `isValidSignature` to verify every *fresh* voucher, so a time-lock would reject every payment (PLAN.md §2). The QA window is an off-chain seller claim cadence.
- **C3a (Must, security)** Seller identity comes from `channelReceiver[channelId]` recorded in `openTab`, never from the signature blob (PLAN.md §2).
- **C5 (Could)** `capChannel(channelId, ceiling)`: QA-precise partial revocation (needs seller voucher history).
- **C6** Foundry tests: happy claim; revoke after signing → claim reverts; restore → claim succeeds; agent can't withdraw; stranger can't route the allowance.

### 7.3 Buyer agent and QA Judge
- **B1** Fetch the signal via the x402 batch-settlement client, paying from EnmaGuard.
- **B2** Screen `payTo` before first payment (Intercepta if a key is available, otherwise a local denylist). Refuse → no voucher.
- **B3** **Deterministic gate:** ajv against the shared schema, plus invariants (range, ticker, freshness, sentinel strings). Fail → `revoke(seller, reason)` immediately, print `DATA INVALID: REVOKING VOUCHER`.
- **B4** **Semantic gate:** Jev `Noul` "genuine vs placeholder/fabricated". `p(bad) ≥ 0.9` → revoke; otherwise flag.
- **B5** Log every verdict with the payload hash and the Jev fingerprint.
- **B6 (Should)** An MCP server exposing `find_signals`, `buy_signal`, `list_tabs`, `dispute`, so Claude can drive the buyer.

### 7.4 Brainbase org
- **O1** Four agents in one orchestration, posting to `#enma-ops` in Slack.
- **O2** A webhook trigger from the seller (ban or upstream 429) → SRE agent → Cloudflare API: add the IP to a WAF Custom List, and/or `wrangler deploy` with rotated upstream key.
- **O3** A schedule trigger → Treasury agent: P&L (x402 claims − Claude cost − upstream cost) → Slack, and the Stripe test-mode mirror.

### 7.5 Stripe
- **P1 (Should)** Mirror each successful claim to Stripe test mode, labelled "testnet mirror".
- **P2 (Could)** One real mainnet $0.01 `exact` payment to a Stripe crypto deposit address, recorded as a PaymentIntent (`transaction_verification`). Only if the Stablecoins approval is granted.
- **P3 (Could)** Climate accrual: x% of settled revenue; place a Climate Order at the threshold (test mode).

## 8. Scope (MoSCoW) for a ~5 h build

| Must | Should | Could | Won't (today) |
|---|---|---|---|
| EnmaGuard fork deployed on Base Sepolia with the revoke path tested | Claude via MCP (B6) | C5 QA-precise cap | World ID |
| Seller Worker: 402 → voucher → Claude signal | B6 MCP server for Claude | P2 real Stripe mainnet payment | Mainnet deployment |
| Buyer: pay → deterministic QA → revoke | O1–O3 Brainbase org in Slack | P3 Climate | MPP, Web Bot Auth |
| Claim round showing `claimed` and then `REJECTED` | S6 ban → WAF list | Jev layer (B4) if no key | Azure anything |
| Dashboard live feed (2D is fine, 3D if time) | P1 Stripe mirror | 3D canvas polish | IP rotation |

## 9. Demo script (3 minutes)

1. **The purchase (30 s).** Claude (via MCP) or the CLI buyer asks for `AAPL` sentiment. Dashboard: 402 → deposit into the Coinbase escrow (Basescan link) → voucher → `sentiment_index: 85.0`. QA: ✅ schema, ✅ Jev.
2. **The cash-out (20 s).** Trigger a claim round → `claimed 0.01 USDC` (tx link). Stripe test-mode mirror appears; the Treasury agent posts P&L in Slack.
3. **The save (45 s).** Switch the buyer to the **rogue seller** (a compromised upstream, `ROGUE_AFTER=1`). It serves `{"error":"API down"}` and charges anyway. The QA Judge prints `DATA INVALID: REVOKING VOUCHER` → `revoke` tx.
4. **The revert (20 s).** The rogue seller tries to claim → simulation shows `CLAIM REJECTED by the escrow … revoked (reason: qa_schema_fail)`. The money stays with the buyer, enforced by Coinbase's contract, not ours.
5. **MAD (30 s).** A cheating buyer script accepts good data and revokes anyway. The seller's ledger ratio crosses the threshold → standing `careful` → `banned` → webhook → the SRE agent writes the WAF list in Slack → the next request dies at the Cloudflare edge.
6. **Shady seller (15 s).** The buyer is pointed at a seller whose `payTo` is a known-flagged mainnet address → screening refuses → no voucher ever exists.
7. **Close (10 s).** "Enma: agents pay only for data that passes QA. Built on x402, Cloudflare, Claude, Brainbase and Stripe."

## 10. Timeline (hacking ends 3:30 PM)

| Time | Contracts | Seller (Worker) | Buyer + QA | Ops / dashboard |
|---|---|---|---|---|
| 9:30–10:00 | Kickoff. Fund keys (Circle faucet, Sepolia ETH), dedicated RPC, request Stripe Stablecoins, confirm Brainbase access and Intercepta/Jev keys | | | |
| 10:00–11:30 | Fork the reference design → EnmaGuard; fork tests; deploy | Hono + `@x402` batch server; DO storage; stub signal | Batch client paying from EnmaGuard; ajv schema | Dashboard WS skeleton |
| 11:30–12:30 | Integration spike: EIP-1271 voucher via facilitator | Claude via AI Gateway; claim alarm + simulate | Revoke path end to end | Brainbase agents + Slack |
| 12:30–1:45 | Lunch + sponsor panel (network with Stripe and Cloudflare, ask them about approvals) | | | |
| 1:45–2:45 | C5 if ahead | Payer ledger, ban webhook, rogue mode | Jev gate; MCP server | SRE → WAF list; Treasury → Stripe mirror |
| 2:45–3:15 | **Feature freeze.** Full demo rehearsal ×2, record the backup video | | | |
| 3:15–3:30 | README with tx links, measured gas, sponsor feedback section | | | |

## 11. Acceptance criteria

- [ ] A real Base Sepolia tx where Coinbase's escrow **rejects** a claim for already-served data after a QA-triggered revoke.
- [ ] A real Base Sepolia tx where a good voucher is claimed and settled.
- [ ] Claude receives a paid signal through Enma.
- [ ] A payer banned by the revocation ratio is refused on its next request, and the ban was written by an agent.
- [ ] Brainbase agents visibly coordinate in Slack during the demo.
- [ ] A backup demo video is recorded before 3:30.

## 12. Keys and config checklist

| Secret | Where | Owner |
|---|---|---|
| Owner, agent, guardian keys (Base Sepolia) | `buyer/.env` | Buyer |
| Receiver + receiverAuthorizer keys | Worker secrets | Seller |
| `ANTHROPIC_API_KEY` (through AI Gateway) | Worker secrets | Seller |
| Base Sepolia RPC (Alchemy / QuickNode) | all | — |
| `INTERCEPTA_API_KEY` (optional) | buyer + seller | — |
| `TYPESAFE_API_KEY` (Jev, optional) | buyer | — |
| Cloudflare API token (Workers deploy + WAF lists) | Brainbase secrets | SRE agent |
| Stripe test secret key | Brainbase secrets | Treasury agent |
| Slack workspace connected to Brainbase | Brainbase | Ops |

## 13. Pitch framing

- The claim-time payer-contract mechanism proves a payment can be stopped after signing. **Enma** makes stopping it *automatic and deserved* (QA-driven), *fair to sellers* (MAD and credit lines), and *a business* (data arbitrage with cached Claude transformations).
- Say the honest limits out loud: a successful claim is final (hence the on-chain QA window), wallet bans are Sybil-cheap (hence credit lines, and Web Bot Auth on the roadmap), and it runs on testnet today.
