import { ScrollArea } from "@/components/ui/scroll-area";
import { basescanLink, describeEvent } from "@/lib/dashboardLogic";
import type { FeedItem } from "@/hooks/useEnmaFeed";

function formatTime(ts: number) {
  return new Date(ts).toLocaleTimeString([], { hour12: false });
}

export function EventLog({ items }: { items: FeedItem[] }) {
  return (
    <div className="flex h-full flex-col">
      <div className="flex shrink-0 items-center px-4 py-2.5">
        <span className="text-[11px] font-medium tracking-wide text-muted-foreground">
          Event log
        </span>
      </div>
      <ScrollArea className="flex-1">
        <div className="divide-y divide-border/60">
          {items.length === 0 && (
            <p className="px-4 py-6 text-[12px] text-muted-foreground/60">
              Waiting for the first purchase…
            </p>
          )}
          {items.map((item) => {
            const { text, txHash } = describeEvent(item.event);
            const link = basescanLink(txHash);
            return (
              <div key={item.id} className="px-4 py-2">
                <div className="font-ledger text-[10px] text-muted-foreground">
                  {formatTime(item.receivedAt)}
                  {"seller" in item.event && item.event.seller ? ` · ${item.event.seller}` : ""}
                </div>
                <div className="mt-0.5 text-[12px] leading-snug text-foreground/90">
                  {text}
                  {link && (
                    <>
                      {" — "}
                      <a
                        href={link}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-[color:var(--color-buyer)] hover:underline"
                      >
                        tx
                      </a>
                    </>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </ScrollArea>
    </div>
  );
}
