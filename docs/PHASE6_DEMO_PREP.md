# Phase 6 — Demo prep: rehearsal bug fixes

**Date:** 2026-09-28
**Follows:** Phase 6's initial demo runner and rehearsals (`357c7a2`), which built `buyer/scripts/runDemo.ts` (drives all 6 demo beats live) and proved two full clean rehearsals end-to-end.
**This session:** two more production rehearsal attempts failed identically at beat 3. Root-caused and fixed both real bugs found along the way, then verified a clean end-to-end run. Committed as `ef44f43`.

---

## 1. Symptom

Beat 3 ("the save" — buying from the rogue seller, expecting the second call to serve rogue data and get revoked) failed with the rogue seller's paid request returning `402` and an empty body (`{}`), where a successful rogue-flagged `200` was expected.

## 2. Bug #1 (real, fixed): channel salt collision

`buyer/src/buySignal.ts` generated each channel's salt as:

```ts
salt: ("0x" + Date.now().toString(16).padStart(64, "0")) as Hex
```

Millisecond-resolution timestamp only. Two `buySignal` calls in quick succession (e.g. beat 3's "try again if the first call was still honest" retry) can land on the same millisecond, producing an identical salt and therefore an identical `channelId` for both channels — breaking the second `openTab`/purchase. Confirmed via a standalone `Date.now()` loop that repeated values occur across synchronous rapid calls.

**Fix:** `buySignal.ts` now derives the salt from an 8-byte timestamp plus 24 bytes from `node:crypto`'s `randomBytes`, giving a proper 32-byte (`bytes32`) salt that cannot collide regardless of timing:

```ts
function freshSalt(): Hex {
  const timestamp = Date.now().toString(16).padStart(16, "0"); // 8 bytes
  const random = randomBytes(24).toString("hex"); // 24 bytes, total = 32 bytes (bytes32)
  return ("0x" + timestamp + random) as Hex;
}
```

No existing unit test asserted on the salt's exact format, so nothing else needed updating.

## 3. Bug #2 (the actual root cause of the beat-3 failures): rogue seller's MAD ban not reset

Fixing bug #1 alone did **not** fix the live failure — a follow-up diagnostic run against production still 402'd on both calls, including the first ("honest") one. Tailing `wrangler tail` and inspecting `seller/src/sellerDO.ts` showed the request handler ran fine; the 402 was coming from `paymentMiddleware`'s `onBeforeVerify` hook, which aborts before any facilitator round-trip if `ledger.isBanned(payer)`.

Every buyer resolves to the **same** `cfg.payer` (the `EnmaGuard` address itself, not a per-buyer EOA — an EIP-1271 signature-scheme artifact, not a bug; see Phase 5's dashboard writeup). So a previous failed rehearsal's incidents against the **rogue** SellerDO had banned that shared payer identity, and the ban persisted into this session's runs.

This project already has a `POST /admin/reset-ledger` endpoint (ADMIN_TOKEN-gated) for clearing a payer's ban — but `buyer/scripts/runDemo.ts`'s `resetLedgerIfConfigured` only calls it against the **honest** seller's URL, and only runs automatically after beat 5. It never resets the **rogue** SellerDO's independent ledger, so a run that fails partway through beat 3 (revoking the rogue seller) leaves the rogue ledger banned with no automatic cleanup path.

**Fix applied this session:** manually reset both ledgers before the verifying run:

```bash
curl -X POST "$SELLER_URL/admin/reset-ledger" -H "authorization: Bearer $ADMIN_TOKEN" -d "{\"payer\":\"$ENMA_GUARD_ADDRESS\"}"
curl -X POST "$SELLER_URL/rogue/admin/reset-ledger" -H "authorization: Bearer $ADMIN_TOKEN" -d "{\"payer\":\"$ENMA_GUARD_ADDRESS\"}"
```

**Not yet done:** `runDemo.ts` itself was not changed to reset both seller paths automatically. Worth doing before the real demo, so a failed rehearsal never requires this manual step again.

## 4. Verification

- `buyer/` unit suite: 37/37 passing after the salt fix.
- `seller/` unit suite: 92/92 passing (unrelated to this session's changes, includes the already-in-flight dashboard-rebuild test updates from a separate session).
- Live, full `npx tsx scripts/runDemo.ts --all` against production (`https://enma.prabhupv.workers.dev` + real Base Sepolia), after resetting both ledgers: all 6 beats passed clean, including beat 3 correctly serving and revoking the genuinely rogue signature (`sentiment_index: 50, confidence: 0.05, n_sources: 0` — distinct from the honest `72/0.55/3`) and beat 5's MAD-ban/restore cycle.
- On-chain revocation state (`cast call $ENMA_GUARD_ADDRESS "revocations(address)(bool,uint32)" <address>`) confirmed clean (`false`) for both sellers before the run, and both sellers were restored to clean + unbanned after.

## 5. What shipped (commit `ef44f43`)

- `buyer/src/buySignal.ts` — collision-proof `freshSalt()`.
- `seller/src/ledger.ts`, `seller/src/doLedgerStorage.ts`, `seller/src/sellerDO.ts` — `POST /admin/reset-ledger` endpoint (staged from an earlier point in this session, committed together since both fixes serve the same "rehearsals need to reliably reset to clean state" goal).
- `seller/test/adminResetLedger.test.ts` (new), `seller/test/doLedgerStorage.test.ts`, `seller/test/ledger.test.ts` — coverage for the reset endpoint.
- `buyer/scripts/runDemo.ts`, `buyer/.env.example` — wiring for the (honest-seller-only) automatic reset call.

## 6. Out of scope / explicitly not touched this session

- `seller/dashboard-src/` and the React/shadcn dashboard rebuild it produced in `seller/public/` — this is separate, already-documented work from another session (see `docs/PHASE5B_DASHBOARD_REDESIGN.md`), left untouched here.
- The Phase 6 backup video recording (still open).
- A `wrangler tail` warning (`Narrator: Slack webhook returned 400`) observed during rehearsal runs — noted, not investigated, since it doesn't block the payment/QA/revoke path.
