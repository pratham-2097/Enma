import { SignalSchema, type Signal } from "@enma/shared/signal.schema";

export const QA_REASON_SCHEMA_FAIL = 10;
export const QA_REASON_JEV_FAIL = 11;

export type QaResult =
  | { ok: true; noOpinion?: boolean }
  | { ok: false; reasonCode: number; message: string };

const TICKER_RE = /^[A-Z]{1,10}$/;
const SENTINEL_STRINGS = new Set(["error", "n/a", "na", "null", "undefined", "¯\\_(ツ)_/¯", "unknown", "<unknown>"]);
const FRESHNESS_WINDOW_MS = 5 * 60_000; // window_end must be within the last 5 minutes

/**
 * QA gate 1: deterministic schema and invariant checks. No appeal — any failure here
 * revokes unconditionally, before the (probabilistic) Jev gate ever runs.
 */
export function checkDeterministic(payload: unknown): QaResult {
  const parsed = SignalSchema.safeParse(payload);
  if (!parsed.success) {
    return { ok: false, reasonCode: QA_REASON_SCHEMA_FAIL, message: `schema: ${parsed.error.message}` };
  }

  const signal = parsed.data;

  const invariantFailure = checkInvariants(signal);
  if (invariantFailure) {
    return { ok: false, reasonCode: QA_REASON_SCHEMA_FAIL, message: invariantFailure };
  }

  return { ok: true };
}

function checkInvariants(signal: Signal): string | undefined {
  if (signal.sentiment_index < 0 || signal.sentiment_index > 100) {
    return `sentiment_index ${signal.sentiment_index} out of [0,100]`;
  }
  if (signal.confidence < 0 || signal.confidence > 1) {
    return `confidence ${signal.confidence} out of [0,1]`;
  }
  if (signal.n_sources < 1) {
    return `n_sources ${signal.n_sources} below minimum of 1`;
  }
  if (!TICKER_RE.test(signal.asset)) {
    return `asset "${signal.asset}" does not look like a ticker`;
  }
  if (isSentinel(signal.asset) || isSentinel(signal.model)) {
    return "sentinel/placeholder string found in a signal field";
  }
  const windowEndMs = Date.parse(signal.window_end);
  if (Number.isNaN(windowEndMs) || Date.now() - windowEndMs > FRESHNESS_WINDOW_MS) {
    return `window_end ${signal.window_end} is stale`;
  }
  return undefined;
}

function isSentinel(value: string): boolean {
  return SENTINEL_STRINGS.has(value.trim().toLowerCase());
}

const JEV_URL = "https://api.typesafe.ai/v1/systemone";
const JEV_BAD_THRESHOLD = 0.9; // revoke only if p(bad) >= 0.9
const JEV_DEFAULT_TIMEOUT_MS = 3000;

interface JevOptions {
  apiKey: string;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
}

/**
 * QA gate 2: Jev's semantic judgment ("is this a genuine market signal, or
 * placeholder/stale/fabricated data?"). Jev is probabilistic, not a referee — a
 * timeout or any transport/HTTP failure is "no opinion" (passes through, logged),
 * never treated as a revoke. Only a confident bad verdict (p(bad) >= 0.9) revokes.
 */
export async function checkJev(payload: unknown, opts: JevOptions): Promise<QaResult> {
  const doFetch = opts.fetchImpl ?? fetch;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), opts.timeoutMs ?? JEV_DEFAULT_TIMEOUT_MS);

  let res: Response;
  try {
    res = await doFetch(JEV_URL, {
      method: "POST",
      signal: controller.signal,
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${opts.apiKey}`,
      },
      body: JSON.stringify({
        state: payload,
        model: "jev-latest",
        questions: {
          is_genuine: {
            type: "noul",
            instructions: "Is this a genuine market-sentiment signal, rather than placeholder, stale, or fabricated data?",
            criteria: {
              true: "The data looks like a real, computed market signal.",
              false: "The data looks fabricated, a placeholder, or stale.",
            },
          },
        },
      }),
    });
  } catch {
    return { ok: true, noOpinion: true };
  } finally {
    clearTimeout(timeout);
  }

  if (!res.ok) {
    return { ok: true, noOpinion: true };
  }

  let body: { answers?: { is_genuine?: { noul?: number } } };
  try {
    body = (await res.json()) as { answers?: { is_genuine?: { noul?: number } } };
  } catch {
    return { ok: true, noOpinion: true };
  }

  const noul = body.answers?.is_genuine?.noul;
  if (typeof noul !== "number") {
    return { ok: true, noOpinion: true };
  }

  const pBad = 1 - noul;
  if (pBad >= JEV_BAD_THRESHOLD) {
    return { ok: false, reasonCode: QA_REASON_JEV_FAIL, message: `Jev: p(bad)=${pBad.toFixed(3)} >= 0.9` };
  }

  return { ok: true };
}
