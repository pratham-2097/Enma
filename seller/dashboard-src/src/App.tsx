import { useEffect, useMemo, useState } from "react";
import { useAccount } from "wagmi";
import { StatCell } from "@/components/StatCell";
import { LedgerRail } from "@/components/LedgerRail";
import { EventLog } from "@/components/EventLog";
import { ConnectionStatus } from "@/components/ConnectionStatus";
import { ConnectWallet } from "@/components/ConnectWallet";
import { ConnectSnippet } from "@/components/ConnectSnippet";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { formatCounters } from "@/lib/dashboardLogic";
import { useEnmaFeed, type FeedItem } from "@/hooks/useEnmaFeed";

function useUptimeClock(connected: boolean) {
  const [seconds, setSeconds] = useState(0);
  useEffect(() => {
    if (!connected) {
      setSeconds(0);
      return;
    }
    const id = setInterval(() => setSeconds((s) => s + 1), 1000);
    return () => clearInterval(id);
  }, [connected]);
  const h = String(Math.floor(seconds / 3600)).padStart(2, "0");
  const m = String(Math.floor((seconds % 3600) / 60)).padStart(2, "0");
  const s = String(seconds % 60).padStart(2, "0");
  return `${h}:${m}:${s}`;
}

function hasPayer(item: FeedItem): item is FeedItem & { event: { payer: string } } {
  return "payer" in item.event && typeof item.event.payer === "string";
}

export default function App() {
  const { connected, counters, items } = useEnmaFeed();
  const { address, isConnected } = useAccount();
  const [scope, setScope] = useState<"all" | "mine">("all");
  const formatted = formatCounters(counters);
  const uptime = useUptimeClock(connected);

  const visibleItems = useMemo(() => {
    if (scope === "all" || !isConnected || !address) return items;
    return items.filter((item) => hasPayer(item) && item.event.payer.toLowerCase() === address.toLowerCase());
  }, [items, scope, isConnected, address]);

  return (
    <div className="flex min-h-screen flex-col bg-background">
      <header className="flex flex-col gap-2 border-b border-border px-5 py-4 sm:flex-row sm:items-center sm:justify-between sm:px-6">
        <div>
          <h1 className="text-[15px] font-medium tracking-tight text-foreground">
            Enma
            <span className="ml-2 font-normal text-muted-foreground">
              agents pay only for data that passes QA
            </span>
          </h1>
        </div>
        <div className="flex flex-wrap items-center gap-3 sm:gap-4">
          <span className="font-ledger text-[11px] text-muted-foreground">{uptime}</span>
          <ConnectionStatus connected={connected} />
          {isConnected && <ConnectSnippet />}
          <ConnectWallet />
        </div>
      </header>

      <div className="grid shrink-0 grid-cols-2 border-b border-border sm:grid-cols-4">
        <StatCell label="Revenue claimed" value={formatted.claimed} tone="verified" />
        <StatCell label="Revenue refused" value={formatted.refused} tone="refused" />
        <StatCell label="QA pass rate" value={formatted.qaRate} tone="neutral" />
        <StatCell label="Payers banned" value={formatted.bans} tone="pending" />
      </div>

      {isConnected && (
        <div className="flex items-center justify-between gap-3 border-b border-border px-5 py-2 sm:px-6">
          <Tabs value={scope} onValueChange={(v) => setScope(v as "all" | "mine")}>
            <TabsList>
              <TabsTrigger value="all">All activity</TabsTrigger>
              <TabsTrigger value="mine">My activity</TabsTrigger>
            </TabsList>
          </Tabs>
          {scope === "mine" && (
            <span className="text-[11px] text-muted-foreground">
              Filtered to {address ? `${address.slice(0, 6)}…${address.slice(-4)}` : "your wallet"} — this demo
              currently runs one scripted buyer, so this may be empty unless it matches.
            </span>
          )}
        </div>
      )}

      <main className="flex min-h-0 flex-1 flex-col md:flex-row">
        <LedgerRail items={visibleItems} />
        <div className="min-h-[280px] border-t border-border md:min-h-0 md:w-[340px] md:shrink-0 md:border-l md:border-t-0">
          <EventLog items={visibleItems} />
        </div>
      </main>
    </div>
  );
}
