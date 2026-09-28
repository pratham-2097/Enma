import { DurableObject } from "cloudflare:workers";
import { DashboardEventSchema, type DashboardEvent } from "@enma/shared/dashboardEvent.schema";

/**
 * A singleton DO (always addressed via `getByName("global")`) that fans dashboard
 * events out to every connected dashboard WebSocket client. Both SellerDO instances
 * ("enma" and "rogue" — Phase 3's identity split) and the buyer agent's /v1/events
 * POST all funnel into this one place, so the dashboard sees one unified timeline
 * without needing to know two independent seller identities exist (PLAN.md §14).
 *
 * Uses the Hibernation API (ctx.acceptWebSocket) so idle dashboard connections don't
 * keep this DO pinned in memory between events.
 */
export class EventHub extends DurableObject<Env> {
  async fetch(request: Request): Promise<Response> {
    if (request.headers.get("Upgrade") !== "websocket") {
      return new Response("expected a WebSocket upgrade", { status: 426 });
    }

    const { 0: client, 1: server } = new WebSocketPair();
    this.ctx.acceptWebSocket(server);
    return new Response(null, { status: 101, webSocket: client });
  }

  /**
   * Called via RPC by SellerDO instances and the Worker's /v1/events handler — both
   * of which already validate against DashboardEventSchema before calling this, so a
   * bad `event` here means a caller bug, not untrusted input. Validated again
   * defensively but never throws across the RPC boundary: a broadcast is fire-and-
   * forget everywhere it's called from, and a malformed event should be logged and
   * dropped, not allowed to surface as an unhandled rejection in the caller.
   */
  async broadcast(event: DashboardEvent): Promise<void> {
    const parsed = DashboardEventSchema.safeParse(event);
    if (!parsed.success) {
      console.error("EventHub.broadcast: dropping malformed event", parsed.error.message);
      return;
    }
    const payload = JSON.stringify(parsed.data);
    for (const socket of this.ctx.getWebSockets()) {
      try {
        socket.send(payload);
      } catch {
        // A socket that fails to send is already gone; webSocketClose/error will
        // clean it up. Broadcasting to the rest must not be interrupted by one dead peer.
      }
    }
  }

  async webSocketMessage(): Promise<void> {
    // Dashboard clients are receive-only; any inbound message is ignored.
  }

  /**
   * Completes the close handshake on our end. `code` can be 1005 ("no status
   * received") when the client closes without one, which the WebSocket API refuses
   * as an argument to `.close()` — pass nothing in that case rather than echoing it
   * back and throwing.
   */
  async webSocketClose(ws: WebSocket, code: number, reason: string): Promise<void> {
    if (code === 1005) {
      ws.close();
    } else {
      ws.close(code, reason);
    }
  }
}
