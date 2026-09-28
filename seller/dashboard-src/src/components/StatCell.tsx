import { useEffect, useRef, useState } from "react";
import { cn } from "@/lib/utils";

interface StatCellProps {
  label: string;
  value: string;
  tone?: "verified" | "refused" | "pending" | "neutral";
}

const toneClass: Record<NonNullable<StatCellProps["tone"]>, string> = {
  verified: "text-[color:var(--color-verified)]",
  refused: "text-[color:var(--color-refused)]",
  pending: "text-[color:var(--color-pending)]",
  neutral: "text-foreground",
};

export function StatCell({ label, value, tone = "neutral" }: StatCellProps) {
  const [pulse, setPulse] = useState(false);
  const prevValue = useRef(value);

  useEffect(() => {
    if (prevValue.current !== value) {
      prevValue.current = value;
      setPulse(true);
      const t = setTimeout(() => setPulse(false), 420);
      return () => clearTimeout(t);
    }
  }, [value]);

  return (
    <div className="flex flex-col gap-1.5 border-r border-border px-5 py-4 last:border-r-0 sm:px-6">
      <span className="text-[11px] font-medium tracking-wide text-muted-foreground">
        {label}
      </span>
      <span
        className={cn(
          "font-ledger text-2xl font-medium transition-[opacity,transform] duration-200 sm:text-[28px]",
          toneClass[tone],
          pulse && "opacity-70",
        )}
      >
        {value}
      </span>
    </div>
  );
}
