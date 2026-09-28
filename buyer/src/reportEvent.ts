import type { DashboardEvent } from "@enma/shared/dashboardEvent.schema";

/**
 * Best-effort report of a buyer-side event (QA verdict, revoke) to the seller
 * Worker's /v1/events endpoint, which forwards it to the EventHub DO for the
 * dashboard (PLAN.md §14). QA verdicts and revoke decisions happen entirely in this
 * buyer process, never touching a SellerDO instance, so this is the only way the
 * dashboard learns about them. Never throws — a dashboard/network outage must never
 * affect the buyer's own purchase/QA/revoke flow.
 */
export async function reportEvent(
  sellerUrl: string,
  event: DashboardEvent,
  fetchImpl: typeof fetch = fetch,
): Promise<void> {
  try {
    const res = await fetchImpl(`${sellerUrl}/v1/events`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(event),
    });
    if (!res.ok) {
      console.error(`reportEvent: seller returned ${res.status}`);
    }
  } catch (err) {
    console.error("reportEvent: failed to reach seller", err);
  }
}
