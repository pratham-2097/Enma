# Feature branch: spend-limit firewall + dashboard XSS fix

**Branch:** `worktree-feature+spend-limit-firewall` (a git worktree at
`.claude/worktrees/feature+spend-limit-firewall/` — its own working directory, backed by
the same `.git` as the main checkout).
**Branched from:** `66da50c` — the end of Phase 5 (live dashboard).
**Status:** built, tested, live-verified, **not yet merged into `main`**.
**Why a separate branch:** built while another agent session was working on Phase 6 in
the main checkout. A worktree keeps the two sessions' `git checkout`/`git commit` from
ever colliding — physically separate working directories, one shared repo.

Read this whole file before touching this branch, then `docs/PLAN.md` for overall project
context. This branch isn't a numbered phase in PLAN.md — it's an additional feature built
in parallel.

---

## What's in this branch

```
 M buyer/.env.example
 M buyer/src/agent.ts
 M buyer/src/buySignal.ts
 M buyer/src/cli.ts
 M buyer/test/agent.test.ts
 M seller/public/dashboardLogic.js
 M seller/test/dashboardLogic.test.ts
?? buyer/src/spendLimit.ts
?? buyer/test/buySignal.spendLimit.test.ts
?? buyer/test/spendLimit.test.ts
```

Ten files. Nothing in `contracts/`, nothing in `seller/src/`. Test counts: **buyer 47/48
green** (1 skipped, pre-existing — a live Jev call gated behind a real API key), **seller
76/76 green**. Baseline at the branch point (end of Phase 5) was buyer 33/34, seller
74/74 — this branch adds 14 buyer tests and 2 seller tests, zero regressions.

---

## Feature 1: buyer-side spend-limit firewall

### The idea

The project's core mechanism is reactive: a buyer pays, QA checks the data, then revokes
the voucher *after the fact* if it was bad. This feature is the proactive mirror: refuse
to pay in the first place if the seller's price exceeds a limit the buyer set — no
voucher signed, no channel opened, no gas spent.

### Where it hooks in

`buyer/src/buySignal.ts`'s `buySignal()` is the one real payment path every CLI mode
(`buy`/`cheat`/`shady`, now `firewall`) builds on. It already parses the seller's quoted
price from the 402 response (`accepted.amount`) before calling `openTab()` — the first
step that spends gas and writes on-chain state. The firewall check sits exactly there:
after the price is known, before any money-costing action.

### What was built

- **`buyer/src/spendLimit.ts`** (new) — `SpendLimiter` class, pure in-memory logic:
  - `check(seller, amountAtomicUnits)` → `{ allowed: true }` or `{ allowed: false, reason }`.
    Two independent, optional caps:
    - `maxPerCallAtomicUnits` — refuse any single call quoted above this.
    - `maxWindowAtomicUnits` + `windowMs` — refuse if this seller's rolling-window spend
      (tracked per-seller) would be exceeded.
  - `record(seller, amountAtomicUnits)` — call only after a payment succeeds; checking
    alone never records spend (verified by test).
  - Constructor takes an optional `now: () => number` for deterministic window-expiry
    tests without real timers.

- **`buyer/src/buySignal.ts`** (modified) — `BuySignalOptions` gained an optional
  `spendLimiter?: SpendLimiter`. When present:
  1. Right after `accepted` is parsed, call
     `spendLimiter.check(accepted.payTo, BigInt(accepted.amount))`.
  2. If refused, throw `SpendLimitExceededError` (new, exported from this file) —
     before `channelConfigFrom402`/`openTab` are ever called.
  3. On a confirmed `200`, call `spendLimiter.record(...)`.
  - Omitting `spendLimiter` leaves behavior byte-for-byte identical to before this
    branch (verified by test).

- **`buyer/src/agent.ts`** (modified) — new `runFirewall(config, asset)`, following the
  same shape as the pre-existing `runShady` (screen something, refuse before
  `buySignal`, return `{ refused: true, reason }`). `AgentConfig` gained an optional
  `spendLimit?: SpendLimitConfig`; `AgentRunResult.mode` gained `"firewall"`.
  `runFirewall` catches `SpendLimitExceededError` and converts it to
  `{ refused: true, reason }`; any other error re-throws unchanged.

- **`buyer/src/cli.ts`** (modified) — new `firewall` CLI mode
  (`buyer firewall <asset>`), reading its cap from `MAX_PER_CALL_USDC` (a decimal USDC
  string, e.g. `0.005`). Existing `buy`/`cheat`/`shady` modes unaffected.

- **`buyer/.env.example`** — documents `MAX_PER_CALL_USDC`.

### Live verification

Run against a real local `wrangler dev` seller with real testnet credentials
(2026-09-28):

- **Cap below the seller's real quoted price** ($0.005 cap vs. a real $0.01 quote):
  refused instantly — `REFUSED: refused before opening a channel: per-call limit
  exceeded: seller quoted 10000, cap is 5000` — zero channel opened, zero gas spent.
- **Cap above the price** ($0.02 cap): proceeded through the full real flow — real 402,
  real channel, real voucher, real Claude-transformed data returned with a real `200`.

### How to demo it

```bash
cd buyer
SELLER_URL=<your seller's URL> MAX_PER_CALL_USDC=0.005 npx tsx src/cli.ts firewall AAPL
```
Against a seller quoting more than $0.005/call → refusal. Raise `MAX_PER_CALL_USDC`
above the seller's actual price, re-run → normal successful purchase. Two ~10-second
runs back to back is the whole demo beat.

---

## Feature 2: dashboard XSS fix (`basescanLink`)

### What was found

`seller/public/dashboardLogic.js`'s `basescanLink(txHash)` built a Basescan URL by
concatenating `txHash` with no validation. `seller/public/dashboard.js` drops that URL
straight into an `href="${link}"` attribute with no further escaping — unlike every
other dynamic field on the dashboard, which already passes through an `escapeHtml()`
helper first.

Not theoretical: `shared/dashboardEvent.schema.ts` declares `txHash: z.string().optional()`
— any string accepted, no hex-shape check — and the buyer's `/v1/events` POST endpoint
(a real, less-trusted entry point into the same event stream) could carry a crafted
value like `0xabc" onmouseover="alert(1)` straight to every connected dashboard
viewer's DOM.

### The fix

`basescanLink()` now validates `txHash` against `/^0x[0-9a-fA-F]{64}$/` (a real tx
hash's exact shape) before building a link. Anything else — including any attempted
attribute break-out — returns `undefined`, which existing rendering code already
treats as "no link shown."

### Tests added

`seller/test/dashboardLogic.test.ts`, `describe("basescanLink")`: rejects an
`href`-breakout string, a raw `<script>` tag, and a `javascript:` URL; accepts a
real-shaped hash. The two pre-existing tests in this block were updated to use a
real-shaped hash instead of the placeholder `"0xdeadbeef"` they previously used (now
correctly rejected — real-looking hex, wrong length). Full seller suite after the fix:
76/76 green.

---

## How to pick this branch up

```bash
# If continuing in the same worktree:
cd .claude/worktrees/feature+spend-limit-firewall

# If starting fresh and the worktree no longer exists, recreate it from the branch:
git worktree add <some-path> worktree-feature+spend-limit-firewall
cd <some-path>
npm install   # root
cd buyer && npm install && cd ../seller && npm install
```

Before doing anything else: run `git status` in **both** the main checkout and this
worktree. `main` has had ongoing work from other sessions this branch does not include
and was deliberately built without depending on. Don't assume anything about `main`'s
state from this document — re-check it live.

**To merge:** once whatever's in flight on `main` is committed and settled, this branch
should merge cleanly — it touches no file Phase 6 work was observed touching. Confirm
with a fresh `git diff main...worktree-feature+spend-limit-firewall` before merging.
