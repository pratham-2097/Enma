# Phase 0 Setup: Step by Step

**Purpose of this file:** exactly what to do, in order, to fill in `contracts/.env`, `seller/.env`, and `buyer/.env` — nothing else. It maps 1:1 to PLAN.md §9's table (steps 0.1–0.11). When you're done, every value in all three `.env` files should be filled in and Gate G0 passes.

**Where things go:** three real files already exist for you to fill in:
- `contracts/.env`
- `seller/.env`
- `buyer/.env`

Each has comments explaining every line. **Never share these files or paste their contents into chat, Slack, or anywhere public** — they hold private keys. The `.env.example` versions next to them (no secrets, just structure) are safe to share or commit.

Some values are needed in more than one file — I've noted that at each step. Fill in the same value everywhere it's asked for.

---

## Step 0.1 — Foundry (already done)

Nothing for you to do here — already installed and confirmed working on this machine.

---

## Step 0.2 — Cloudflare account + AI Gateway

1. Go to **[dash.cloudflare.com](https://dash.cloudflare.com)** and sign up (or log in) — free tier is fine.
2. In your terminal, run:
   ```
   npx wrangler login
   ```
   This opens a browser tab to authorize the CLI. Approve it.
3. In the Cloudflare dashboard: left sidebar → **AI** → **AI Gateway** → **Create Gateway**.
4. Name it exactly **`enma`** (this matches what's already in `seller/.env.example`).
5. Once created, go to the dashboard's main **Workers & Pages** overview page — your **Account ID** is shown in the right sidebar. Copy it.

**Put in `seller/.env`:**
```
CF_ACCOUNT_ID=<the account ID you just copied>
CF_AI_GATEWAY_NAME=enma
```

---

## Step 0.3 — Anthropic API key

1. Go to **[console.anthropic.com](https://console.anthropic.com)**.
2. If this is a fresh account for the hackathon, look for a banner or prompt to claim event credit (up to $50) — claim it if offered.
3. Left sidebar → **API Keys** → **Create Key**. Name it something like `enma-hackathon`.
4. Copy the key immediately — it's shown once. It starts with `sk-ant-`.

**Put in `seller/.env`:**
```
ANTHROPIC_API_KEY=sk-ant-...
```

---

## Step 0.4 — A dedicated Base Sepolia RPC

Don't use the free public one — it rate-limits under load, which broke a very similar build mid-demo before. Pick **one** of these (both free):

**Option A — Alchemy:**
1. Go to **[alchemy.com](https://www.alchemy.com)** → sign up.
2. Create a new App → Network: **Base Sepolia**.
3. On the app's dashboard, click **View Key** → copy the **HTTPS** URL (looks like `https://base-sepolia.g.alchemy.com/v2/<your-key>`).

**Option B — QuickNode:**
1. Go to **[quicknode.com](https://www.quicknode.com)** → sign up.
2. Create an endpoint → Chain: **Base**, Network: **Sepolia**.
3. Copy the **HTTP Provider** URL from the endpoint's overview page.

**Put the same URL in all three files:**
```
RPC_URL=<your URL>
```
(`contracts/.env`, `seller/.env`, and `buyer/.env` — same value in all three.)

**Verify it works:**
```bash
curl -s -X POST $RPC_URL -H 'content-type: application/json' \
  -d '{"jsonrpc":"2.0","id":1,"method":"eth_blockNumber","params":[]}'
```
Should return a JSON object with a `result` field. If you get an error or nothing, the URL is wrong — go back and re-copy it.

---

## Step 0.5 — Generate 6 wallets

You need 6 separate wallets total (a 7th, `AGENT`, is shared/reused — see the note below). Foundry's `cast` tool generates one instantly, no signup needed.

Run this command **6 times** (once per wallet):
```bash
cast wallet new
```

Each run prints something like:
```
Successfully created new keypair.
Address:     0x1234...
Private key: 0xabcd...
```

**Copy each pair into the right place**, matching this table:

| # | This is the... | Goes in `contracts/.env` as | Also goes in `buyer/.env` as |
|---|---|---|---|
| 1 | `OWNER` | `OWNER_PRIVATE_KEY` / `OWNER_ADDRESS` | `OWNER_PRIVATE_KEY` |
| 2 | `AGENT` | `AGENT_PRIVATE_KEY` / `AGENT_ADDRESS` | `AGENT_PRIVATE_KEY` |
| 3 | `GUARDIAN` | `GUARDIAN_PRIVATE_KEY` / `GUARDIAN_ADDRESS` | `GUARDIAN_PRIVATE_KEY` |

| # | This is the... | Goes in `seller/.env` as |
|---|---|---|
| 4 | `ENMA_RECEIVER` (the honest seller gets paid here) | `ENMA_RECEIVER_PRIVATE_KEY` / `ENMA_RECEIVER_ADDRESS` |
| 5 | `ENMA_AUTHORIZER` (signs the honest seller's claims) | `ENMA_AUTHORIZER_PRIVATE_KEY` / `ENMA_AUTHORIZER_ADDRESS` |
| 6 | `ROGUE_RECEIVER` (the "goes bad" demo seller) | `ROGUE_RECEIVER_PRIVATE_KEY` / `ROGUE_RECEIVER_ADDRESS` |

*(A 7th key, `ROGUE_AUTHORIZER`, is technically also needed for a fully separate rogue-claim identity — generate one more if you want the rogue seller fully isolated from the honest one; otherwise it's fine to reuse `ENMA_AUTHORIZER` for both in the demo, since the rogue channel's claim gets rejected anyway and never actually pays out.)*

**Do not lose these.** If you close the terminal without copying one, just run `cast wallet new` again for a fresh replacement — nothing is funded yet at this point, so nothing is lost by generating a new one.

---

## Step 0.6 — Fund `OWNER`, `AGENT`, `GUARDIAN` with test ETH

These three need a small amount of Base Sepolia ETH to pay gas (a few cents worth, at most).

1. Go to a Base Sepolia faucet — easiest is **[Coinbase's own faucet](https://portal.cdp.coinbase.com/products/faucet)** or **[Alchemy's faucet](https://www.alchemy.com/faucets/base-sepolia)**.
2. Paste in `OWNER_ADDRESS` (the address, not the private key) → request funds.
3. Repeat for `AGENT_ADDRESS` and `GUARDIAN_ADDRESS`.
4. Faucets are usually capped at a small amount per request (often once per day) — that's fine, this build needs almost none.

**Verify:**
```bash
cast balance $OWNER_ADDRESS --rpc-url $RPC_URL
```
Should show a nonzero number (in wei — anything above `0` is enough to start).

---

## Step 0.7 — Fund `OWNER` with test USDC

1. Go to **[faucet.circle.com](https://faucet.circle.com/)**.
2. Select network: **Base Sepolia**.
3. Paste `OWNER_ADDRESS` → request. You get up to 20 test USDC per address every 2 hours — that's far more than this whole demo needs.

**Verify:**
```bash
cast call 0x036CbD53842c5426634e7929541eC2318f3dCF7e \
  "balanceOf(address)(uint256)" $OWNER_ADDRESS --rpc-url $RPC_URL
```
Should show `20000000` (20 USDC, since USDC has 6 decimal places).

---

## Step 0.8 — Brainbase account + narrator agent + Slack

1. Go to **[app.brainbaselabs.com](https://app.brainbaselabs.com)** and sign up (or log in with any hackathon credit/access given at kickoff — ask organizers if this isn't obvious).
2. Create a new agent. Name it something like `enma-narrator`.
3. Give it plain-English instructions, e.g.:
   > *"You watch events from the Enma x402 payment demo. When you receive an event (a payment, a QA revoke, a claim, a ban), summarize it in one friendly sentence and post it to the connected Slack channel."*
4. Connect Slack: in Brainbase's integrations/connections panel, connect your Slack workspace and pick (or create) a channel, e.g. `#enma-ops`.
5. Find your **API key**: usually under account/workspace settings → API Keys.
6. Find the **agent's ID**: usually shown on the agent's own page/URL once created.

**Put in `seller/.env`:**
```
BRAINBASE_API_KEY=<your key>
BRAINBASE_NARRATOR_AGENT_ID=<the agent's ID>
```

---

## Step 0.9 — Jev (TypeSafe) key — you're providing this

You mentioned you already have a key. When you're ready, give it to me and I'll put it directly into `buyer/.env` for you — or you can paste it in yourself:

**Put in `buyer/.env`:**
```
TYPESAFE_API_KEY=<your key>
```

**To verify it works, run this once you have it:**
```bash
curl -s -X POST https://api.typesafe.ai/v1/systemone \
  -H "Authorization: Bearer $TYPESAFE_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "state": "test",
    "model": "jev-latest",
    "questions": { "ok": { "type": "noul", "instructions": "Is this a test?" } }
  }'
```
Should return real JSON with an `answers.ok.noul` number between 0 and 1 — not an auth error.

---

## Step 0.10 — Stripe sandbox

1. Go to **[dashboard.stripe.com/register](https://dashboard.stripe.com/register)** and sign up.
2. Make sure you're in **Sandbox/Test mode** (toggle usually top-left or top-right of the dashboard).
3. Go to **Settings → Payment methods**, find **Stablecoins and Crypto**, and click to request access.
4. This may show as "Pending" for a while — that's fine, it's non-blocking. Nothing else in Phase 0 waits on this.
5. Get your **test secret key** from **Developers → API keys** (starts with `sk_test_`).

This key isn't in any `.env.example` yet since it's used later, in Phase 4 — keep it somewhere safe for now (a password manager, or a note), and I'll add it to `seller/.env` when Phase 4 starts.

---

## Step 0.11 — (Optional) Time a CDP signup

Only do this if you want to keep the door open for the mainnet stretch goal later (Phase 6). Skip it entirely if you'd rather not.

1. Go to **[portal.cdp.coinbase.com/create-account](https://portal.cdp.coinbase.com/create-account)**.
2. Sign up, and just note how long it actually takes from start to having a working account.
3. Tell me the result (instant / a few minutes / needed approval and a wait) — that answers the one open question in PLAN.md §4, and I'll update the plan accordingly.

---

## When you're done

Come back and tell me. I'll walk through each `.env` file with you (without you needing to paste the actual secrets into chat) to confirm nothing's missing, then we run Gate G0's verification checks together and move into Phase 1.
