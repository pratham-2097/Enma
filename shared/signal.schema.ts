import { z } from "zod";

export const SignalSchema = z.object({
  asset: z.string().min(1),
  sentiment_index: z.number().min(0).max(100),
  confidence: z.number().min(0).max(1),
  n_sources: z.number().int().min(0),
  window_start: z.string().datetime(),
  window_end: z.string().datetime(),
  model: z.string().min(1),
});

export type Signal = z.infer<typeof SignalSchema>;
