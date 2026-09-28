import { z } from "zod";

/**
 * The dashboard's one event contract (PLAN.md §14). Both seller identities ("enma"
 * and "rogue" — self-reported as those literal labels) and the buyer agent (which
 * only knows the seller's on-chain receiver address, from the 402 it just paid) all
 * describe what happened in these shapes, sent to the seller Worker's EventHub DO
 * and broadcast verbatim to every connected dashboard WebSocket client. `seller` is
 * intentionally a free-form string rather than a label enum so the buyer — which
 * never learns the "enma"/"rogue" label, only the payTo address — can still report
 * its own events without the two sides needing a shared identity vocabulary.
 */
export const DashboardEventSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("payment_required"),
    seller: z.string().min(1),
    asset: z.string().min(1),
  }),
  z.object({
    kind: z.literal("voucher_opened"),
    seller: z.string().min(1),
    asset: z.string().min(1),
    payer: z.string().min(1),
    txHash: z.string().optional(),
  }),
  z.object({
    kind: z.literal("data_served"),
    seller: z.string().min(1),
    asset: z.string().min(1),
    payer: z.string().min(1),
    amount: z.string().min(1),
  }),
  z.object({
    kind: z.literal("qa_verdict"),
    seller: z.string().min(1),
    asset: z.string().min(1),
    ok: z.boolean(),
    reason: z.string().optional(),
  }),
  z.object({
    kind: z.literal("revoked"),
    seller: z.string().min(1),
    payer: z.string().min(1),
    txHash: z.string().optional(),
  }),
  z.object({
    kind: z.literal("claimed"),
    seller: z.string().min(1),
    payer: z.string().min(1),
    amount: z.string().min(1),
    txHash: z.string().optional(),
  }),
  z.object({
    kind: z.literal("incident"),
    seller: z.string().min(1),
    payer: z.string().min(1),
    amount: z.string().min(1),
  }),
  z.object({
    kind: z.literal("banned"),
    seller: z.string().min(1),
    payer: z.string().min(1),
  }),
]);

export type DashboardEvent = z.infer<typeof DashboardEventSchema>;
