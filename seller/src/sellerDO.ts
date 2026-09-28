import { DurableObject } from "cloudflare:workers";
import { Hono } from "hono";
import { paymentMiddleware, x402ResourceServer } from "@x402/hono";
import { HTTPFacilitatorClient } from "@x402/core/server";
import type { RoutesConfig, VerifyContext, VerifyResultContext, FacilitatorClient } from "@x402/core/server";
import { BatchSettlementEvmScheme, type BatchSettlementChannelManager } from "@x402/evm/batch-settlement/server";
import type { BatchSettlementVoucherPayload } from "@x402/evm";
import { privateKeyToAccount } from "viem/accounts";
import type { DashboardEvent } from "@enma/shared/dashboardEvent.schema";
import { DoChannelStorage } from "./doChannelStorage";
import { DoLedgerStorage } from "./doLedgerStorage";
import { Ledger } from "./ledger";
import { Narrator } from "./narrator";
import { transformSignal, TransformError } from "./transform";
import { fetchUpstreamPosts } from "./upstream";

/** Best-effort broadcast to the dashboard's EventHub — must never affect the request/claim path it reports on. */
async function broadcastToHub(env: Env, event: DashboardEvent): Promise<void> {
  try {
    const hub = env.EVENT_HUB.get(env.EVENT_HUB.idFromName("global"));
    await hub.broadcast(event);
  } catch (err) {
    console.error("EventHub broadcast failed", err);
  }
}

const NETWORK = "eip155:84532" as const;
const CLAIM_INTERVAL_SECS = 75; // the seller's own claim cadence — the "safety window" per PLAN.md §2.2

export class SellerDO extends DurableObject<Env> {
  readonly channelStorage: DoChannelStorage;
  readonly ledger: Ledger;
  readonly narrator: Narrator;
  readonly channelManager: BatchSettlementChannelManager;
  private readonly app: Hono;

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    this.channelStorage = new DoChannelStorage(ctx.storage.sql);
    this.ledger = new Ledger(new DoLedgerStorage(ctx.storage.sql));
    this.narrator = new Narrator(env.SLACK_OPS_WEBHOOK_URL || undefined);
    ctx.storage.sql.exec(
      `CREATE TABLE IF NOT EXISTS rogue_call_counts (asset TEXT PRIMARY KEY, calls INTEGER NOT NULL)`,
    );

    const isRogue = ctx.id.name === "rogue";
    const receiverAddress = isRogue ? env.ROGUE_RECEIVER_ADDRESS : env.ENMA_RECEIVER_ADDRESS;
    const authorizerPrivateKey = isRogue ? env.ROGUE_AUTHORIZER_PRIVATE_KEY : env.ENMA_AUTHORIZER_PRIVATE_KEY;

    const facilitator = new HTTPFacilitatorClient({ url: "https://x402.org/facilitator" });
    const authorizerSigner = privateKeyToAccount(authorizerPrivateKey as `0x${string}`);
    const scheme = new BatchSettlementEvmScheme(receiverAddress as `0x${string}`, {
      storage: this.channelStorage,
      withdrawDelay: 900,
      receiverAuthorizerSigner: authorizerSigner,
    });

    this.channelManager = scheme.createChannelManager(facilitator, NETWORK);
    this.app = buildApp(env, scheme, facilitator, this.ledger, this.shouldServeRogue.bind(this), {
      isRogue,
      receiverAddress,
      sellerLabel: isRogue ? "rogue" : "enma",
    });

    ctx.blockConcurrencyWhile(async () => {
      const current = await ctx.storage.getAlarm();
      if (current === null) {
        await ctx.storage.setAlarm(Date.now() + CLAIM_INTERVAL_SECS * 1000);
      }
    });
  }

  async fetch(request: Request): Promise<Response> {
    return this.app.fetch(request);
  }

  /**
   * Counts this call for `asset` and reports whether the rogue threshold has been
   * crossed: calls 1..rogueAfter are honest, every call after that serves junk while
   * still charging — the demo's "rogue seller" beat.
   */
  async shouldServeRogue(asset: string, opts: { rogueAfter: number }): Promise<boolean> {
    const rows = [
      ...this.ctx.storage.sql.exec("SELECT calls FROM rogue_call_counts WHERE asset = ?", asset),
    ] as { calls: number }[];
    const nextCalls = (rows[0]?.calls ?? 0) + 1;
    this.ctx.storage.sql.exec(
      `INSERT INTO rogue_call_counts (asset, calls) VALUES (?, ?)
       ON CONFLICT(asset) DO UPDATE SET calls = excluded.calls`,
      asset,
      nextCalls,
    );
    return nextCalls > opts.rogueAfter;
  }

  /**
   * Claims one channel at a time (PLAN.md §2.3) so a single revoked/QA-flagged voucher
   * can never jam a batch of otherwise-honest claims — and, since @x402/evm's
   * submitClaim() THROWS rather than returning a per-claim result, isolating each claim
   * in its own try/catch here is what actually makes that isolation hold across the
   * whole alarm cycle: an uncaught throw from claimAndSettle() would otherwise abort
   * every later claim in this cycle AND skip rescheduling the next alarm entirely,
   * silently stopping the seller from ever claiming again after the first revoke.
   *
   * A claim that fails this way is exactly a revoked voucher reaching the escrow —
   * the buyer's own MAD signal — so it's recorded as an incident against that payer.
   */
  async alarm(): Promise<void> {
    const claimable = await this.channelManager.getClaimableVouchers();
    const sellerLabel = this.ctx.id.name === "rogue" ? "rogue" : "enma";
    const claimedThisCycle: { payer: string; amount: string }[] = [];

    for (const entry of claimable) {
      const payer = entry.voucher.channel.payer;
      const amount = entry.totalClaimed;
      try {
        await this.channelManager.claim({
          maxClaimsPerBatch: 1,
          selectClaimChannels: (channels) =>
            channels.filter((c) => c.channelConfig.salt === entry.voucher.channel.salt),
        });
        claimedThisCycle.push({ payer, amount });
      } catch (err) {
        console.error(`claim failed for payer ${payer}, salt ${entry.voucher.channel.salt}:`, err);
        const wasBanned = await this.ledger.isBanned(payer);
        await this.ledger.recordIncident(payer, amount);
        await this.narrator.notify({ kind: "incident", payer, amount });
        await broadcastToHub(this.env, { kind: "incident", seller: sellerLabel, payer, amount });
        if (!wasBanned && (await this.ledger.isBanned(payer))) {
          await this.narrator.notify({ kind: "banned", payer });
          await broadcastToHub(this.env, { kind: "banned", seller: sellerLabel, payer });
        }
      }
    }

    if (claimedThisCycle.length > 0) {
      // One settle transaction pays out every claim made this cycle together, so its
      // tx hash is shared across all of them for the dashboard's Basescan links. This
      // can throw even after a successful claim() (e.g. "nothing to settle" if the
      // claimed amount nets to zero for this receiver/token) — isolated in its own
      // try/catch so a settle failure can never skip the setAlarm() below, which would
      // otherwise silently stop this DO from ever claiming again.
      try {
        const { transaction: txHash } = await this.channelManager.settle();
        for (const { payer, amount } of claimedThisCycle) {
          await this.narrator.notify({ kind: "claimed", payer, amount });
          await broadcastToHub(this.env, { kind: "claimed", seller: sellerLabel, payer, amount, txHash });
        }
      } catch (err) {
        console.error("settle failed for this cycle's claims:", err);
      }
    }

    await this.ctx.storage.setAlarm(Date.now() + CLAIM_INTERVAL_SECS * 1000);
  }
}

function buildApp(
  env: Env,
  scheme: BatchSettlementEvmScheme,
  facilitator: FacilitatorClient,
  ledger: Ledger,
  shouldServeRogue: (asset: string, opts: { rogueAfter: number }) => Promise<boolean>,
  identity: { isRogue: boolean; receiverAddress: string; sellerLabel: "enma" | "rogue" },
): Hono {
  const app = new Hono();

  app.get("/healthz", (c) => c.text("ok"));

  // Admin-only: clears a payer's served/incident history, un-banning them. Exists
  // because the MAD ban ledger has no natural decay or per-run scoping — every
  // rehearsal against the same shared testnet payer (cfg.payer is always the guard
  // address, see buyer/src/openTab.ts) accumulates permanently, so a real ban from
  // one rehearsal otherwise blocks every subsequent one and the eventual real demo.
  app.post("/admin/reset-ledger", async (c) => {
    const auth = c.req.header("authorization");
    if (!env.ADMIN_TOKEN || auth !== `Bearer ${env.ADMIN_TOKEN}`) {
      return c.json({ error: "unauthorized" }, 401);
    }
    const body = await c.req.json().catch(() => undefined);
    const payer = (body as { payer?: unknown } | undefined)?.payer;
    if (typeof payer !== "string" || payer.length === 0) {
      return c.json({ error: "missing payer" }, 400);
    }
    await ledger.reset(payer);
    return c.json({ ok: true });
  });

  const routes: RoutesConfig = {
    "/v1/signal/*": {
      accepts: {
        scheme: "batch-settlement",
        network: NETWORK,
        payTo: identity.receiverAddress,
        price: "$0.01",
        extra: { maxClaimsPerBatch: 1 },
      },
    },
  };

  const resourceServer = new x402ResourceServer(facilitator).register(NETWORK, scheme);

  // Ban check runs before verification, so a banned payer never even costs a facilitator round-trip.
  resourceServer.onBeforeVerify(async (context: VerifyContext) => {
    const payer = extractPayer(context.paymentPayload as unknown as { payload: unknown });
    if (payer && (await ledger.isBanned(payer))) {
      return { abort: true, reason: "payer_banned", message: "This payer has been banned for excessive revocations." };
    }
  });

  resourceServer.onAfterVerify(async (context: VerifyResultContext) => {
    const payer = extractPayer(context.paymentPayload as unknown as { payload: unknown });
    if (payer) {
      await ledger.recordServed(payer, context.requirements.amount);
      const transport = context.transportContext as { request?: { decodedPath?: string; path?: string } } | undefined;
      await broadcastToHub(env, {
        kind: "data_served",
        seller: identity.sellerLabel,
        asset: extractAssetFromPath(transport?.request?.decodedPath ?? transport?.request?.path),
        payer,
        amount: context.requirements.amount,
      });
    }
  });

  // paymentMiddleware intercepts and returns the 402 itself for an unpaid request —
  // it never reaches the GET handler below — so the payment_required broadcast has
  // to happen here, ahead of it, to ever fire for a genuinely unpaid request.
  app.use("/v1/signal/:asset", async (c, next) => {
    if (!c.req.header("payment-signature")) {
      await broadcastToHub(env, { kind: "payment_required", seller: identity.sellerLabel, asset: c.req.param("asset") });
    }
    await next();
  });

  app.use("/v1/signal/*", paymentMiddleware(routes, resourceServer));

  app.get("/v1/signal/:asset", async (c) => {
    const asset = c.req.param("asset");
    const rogueAfterEnv = resolveRogueAfterEnv(env.ROGUE_AFTER, identity.isRogue);
    const rogue = await resolveRogueDecision(
      { asset, rogueAfterEnv, forceHeader: c.req.header("x-enma-force-rogue") ?? null },
      shouldServeRogue,
    );
    const upstreamText = fetchUpstreamPosts(asset, { rogue });

    try {
      const signal = await transformSignal({
        asset,
        upstreamText,
        apiKey: env.ANTHROPIC_API_KEY,
        gatewayUrl: `https://gateway.ai.cloudflare.com/v1/${env.CF_ACCOUNT_ID}/${env.CF_AI_GATEWAY_NAME}/anthropic/v1/messages`,
        cacheKey: buildTransformCacheKey({ isRogue: identity.isRogue, asset, rogueThisRequest: rogue }),
      });
      return c.json(signal);
    } catch (err) {
      if (err instanceof TransformError) {
        return c.json({ error: err.message }, 503);
      }
      throw err;
    }
  });

  return app;
}

function extractPayer(payload: { payload: unknown }): string | undefined {
  const inner = payload.payload as Partial<BatchSettlementVoucherPayload> | undefined;
  return inner?.channelConfig?.payer;
}

/** Pulls the ticker off `/v1/signal/AAPL` (or `/rogue/v1/signal/AAPL`, already stripped by index.ts). */
function extractAssetFromPath(path: string | undefined): string {
  return path?.split("/").filter(Boolean).pop() ?? "";
}

/**
 * Decides whether this one request should get rogue (junk) upstream data.
 *
 * `forceHeader` (X-Enma-Force-Rogue) always wins and doesn't touch the per-asset call
 * counter — it's for tests and demos that need rogue behavior on demand, without
 * disturbing ROGUE_AFTER's own "goes rogue after N calls" story for other requests.
 */
export async function resolveRogueDecision(
  opts: { asset: string; rogueAfterEnv: string | undefined; forceHeader: string | null },
  shouldServeRogue: (asset: string, opts: { rogueAfter: number }) => Promise<boolean>,
): Promise<boolean> {
  if (opts.forceHeader) return true;

  const rogueAfter = Number(opts.rogueAfterEnv ?? "");
  if (!Number.isFinite(rogueAfter) || rogueAfter <= 0) return false;

  return shouldServeRogue(opts.asset, { rogueAfter });
}

/**
 * The rogue instance goes rogue from call 2 onward by default (PRD §S8's "still
 * charges" beat) — the honest instance never does unless ROGUE_AFTER is explicitly
 * set. `env.ROGUE_AFTER` can be an empty string rather than truly absent (e.g. a
 * blank line in .dev.vars/.env, which Wrangler passes through as `""`, not
 * undefined) — `??` alone doesn't fall back on that, so this must use `||`. Without
 * this, the rogue instance silently never goes rogue: `Number("")` is `0`, which
 * `resolveRogueDecision` treats as "ROGUE_AFTER not set" and returns honest forever.
 */
export function resolveRogueAfterEnv(rogueAfterEnv: string | undefined, isRogue: boolean): string | undefined {
  return isRogue ? rogueAfterEnv || "1" : rogueAfterEnv;
}

/**
 * The AI Gateway cache key must be scoped per seller identity AND per this specific
 * request's own rogue/honest decision, not just identity+asset. The rogue instance's
 * own still-honest call #1 (or any earlier call within cf-aig-cache-ttl) otherwise
 * gets served back verbatim on a later call that should have gone rogue — the two
 * calls hit the same {identity}:{asset} key even though their upstream input (and
 * therefore what SHOULD be cached) differs. This is what actually makes "the rogue
 * seller serves junk starting with its 2nd call" true within the cache window, not
 * just true of the uncached upstream text.
 */
export function buildTransformCacheKey(opts: { isRogue: boolean; asset: string; rogueThisRequest: boolean }): string {
  return `${opts.isRogue ? "rogue" : "enma"}:${opts.asset}:${opts.rogueThisRequest ? "junk" : "honest"}`;
}
