# Phase 5b — Dashboard redesign (shadcn/ui rebuild)

**Date:** 2026-09-28
**Follows:** Phase 5 (`docs/PLAN.md` §14) — the original live dashboard (EventHub broadcast, 3-lane animated event flow, Basescan links), built as vanilla HTML/CSS/JS in `seller/public/`.
**This phase:** replaced the vanilla dashboard's rendering layer with a React + shadcn/ui app, keeping the backend and event contract untouched. Also covers the first live Cloudflare Workers deployment.

---

## 1. Deployment — the seller Worker is live

`seller/` deploys as a single Cloudflare Worker (Workers Free plan) via `wrangler`:

- **Live URL:** `https://enma.prabhupv.workers.dev`
- Deploy command: `cd seller && npx wrangler deploy`
- All secrets from `seller/.env.example` were pushed via `wrangler secret put <NAME>` (one command per secret — Workers don't read `.env` at runtime).
- `ADMIN_TOKEN` is **not** issued by anything external — per `.env.example`, it's a self-chosen random string for hitting `POST /admin/claim` by hand. One was generated with `openssl rand -hex 32` and set. Note: at time of writing, no route in `seller/src` actually reads `env.ADMIN_TOKEN` yet — `worker-configuration.d.ts` declares the binding but `/admin/claim` isn't implemented. Flag this if the admin-claim demo beat is still planned.
- The Worker serves three things from one deploy: the API/payment routes, two Durable Objects (`SellerDO`, `EventHub`, both SQLite-backed), and the dashboard as static assets (`assets.directory: "public"` in `seller/wrangler.jsonc`).
- Redeploying after any dashboard change requires **two steps**: rebuild the frontend, then `wrangler deploy` again (see §3).

## 2. What changed: dashboard rendering layer only

The dashboard was fully rebuilt visually and structurally, but **the real-time architecture and event contract are unchanged** — this was a rendering-layer swap, not a backend change.

### Unchanged (verify against these if something breaks)
- Transport: raw browser `WebSocket` to `wss://<host>/ws`, backed by the `EventHub` Durable Object. DO holds live connections in memory and broadcasts on every `SellerDO` event — no polling.
- Event contract (8 kinds): `payment_required`, `voucher_opened`, `data_served`, `qa_verdict`, `revoked`, `claimed`, `incident`, `banned`.
- Reconnect behavior: 2s retry on socket close.
- Lane assignment (`laneFor`) and per-event description logic (`describeEvent`) — ported 1:1, same switch statements, same outputs (one field renamed, see below).

### New
- **Stack:** Vite + React 19 + TypeScript + Tailwind v4 + shadcn/ui (Radix UI primitives), living in a new nested project at `seller/dashboard-src/`.
- **Build target:** `seller/dashboard-src/vite.config.ts` sets `build.outDir: "../public"` with `emptyOutDir: true` — so `npm run build` in `dashboard-src` emits straight into `seller/public/`, which `wrangler.jsonc`'s existing `assets` binding already serves. No wrangler config changes were needed.
- **Design direction:** dark "settlement ledger / trading terminal" theme — not the earlier blue/green/purple SaaS-dashboard palette. IBM Plex Mono for all numerics/addresses (tabular-nums), IBM Plex Sans for labels/prose. Three lanes (Buyer / Seller / Escrow·EnmaGuard) rendered as a circuit-rail with a persistent vertical line and traveling event nodes, plus a full scrollable event log on the right. A rogue seller's events carry a persistent red-tinted background + "rogue" tag across all three lanes (not just a border flash) — this was a deliberate choice to keep the rogue-seller demo beat visually trackable end-to-end.
- **Ported logic module:** `seller/public/dashboardLogic.js` (vanilla JS) → `seller/dashboard-src/src/lib/dashboardLogic.ts` (typed). Same function names and behavior (`laneFor`, `describeEvent`, `basescanLink`, `short`, `usd`, `initialCounters`, `reduceCounters`, `formatCounters`), **except**: `describeEvent`'s returned field was renamed `cssClass` → `tone` (values: `""`, `"ok"`, `"fail"`, `"banned"`) since the new renderer isn't CSS-class-based.
- **New hook:** `useEnmaFeed` (`seller/dashboard-src/src/hooks/useEnmaFeed.ts`) owns the WebSocket connection + a `useReducer` over the ported `reduceCounters`, replacing the old imperative DOM-manipulation script (`dashboard.js`).
- **Components added:** `StatCell`, `LedgerRail`, `EventLog`, `ConnectionStatus` (`seller/dashboard-src/src/components/`), plus shadcn primitives (`Card`, `Badge`, `Separator`, `ScrollArea`, `Tooltip`) in `src/components/ui/`.

### Files removed / replaced
- `seller/public/dashboard.js` and `seller/public/dashboardLogic.js` (vanilla JS) — deleted by the Vite build's `emptyOutDir`, replaced by fingerprinted bundles (`assets/index-*.js`, `assets/index-*.css`).

## 3. How to change the dashboard going forward

```bash
cd seller/dashboard-src
npm run dev              # local dev server (localhost, Vite default port) — WebSocket won't connect unless pointed at a live seller
npm run build             # type-checks (tsc -b) then builds into ../public
npm test                  # runs the ported dashboardLogic tests (vitest, 14 tests)

cd ..                      # back in seller/
npx wrangler deploy        # re-deploys the Worker with the freshly built public/
```

Both steps are required — building alone doesn't deploy, and `wrangler deploy` alone will just re-push whatever's already in `public/`.

For local visual iteration without a live backend, `useEnmaFeed` exposes a dev-only hook: in dev mode (`import.meta.env.DEV`), `window.__mockEvent(event)` is available in the browser console to inject fake events and drive the UI without a real WebSocket connection. This is stripped from production builds automatically (Vite dead-code-eliminates the `if (!import.meta.env.DEV) return;` branch).

## 4. Test changes made during this phase

Two existing seller tests referenced the vanilla dashboard files directly and broke when those files were replaced by the Vite build:

- **`seller/test/dashboardLogic.test.ts`** (deleted) — it unit-tested `seller/public/dashboardLogic.js` directly, which no longer exists at that path (Vite output there is now a fingerprinted bundle). Its 14 test cases were ported to **`seller/dashboard-src/src/lib/dashboardLogic.test.ts`**, updated for the `cssClass` → `tone` rename, and now run via `vitest` inside `dashboard-src` (`npm test` in that directory).
- **`seller/test/routing.test.ts`** — two assertions expected a literal `dashboard.js` filename served at `/dashboard.js`. Vite fingerprints output filenames, so these were rewritten to extract the real `<script src="/assets/...">` path from the served `index.html` and fetch that path instead, rather than asserting a fixed name.

Full seller suite after these fixes: **17 test files, 92 tests, all passing** (`cd seller && npm test`).

## 5. Known gaps / things to check next

- **`ADMIN_TOKEN` has no consumer yet.** The secret is set on the Worker, but no route reads it. If the admin-claim demo beat (`POST /admin/claim`) is still planned, that endpoint needs to be implemented in `seller/src`.
- **`seller/dashboard-src/` is a second Node project nested inside `seller/`**, with its own `node_modules/`, `package.json`, and lockfile. Confirmed via `git check-ignore`: `seller/dashboard-src/node_modules` is excluded (both the Vite scaffold's own nested `.gitignore` and the repo root's bare `node_modules/` rule cover it) — safe to `git add` the rest of `dashboard-src/` as-is.
- **No CI wiring yet** between `dashboard-src`'s build/test and the root/seller test scripts — running `npm test` in `seller/` does **not** currently also run `dashboard-src`'s vitest suite; they're invoked separately (see §3).
- The dashboard was verified visually via Playwright screenshots against injected mock events (empty state, populated state including a full rogue-seller fraud path, and mobile 390px width) — not against a real live purchase end-to-end through the buyer CLI. Worth one live pass before the demo.
