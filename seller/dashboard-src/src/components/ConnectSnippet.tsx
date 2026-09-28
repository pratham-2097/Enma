import { useState } from "react";
import { useAccount } from "wagmi";
import { CheckIcon, CopyIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";

const MCP_COMMAND = "cd buyer && claude mcp add enma -- npx tsx src/mcp.ts";

function envSnippet(ownerAddress?: string) {
  return [
    "# buyer/.env — generate your own AGENT/GUARDIAN keys, then deploy",
    "# your own EnmaGuard via contracts/script/Deploy.s.sol",
    `OWNER_ADDRESS=${ownerAddress ?? "0xYourConnectedAddress"}`,
    "OWNER_PRIVATE_KEY=",
    "AGENT_PRIVATE_KEY=",
    "GUARDIAN_PRIVATE_KEY=",
    "ENMA_GUARD_ADDRESS=",
    "RPC_URL=https://sepolia.base.org",
  ].join("\n");
}

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <Button
      variant="outline"
      size="xs"
      onClick={async () => {
        await navigator.clipboard.writeText(text);
        setCopied(true);
        setTimeout(() => setCopied(false), 1500);
      }}
    >
      {copied ? <CheckIcon /> : <CopyIcon />}
      {copied ? "Copied" : "Copy"}
    </Button>
  );
}

export function ConnectSnippet() {
  const { address, isConnected } = useAccount();
  if (!isConnected) return null;

  const env = envSnippet(address);

  return (
    <Dialog>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm">
          Connect your agent
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>Wire up your own agent</DialogTitle>
          <DialogDescription>
            Enma's seller already accepts any buyer wallet — it keys every ledger entry by
            payer address. Wiring your own agent means deploying your own EnmaGuard (one per
            person) and pointing the MCP server at it. Not automated yet: run the Foundry
            deploy script yourself, then use these values.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          <div>
            <div className="mb-1 flex items-center justify-between">
              <span className="text-[11px] font-medium text-muted-foreground">
                1. Add the MCP server to Claude
              </span>
              <CopyButton text={MCP_COMMAND} />
            </div>
            <pre className="overflow-x-auto rounded-md border border-border bg-card px-3 py-2 font-ledger text-[12px] text-foreground/90">
              {MCP_COMMAND}
            </pre>
          </div>

          <div>
            <div className="mb-1 flex items-center justify-between">
              <span className="text-[11px] font-medium text-muted-foreground">
                2. Fill in buyer/.env with your own identity
              </span>
              <CopyButton text={env} />
            </div>
            <pre className="overflow-x-auto whitespace-pre rounded-md border border-border bg-card px-3 py-2 font-ledger text-[11px] leading-relaxed text-foreground/90">
              {env}
            </pre>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
