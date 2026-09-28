import { describe, it, expect } from "vitest";
import { Narrator } from "../../src/narrator";

/**
 * Live smoke test for the #enma-ops Slack Incoming Webhook. Requires
 * SLACK_OPS_WEBHOOK_URL in seller/.env (Slack app → Incoming Webhooks → Activate → Add
 * New Webhook to Workspace, per PLAN.md §13). Skipped by default (RUN_NARRATOR_SMOKE=1
 * to opt in), per this project's rule: no external integration is trusted on mocks alone.
 */
const RUN = process.env.RUN_NARRATOR_SMOKE === "1";

describe.skipIf(!RUN)("Narrator live smoke test", () => {
  it("posts a real message to the real Slack webhook and gets a 200 ok", async () => {
    const webhookUrl = process.env.SLACK_OPS_WEBHOOK_URL;
    if (!webhookUrl) {
      throw new Error("SLACK_OPS_WEBHOOK_URL must be set to run this test");
    }

    let sawResponse = false;
    let sawOk = false;
    const observingFetch: typeof fetch = async (input, init) => {
      const response = await fetch(input, init);
      sawResponse = true;
      sawOk = response.ok;
      if (!response.ok) {
        console.error(`Narrator live smoke: got ${response.status} ${response.statusText}`, await response.clone().text());
      }
      return response;
    };

    const narrator = new Narrator(webhookUrl, observingFetch);
    await narrator.notify({ kind: "claimed", payer: "0xSmokeTestPayer", amount: "10000" });

    expect(sawResponse).toBe(true);
    expect(sawOk).toBe(true);
  });
});
