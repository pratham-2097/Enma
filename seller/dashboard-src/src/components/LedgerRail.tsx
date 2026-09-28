import { useEffect, useState } from "react";
import { cn } from "@/lib/utils";
import {
  basescanLink,
  describeEvent,
  isRogue,
  laneFor,
  type EventTone,
  type Lane,
} from "@/lib/dashboardLogic";
import type { FeedItem } from "@/hooks/useEnmaFeed";

const LANES: { key: Lane; label: string }[] = [
  { key: "buyer", label: "Buyer" },
  { key: "seller", label: "Seller" },
  { key: "escrow", label: "Escrow · EnmaGuard" },
];

const TONE_DOT: Record<EventTone, string> = {
  "": "bg-[color:var(--color-wire)]",
  ok: "bg-[color:var(--color-verified)]",
  fail: "bg-[color:var(--color-refused)]",
  banned: "bg-[color:var(--color-pending)]",
};

const TONE_SETTLE_ANIM: Record<EventTone, string> = {
  "": "animate-[settle-neutral_0.6s_ease-out]",
  ok: "animate-[settle-ok_0.6s_ease-out]",
  fail: "animate-[settle-fail_0.6s_ease-out]",
  banned: "animate-[settle-fail_0.6s_ease-out]",
};

const NODE_LIFETIME_MS = 4200;

function RailNode({ item, isNewest }: { item: FeedItem; isNewest: boolean }) {
  const [settled, setSettled] = useState(false);
  const { text, tone, txHash } = describeEvent(item.event);
  const link = basescanLink(txHash);
  const rogue = isRogue(item.event);

  useEffect(() => {
    const t = setTimeout(() => setSettled(true), 60);
    return () => clearTimeout(t);
  }, []);

  return (
    <div
      className={cn(
        "relative flex items-start gap-2.5 border-l-2 py-2.5 pl-3 pr-2 transition-all duration-500 ease-out",
        settled ? "translate-x-0 opacity-100" : "-translate-x-2 opacity-0",
        rogue
          ? "border-l-[color:var(--color-rogue)] bg-[color:var(--color-rogue)]/[0.05]"
          : "border-l-[color:var(--color-wire-dim)]",
      )}
    >
      {isNewest && settled && (
        <span
          aria-hidden
          className={cn("pointer-events-none absolute inset-0", TONE_SETTLE_ANIM[tone])}
        />
      )}
      <span className={cn("relative mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full", TONE_DOT[tone])} />
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline gap-1.5">
          <p className="text-[12.5px] leading-snug text-foreground/90">{text}</p>
          {rogue && (
            <span className="font-ledger shrink-0 text-[9px] tracking-wide text-[color:var(--color-rogue)]/80">
              rogue
            </span>
          )}
        </div>
        {link && (
          <a
            href={link}
            target="_blank"
            rel="noopener noreferrer"
            className="font-ledger text-[10.5px] text-[color:var(--color-buyer)] hover:underline"
          >
            view on basescan
          </a>
        )}
      </div>
    </div>
  );
}

export function LedgerRail({ items }: { items: FeedItem[] }) {
  const empty = items.length === 0;

  return (
    <div className="relative grid flex-1 grid-cols-1 divide-y divide-border md:grid-cols-3 md:divide-x md:divide-y-0">
      {empty && (
        <div className="pointer-events-none absolute inset-0 top-9 flex items-center justify-center">
          <div className="flex items-center gap-2.5 text-muted-foreground/50">
            <span className="relative flex h-1.5 w-1.5">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-current opacity-40" />
              <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-current" />
            </span>
            <span className="font-ledger text-[11px] tracking-wide">awaiting first settlement</span>
          </div>
        </div>
      )}
      {LANES.map((lane) => {
        const laneItems = items.filter((it) => laneFor(it.event) === lane.key).slice(0, 6);
        return (
          <div key={lane.key} className="flex min-h-0 flex-col">
            <div className="flex shrink-0 items-center gap-2 border-b border-border px-4 py-2.5">
              <span
                className={cn(
                  "h-1.5 w-1.5 rounded-full",
                  lane.key === "buyer" && "bg-[color:var(--color-buyer)]",
                  lane.key === "seller" && "bg-[color:var(--color-verified)]",
                  lane.key === "escrow" && "bg-[#c084fc]",
                )}
              />
              <span className="text-[11px] font-medium tracking-wide text-muted-foreground">
                {lane.label}
              </span>
            </div>
            <div className="relative flex-1 divide-y divide-border/60 overflow-hidden">
              {!empty && (
                <div
                  aria-hidden
                  className="pointer-events-none absolute inset-y-0 left-[19px] w-px bg-[color:var(--color-wire-dim)]"
                />
              )}
              {laneItems.length === 0 ? (
                <div className="px-4 py-6 text-[12px] text-muted-foreground/60">
                  {empty ? "" : "No activity yet"}
                </div>
              ) : (
                laneItems.map((item, i) => (
                  <div key={item.id} className="relative px-1">
                    <RailNode item={item} isNewest={i === 0} />
                  </div>
                ))
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}

export { NODE_LIFETIME_MS };
