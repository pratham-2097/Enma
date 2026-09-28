// Phase 6 demo runner (docs/PLAN.md §16). Drives each demo beat live against a real
// `wrangler dev` (seller/) + real Base Sepolia, narrating each step to the console so
// it doubles as the script for a live run or a backup-video recording.
//
// Usage (from buyer/):
//   npx tsx scripts/runDemo.ts            # beats 1-4 and 6 (fast, ~30s total)
//   npx tsx scripts/runDemo.ts --mad      # beat 5 only (slow, several minutes —
//                                         # waits out the seller's real alarm cadence)
//   npx tsx scripts/runDemo.ts --all      # everything, in order
//
// Before running: `npx tsx scripts/restoreSellers.ts` to reset the shared testnet
// fixture, and make sure `wrangler dev` is running in seller/.
import "dotenv/config";
import { baseSepolia } from "viem/chains";
import type { Address, Hex } from "viem";
import type { AgentConfig } from "../src/agent";
import { runBuy, runShady } from "../src/agent";
import { buySignal } from "../src/buySignal";
import { revokeSeller } from "../src/revoke";
import { reportEvent } from "../src/reportEvent";
import { parseFlaggedSellers } from "../src/flaggedSellers";
import { restoreIfRevoked } from "../src/restoreSellers";

function requireEnv(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`missing required env var ${name}`);
  return v;
}

const baseSellerUrl = process.env.SELLER_URL ?? "http://localhost:8787";

const baseConfig: Omit<AgentConfig, "sellerUrl"> = {
  chain: baseSepolia,
  rpcUrl: requireEnv("RPC_URL"),
  escrowAddress: "0x4020074e9dF2ce1deE5A9C1b5c3f541D02a10003" as Address,
  usdcAddress: "0x036CbD53842c5426634e7929541eC2318f3dCF7e" as Address,
  guardAddress: requireEnv("ENMA_GUARD_ADDRESS") as Address,
  ownerPrivateKey: requireEnv("OWNER_PRIVATE_KEY") as Hex,
  agentPrivateKey: requireEnv("AGENT_PRIVATE_KEY") as Hex,
  guardianPrivateKey: requireEnv("GUARDIAN_PRIVATE_KEY") as Hex,
  jevApiKey: process.env.TYPESAFE_API_KEY || undefined,
  flaggedSellers: parseFlaggedSellers(process.env.FLAGGED_SELLERS),
};

const honestConfig: AgentConfig = { ...baseConfig, sellerUrl: baseSellerUrl };
const rogueConfig: AgentConfig = { ...baseConfig, sellerUrl: `${baseSellerUrl}/rogue` };

function beat(n: number, title: string) {
  console.log(`\n${"=".repeat(60)}\nBEAT ${n}: ${title}\n${"=".repeat(60)}`);
}

function say(line: string) {
  console.log(`  ${line}`);
}

async function beat1Purchase() {
  beat(1, "The purchase");
  say("Buying AAPL sentiment from the honest seller...");
  const result = await runBuy(honestConfig, "AAPL");
  say(`Status: ${result.status}, revoked: ${result.revoked}`);
  say(JSON.stringify(result.body, null, 2));
  if (result.status !== 200 || result.revoked) {
    throw new Error("beat 1 expected a clean 200, unrevoked purchase");
  }
  say("✓ 402 → voucher → sentiment_index → QA ✓ — watch the dashboard's 3 lanes light up.");
}

async function beat2CashOut() {
  beat(2, "The cash-out");
  say("The seller's own alarm (75s cadence) claims this in the background.");
  say("Watch #enma-ops in Slack and the dashboard's Escrow lane for the claim + Basescan link.");
  say("(Not driven by the buyer — this happens automatically. Skipping an active wait here;");
  say(" beat 5 below waits out a real alarm cycle anyway.)");
}

async function beat3Save() {
  beat(3, "The save");
  say("Buying from the ROGUE seller (it goes rogue starting with its 2nd call ever —");
  say("its per-asset call counter is cumulative across every run against this shared");
  say("testnet fixture, so this may already be well past that point)...");
  // The counter's exact position isn't knowable ahead of time (fresh local state vs.
  // a seasoned one from earlier runs both happen), so try up to twice: the 1st call
  // could be the still-honest call-#1, in which case the 2nd is guaranteed rogue.
  let result = await runBuy(rogueConfig, "AAPL");
  if (!result.revoked) {
    say("(that was still an honest call — trying once more, which must be rogue)");
    result = await runBuy(rogueConfig, "AAPL");
  }
  say(`Status: ${result.status}, revoked: ${result.revoked}`);
  say(JSON.stringify(result.body, null, 2));
  if (!result.revoked) {
    throw new Error("beat 3 expected the rogue seller to fail QA and get revoked");
  }
  say(`✓ DATA INVALID: REVOKING VOUCHER — revoke tx: ${result.revokeTx}`);
  say(`  https://sepolia.basescan.org/tx/${result.revokeTx}`);
}

async function beat4Revert() {
  beat(4, "The revert");
  say("The rogue seller's next claim attempt for that voucher will now revert at the");
  say("escrow (EnmaGuard.revoke() makes every future claim on that channel fail).");
  say("This shows up as a CLAIM REJECTED / qa_schema_fail-equivalent in the wrangler");
  say("dev log and an 'incident' event on the dashboard's Escrow lane on the next");
  say("alarm cycle — see beat 5, which waits out that same cycle.");
}

/**
 * Opens 3 independent channels (different tickers, so no AI Gateway cache overlap)
 * against the HONEST seller, paying for genuinely good data on each — then revokes
 * the seller ONCE. EnmaGuard.revoke() is per-SELLER, not per-channel, so a single
 * revoke makes every one of these 3 already-signed vouchers unclaimable at once.
 *
 * This avoids the revoke→restore→revoke dance entirely: no restore, no race against
 * the facilitator's own RPC catching up mid-sequence — the kind of cross-system
 * propagation timing this project's own experience says not to chase with more waits
 * (see the "live testnet debugging" memory/feedback from the buyer+QA build). All 3
 * channels get revoked together, once, cleanly.
 */
async function beat5Mad() {
  beat(5, "MAD — the cheat buyer gets banned");
  say("Buying genuinely good data on 3 independent channels from the honest seller...");
  const assets = ["AAPL", "TSLA", "GOOG"];
  const purchases: Awaited<ReturnType<typeof buySignal>>[] = [];
  for (const asset of assets) {
    const purchase = await buySignal({
      chain: honestConfig.chain,
      rpcUrl: honestConfig.rpcUrl,
      sellerUrl: honestConfig.sellerUrl,
      asset,
      escrowAddress: honestConfig.escrowAddress,
      usdcAddress: honestConfig.usdcAddress,
      guardAddress: honestConfig.guardAddress,
      ownerPrivateKey: honestConfig.ownerPrivateKey,
      agentPrivateKey: honestConfig.agentPrivateKey,
    });
    say(`${asset}: status ${purchase.status}`);
    if (purchase.status !== 200) {
      throw new Error(`beat 5 purchase for ${asset} failed (status ${purchase.status})`);
    }
    purchases.push(purchase);
  }

  say("All 3 channels paid for genuinely good data. Revoking the seller ONCE — this");
  say("makes all 3 already-signed vouchers unclaimable at the next alarm cycle...");
  const seller = purchases[0].seller;
  const revokeTx = await revokeSeller({
    chain: honestConfig.chain,
    rpcUrl: honestConfig.rpcUrl,
    guardAddress: honestConfig.guardAddress,
    guardianPrivateKey: honestConfig.guardianPrivateKey,
    seller,
    reasonCode: 99, // "cheat" — distinct from any real QA failure code
  });
  say(`✓ revoke tx: ${revokeTx}`);
  say(`  https://sepolia.basescan.org/tx/${revokeTx}`);
  for (const purchase of purchases) {
    await reportEvent(honestConfig.sellerUrl, { kind: "revoked", seller, payer: purchase.cfg.payer, txHash: revokeTx });
  }

  say("Waiting ~80s for the seller's own alarm cycle to see all 3 failed claims and ban...");
  await new Promise((resolve) => setTimeout(resolve, 80_000));
  say("Check the dashboard's Escrow lane / counters — bans should now read 1, and the");
  say("next request from this payer gets 402 pre-verify (no facilitator round-trip).");

  say("Restoring the seller so it's clean for the next rehearsal or the real demo...");
  await restoreIfRevoked(baseSepolia, honestConfig.rpcUrl, honestConfig.guardAddress, honestConfig.guardianPrivateKey, [
    { label: "enma", address: requireEnv("ENMA_RECEIVER_ADDRESS") as Address },
  ]);

  await resetLedgerIfConfigured(purchases[0].cfg.payer, honestConfig.sellerUrl);
  await resetLedgerIfConfigured(purchases[0].cfg.payer, rogueConfig.sellerUrl);
}

/**
 * Clears the just-banned payer's ledger history via POST /admin/reset-ledger, so the
 * NEXT rehearsal's beat 1 doesn't immediately hit a real 402 from a still-banned
 * payer. The MAD ban ledger has no natural decay or per-run scoping — cfg.payer is
 * always the guard address for every buyer (see buyer/src/openTab.ts), so a real ban
 * from one rehearsal otherwise blocks every subsequent one, including the real demo.
 * Called once per seller URL — the honest and rogue SellerDOs keep independent
 * ledgers, and beat 3 can leave the rogue one banned even when the honest one is clean.
 * Silently skipped if ADMIN_TOKEN isn't set — this is a rehearsal convenience, not a
 * requirement.
 */
async function resetLedgerIfConfigured(payer: string, sellerUrl: string): Promise<void> {
  const adminToken = process.env.ADMIN_TOKEN;
  if (!adminToken) {
    say("(ADMIN_TOKEN not set — skipping the ledger reset; the seller's ban will");
    say(" persist until you POST /admin/reset-ledger yourself. See .env.example.)");
    return;
  }
  try {
    const res = await fetch(`${sellerUrl}/admin/reset-ledger`, {
      method: "POST",
      headers: { "Content-Type": "application/json", authorization: `Bearer ${adminToken}` },
      body: JSON.stringify({ payer }),
    });
    say(res.ok ? `✓ ledger reset for the next rehearsal (${sellerUrl}).` : `⚠ ledger reset returned ${res.status} (${sellerUrl})`);
  } catch (err) {
    say(`⚠ ledger reset request failed (${sellerUrl}): ${err}`);
  }
}

async function beat6Shady() {
  beat(6, "Shady seller — refused before any voucher exists");
  if ((honestConfig.flaggedSellers ?? []).length === 0) {
    say("⚠ FLAGGED_SELLERS is empty — set it to the rogue seller's receiver address");
    say("  in buyer/.env to run this beat (see .env.example).");
    return;
  }
  say("Attempting a shady-mode purchase from the rogue seller (its address is flagged)...");
  const result = await runShady(rogueConfig, "AAPL");
  say(`refused: ${result.refused}, reason: ${result.reason}`);
  if (!result.refused) {
    throw new Error("beat 6 expected the buyer to refuse a flagged seller before signing a voucher");
  }
  say("✓ REFUSED: payTo flagged — no voucher signed, no funds ever at risk.");
}

async function restoreBothSellers() {
  say("Restoring both sellers to a clean (unrevoked) state before the run...");
  await restoreIfRevoked(baseSepolia, honestConfig.rpcUrl, honestConfig.guardAddress, honestConfig.guardianPrivateKey, [
    { label: "enma", address: requireEnv("ENMA_RECEIVER_ADDRESS") as Address },
    { label: "rogue", address: requireEnv("ROGUE_RECEIVER_ADDRESS") as Address },
  ]);
}

async function main() {
  await restoreBothSellers();
  const mode = process.argv[2];
  if (mode === "--mad") {
    await beat5Mad();
  } else if (mode === "--all") {
    await beat1Purchase();
    await beat2CashOut();
    await beat3Save();
    await beat4Revert();
    await beat6Shady();
    await beat5Mad();
  } else {
    await beat1Purchase();
    await beat2CashOut();
    await beat3Save();
    await beat4Revert();
    await beat6Shady();
    console.log("\n(Skipped beat 5/MAD — it takes several minutes. Run with --mad or --all.)");
  }
  console.log("\nDemo run complete.");
}

main().catch((err) => {
  console.error("\nDEMO RUN FAILED:", err);
  process.exit(1);
});
