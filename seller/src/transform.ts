import { SignalSchema, type Signal } from "@enma/shared/signal.schema";

export class TransformError extends Error {
  constructor(message: string, readonly cause?: unknown) {
    super(`transform: ${message}`);
    this.name = "TransformError";
  }
}

const MODEL = "claude-opus-5";

// window_start/window_end describe when the upstream data was fetched — deterministic
// metadata the server already knows, not something to ask the model to invent.
const TOOL = {
  name: "emit_signal",
  description: "Emit the market-sentiment signal computed from the upstream posts.",
  input_schema: {
    type: "object",
    properties: {
      sentiment_index: { type: "number", minimum: 0, maximum: 100 },
      confidence: { type: "number", minimum: 0, maximum: 1 },
      n_sources: { type: "integer", minimum: 0 },
    },
    required: ["sentiment_index", "confidence", "n_sources"],
  },
} as const;

interface TransformSignalOptions {
  asset: string;
  upstreamText: string;
  apiKey: string;
  gatewayUrl: string;
  fetchImpl?: typeof fetch;
  /**
   * AI Gateway cache key. Defaults to `asset`, but MUST be scoped per seller identity
   * (e.g. "enma:AAPL" vs "rogue:AAPL") whenever more than one identity can serve the
   * same ticker — otherwise the honest and rogue instances silently share a cached
   * response for up to cf-aig-cache-ttl seconds.
   */
  cacheKey?: string;
}

export async function transformSignal(opts: TransformSignalOptions): Promise<Signal> {
  const doFetch = opts.fetchImpl ?? fetch;

  let res: Response;
  try {
    res = await doFetch(opts.gatewayUrl, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": opts.apiKey,
        "anthropic-version": "2023-06-01",
        "cf-aig-cache-ttl": "60",
        "cf-aig-cache-key": opts.cacheKey ?? opts.asset,
      },
      body: JSON.stringify({
        model: MODEL,
        max_tokens: 512,
        tools: [TOOL],
        tool_choice: { type: "tool", name: TOOL.name },
        messages: [
          {
            role: "user",
            content: `Compute a market-sentiment signal for ${opts.asset} from these posts, then call ${TOOL.name}.\n\n${opts.upstreamText}`,
          },
        ],
      }),
    });
  } catch (err) {
    throw new TransformError("Claude request failed", err);
  }

  if (!res.ok) {
    throw new TransformError(`Claude returned HTTP ${res.status}`);
  }

  let body: { content?: { type: string; input?: unknown }[] };
  try {
    body = await res.json();
  } catch (err) {
    throw new TransformError("Claude response was not valid JSON", err);
  }

  const toolUse = body.content?.find((block) => block.type === "tool_use");
  if (!toolUse) {
    throw new TransformError("Claude did not call the signal tool");
  }

  const now = new Date();
  const windowStart = new Date(now.getTime() - 60_000).toISOString();
  const windowEnd = now.toISOString();

  const parsed = SignalSchema.safeParse({
    ...(toolUse.input as object),
    model: MODEL,
    asset: opts.asset,
    window_start: windowStart,
    window_end: windowEnd,
  });
  if (!parsed.success) {
    throw new TransformError(`Claude's tool call did not match the signal schema: ${parsed.error.message}`);
  }

  return parsed.data;
}
