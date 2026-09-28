import { DashboardEventSchema } from "@enma/shared/dashboardEvent.schema";

export { SellerDO } from "./sellerDO";
export { EventHub } from "./eventHub";

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    // Dashboard WebSocket clients connect here directly — the EventHub is the single
    // fan-out point across both seller identities (PLAN.md §14).
    if (url.pathname === "/ws") {
      const hub = env.EVENT_HUB.get(env.EVENT_HUB.idFromName("global"));
      return hub.fetch(request);
    }

    // The buyer agent posts its own QA verdict here (best-effort, fire-and-forget —
    // see buyer/src/agent.ts) since QA runs in the buyer's own process, never touching
    // a SellerDO instance. Matched with or without the /rogue prefix: the buyer's
    // sellerUrl is "http://.../rogue" when talking to the rogue seller (so its own
    // /v1/signal/* calls route correctly), and it POSTs events to `${sellerUrl}/v1/events`
    // — without this, that becomes /rogue/v1/events and 404s inside the rogue SellerDO's
    // own Hono app instead of ever reaching the EventHub.
    if ((url.pathname === "/v1/events" || url.pathname === "/rogue/v1/events") && request.method === "POST") {
      const parsed = DashboardEventSchema.safeParse(await request.json().catch(() => undefined));
      if (!parsed.success) {
        return Response.json({ ok: false, error: "invalid event" }, { status: 400 });
      }
      const hub = env.EVENT_HUB.get(env.EVENT_HUB.idFromName("global"));
      await hub.broadcast(parsed.data);
      return Response.json({ ok: true });
    }

    // Everything under /v1/*, /healthz, /admin/* is the seller API; everything else
    // (the dashboard's static page) is served from Workers Assets (PLAN.md §14.1).
    const isApiRoute =
      url.pathname.startsWith("/v1/") ||
      url.pathname === "/healthz" ||
      url.pathname.startsWith("/admin/") ||
      url.pathname.startsWith("/rogue/");

    if (!isApiRoute) {
      return env.ASSETS.fetch(request);
    }

    // A separate DO instance and a separate on-chain identity (ROGUE_RECEIVER_ADDRESS),
    // so revoking the rogue seller never touches the honest seller's money.
    const isRogue = url.pathname.startsWith("/rogue/");
    const name = isRogue ? "rogue" : "enma";

    const id = env.SELLER_DO.idFromName(name);
    const stub = env.SELLER_DO.get(id);

    const forwardedRequest = isRogue
      ? new Request(new URL(url.pathname.replace(/^\/rogue/, ""), url), request)
      : request;

    return stub.fetch(forwardedRequest);
  },
};
