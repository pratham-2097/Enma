import { cn } from "@/lib/utils";

export function ConnectionStatus({ connected }: { connected: boolean }) {
  return (
    <div className="flex items-center gap-2">
      <span className="relative flex h-2 w-2">
        {connected && (
          <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-[color:var(--color-verified)] opacity-60" />
        )}
        <span
          className={cn(
            "relative inline-flex h-2 w-2 rounded-full",
            connected ? "bg-[color:var(--color-verified)]" : "bg-[color:var(--color-refused)]",
          )}
        />
      </span>
      <span className="font-ledger text-[11px] tracking-wide text-muted-foreground">
        {connected ? "live" : "reconnecting…"}
      </span>
    </div>
  );
}
