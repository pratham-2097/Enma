export type NarratorEvent =
  | { kind: "incident"; payer: string; amount: string }
  | { kind: "banned"; payer: string }
  | { kind: "claimed"; payer: string; amount: string };

/** One plain-English sentence per event, posted to the #enma-ops Slack channel. */
export function formatNarratorMessage(event: NarratorEvent): string {
  switch (event.kind) {
    case "incident":
      return `Payer ${event.payer}'s voucher for ${event.amount} atomic units was revoked before the seller could claim it.`;
    case "banned":
      return `Payer ${event.payer} has been banned for excessive revocations.`;
    case "claimed":
      return `Claimed ${event.amount} atomic units from payer ${event.payer}.`;
  }
}

type FetchFn = typeof fetch;

/**
 * Best-effort ops notifier: posts each event straight to a Slack Incoming Webhook for
 * #enma-ops (PLAN.md §13, revised — Brainbase's runtime "send a message to an agent" API
 * is undocumented and its Slack integration relays via per-task MCP replies rather than a
 * simple push endpoint, so the direct webhook is the fast, fully-documented path). Never
 * throws — a narrator outage must never affect the claim/ledger path it's reporting on.
 */
export class Narrator {
  constructor(
    private readonly webhookUrl: string | undefined,
    // Bound rather than the bare `fetch` reference: Workers' native fetch is sensitive
    // to its receiver, and calling it as `this.fetchImpl(...)` later (detached from
    // globalThis) throws "Illegal invocation" if it isn't bound up front.
    private readonly fetchImpl: FetchFn = fetch.bind(globalThis),
  ) {}

  async notify(event: NarratorEvent): Promise<void> {
    if (!this.webhookUrl) return;

    try {
      const response = await this.fetchImpl(this.webhookUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: formatNarratorMessage(event) }),
      });
      if (!response.ok) {
        console.error(`Narrator: Slack webhook returned ${response.status}`);
      }
    } catch (err) {
      console.error("Narrator: failed to post to Slack webhook", err);
    }
  }
}
