import { useAccount, useConnect, useDisconnect } from "wagmi";
import { Button } from "@/components/ui/button";
import { short } from "@/lib/dashboardLogic";

export function ConnectWallet() {
  const { address, isConnected } = useAccount();
  const { connect, connectors, isPending } = useConnect();
  const { disconnect } = useDisconnect();

  if (isConnected && address) {
    return (
      <div className="flex items-center gap-2">
        <span className="font-ledger text-[11px] text-foreground/90">{short(address)}</span>
        <Button variant="outline" size="xs" onClick={() => disconnect()}>
          Disconnect
        </Button>
      </div>
    );
  }

  const injectedConnector = connectors[0];

  return (
    <Button
      variant="default"
      size="sm"
      disabled={!injectedConnector || isPending}
      onClick={() => injectedConnector && connect({ connector: injectedConnector })}
    >
      {isPending ? "Connecting…" : "Connect wallet"}
    </Button>
  );
}
