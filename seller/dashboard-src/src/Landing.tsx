import {
  ArrowUpRight,
  ShieldCheck,
  Undo2,
  Ban,
  Wallet,
  KeyRound,
  Gauge,
  ListFilter,
  Radio,
  MessageSquareText,
  FlaskConical,
} from "lucide-react";
import { Button } from "@/components/ui/button";

const DASHBOARD_URL = "/dashboard.html";

function Nav() {
  return (
    <header className="flex items-center justify-between border-b border-border px-6 py-4 sm:px-10">
      <div className="flex items-center gap-2">
        <div className="flex h-7 w-7 items-center justify-center rounded-md bg-foreground text-background">
          <span className="font-ledger text-[13px]">壬</span>
        </div>
        <span className="text-[15px] font-medium tracking-tight">Enma</span>
      </div>
      <nav className="hidden items-center gap-7 text-[13px] text-muted-foreground lg:flex">
        <a href="#mechanism" className="hover:text-foreground">
          How it works
        </a>
        <a href="#beats" className="hover:text-foreground">
          What it stops
        </a>
        <a href="#safety" className="hover:text-foreground">
          Trust &amp; safety
        </a>
        <a href="#agent" className="hover:text-foreground">
          Agent tools
        </a>
        <a href="#observability" className="hover:text-foreground">
          Dashboard
        </a>
        <a href="#connect" className="hover:text-foreground">
          Connect
        </a>
      </nav>
      <Button asChild size="sm">
        <a href={DASHBOARD_URL}>
          Open dashboard <ArrowUpRight className="size-3.5" />
        </a>
      </Button>
    </header>
  );
}

function Hero() {
  return (
    <section className="border-b border-border px-6 py-20 sm:px-10 sm:py-28">
      <div className="mx-auto max-w-3xl">
        <div className="mb-6 inline-flex items-center gap-2 rounded-full border border-border bg-card px-3 py-1 text-[11px] text-muted-foreground">
          <span className="relative flex h-1.5 w-1.5">
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-[color:var(--color-verified)] opacity-60" />
            <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-[color:var(--color-verified)]" />
          </span>
          Live on Base Sepolia
        </div>
        <h1 className="text-[40px] font-medium leading-[1.08] tracking-tight sm:text-[56px]">
          Give your agent a wallet
          <br />
          it can actually trust.
        </h1>
        <p className="mt-6 max-w-xl text-[16px] leading-relaxed text-muted-foreground">
          Agents can't hold a credit card or sign a contract — but they can hold a
          wallet. Enma lets an AI agent pay any web2 API per-request in stablecoins,
          grade what it gets back, and claw the payment back on-chain if the data
          was junk — no human in the loop, no standing trust in the seller.
        </p>
        <div className="mt-9 flex flex-wrap items-center gap-3">
          <Button asChild size="lg">
            <a href={DASHBOARD_URL}>
              Watch it live <ArrowUpRight className="size-4" />
            </a>
          </Button>
          <Button asChild size="lg" variant="outline">
            <a href="#connect">Connect your agent</a>
          </Button>
        </div>
      </div>
    </section>
  );
}

function Thesis() {
  return (
    <section className="border-b border-border px-6 py-16 sm:px-10">
      <div className="mx-auto max-w-3xl">
        <p className="text-[15px] leading-relaxed text-muted-foreground sm:text-[17px]">
          Every AI agent is about to become a customer of the web2 economy — buying
          data, calling APIs, subscribing to feeds — but web2 commerce assumes a
          human is on the other end of every payment. Enma is the settlement layer
          that lets an agent transact directly: pay per call in stablecoins, verify
          the result itself, and reverse the charge on-chain in seconds if it got
          burned. That's the arbitrage — the trust and billing infrastructure of
          web3, wrapped around the data and services that already exist on web2.
        </p>
      </div>
    </section>
  );
}

const MECHANISM_STEPS = [
  {
    title: "Your agent pays",
    body:
      "It opens a channel and signs a voucher per request — the seller serves the data immediately, the voucher settles later.",
  },
  {
    title: "Your agent grades the answer",
    body:
      "A deterministic schema check, then a semantic judge. Both run in your agent's own process, not the seller's.",
  },
  {
    title: "Bad data gets revoked, on-chain",
    body:
      "If QA fails, a guardian key revokes the voucher before the seller's next claim. Coinbase's own escrow contract enforces the revert — not application code.",
  },
];

function Mechanism() {
  return (
    <section id="mechanism" className="border-b border-border px-6 py-20 sm:px-10">
      <div className="mx-auto max-w-5xl">
        <h2 className="text-[13px] font-medium uppercase tracking-wide text-muted-foreground">
          How it works
        </h2>
        <div className="mt-8 grid gap-8 sm:grid-cols-3">
          {MECHANISM_STEPS.map((step, i) => (
            <div key={step.title}>
              <div className="font-ledger text-[13px] text-muted-foreground">
                {String(i + 1).padStart(2, "0")}
              </div>
              <h3 className="mt-3 text-[17px] font-medium tracking-tight">{step.title}</h3>
              <p className="mt-2 text-[14px] leading-relaxed text-muted-foreground">{step.body}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

const BEATS = [
  {
    icon: ShieldCheck,
    title: "The save",
    body: "A seller serves fabricated junk. QA catches it and the guardian key revokes the voucher on-chain — before the seller can ever claim it.",
  },
  {
    icon: Undo2,
    title: "The revert",
    body: "The seller's next claim attempt on that channel reverts at the escrow itself. Coinbase's deployed contract enforces this, not our code.",
  },
  {
    icon: Ban,
    title: "The ban",
    body: "A buyer that pays for good data and revokes anyway gets caught by the ledger — three incidents and every future request is refused, before any facilitator round-trip.",
  },
];

function Beats() {
  return (
    <section id="beats" className="border-b border-border px-6 py-20 sm:px-10">
      <div className="mx-auto max-w-5xl">
        <h2 className="text-[13px] font-medium uppercase tracking-wide text-muted-foreground">
          What it stops
        </h2>
        <div className="mt-8 grid gap-6 sm:grid-cols-3">
          {BEATS.map(({ icon: Icon, title, body }) => (
            <div key={title} className="rounded-lg border border-border bg-card p-5">
              <Icon className="size-5 text-muted-foreground" strokeWidth={1.5} />
              <h3 className="mt-4 text-[15px] font-medium tracking-tight">{title}</h3>
              <p className="mt-2 text-[13px] leading-relaxed text-muted-foreground">{body}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

const SAFETY_LAYERS = [
  {
    icon: KeyRound,
    title: "Claim-time revocation",
    body:
      "A guardian key can revoke a seller on EnmaGuard after a voucher is signed but before it's cashed in. The escrow itself reverts that claim — the one guarantee a sign-time-only payment scheme can't offer.",
  },
  {
    icon: ShieldCheck,
    title: "Two-gate QA",
    body:
      "Every response is checked twice: a deterministic schema/range/freshness check that revokes unconditionally on failure, then an optional semantic judge that only revokes on a confident fabrication verdict — and fails open, never blocking a good response.",
  },
  {
    icon: Ban,
    title: "MAD ban ledger",
    body:
      "The seller tracks served value against incident value per payer. A buyer gets banned only once both hold — two-plus incidents and incident value at half of served value — so one honest miss never costs you, but abuse gets refused before it costs the seller a facilitator round-trip.",
  },
  {
    icon: Gauge,
    title: "Spend-limit firewall",
    body:
      "The buyer enforces its own per-call and rolling-window price caps before opening a channel. If a seller quotes over the cap, the purchase is refused outright — zero gas spent, zero funds ever at risk.",
  },
  {
    icon: ListFilter,
    title: "Denylist screening",
    body:
      "Before ever signing a voucher, the buyer checks the seller's on-chain payout address against a flagged-seller list and refuses known-bad counterparties on sight.",
  },
  {
    icon: Wallet,
    title: "Trust-minimized guardian",
    body:
      "The guardian key can only veto a claim — it never holds, moves, or redirects funds, and can't block the owner's own delayed withdrawal escape hatch.",
  },
];

function Safety() {
  return (
    <section id="safety" className="border-b border-border px-6 py-20 sm:px-10">
      <div className="mx-auto max-w-5xl">
        <h2 className="text-[13px] font-medium uppercase tracking-wide text-muted-foreground">
          Trust &amp; safety
        </h2>
        <p className="mt-3 max-w-2xl text-[14px] leading-relaxed text-muted-foreground">
          Six independent layers, each enforced at a different point in the payment
          lifecycle — before a channel opens, while a voucher is live, and at the
          moment a seller tries to collect.
        </p>
        <div className="mt-8 grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
          {SAFETY_LAYERS.map(({ icon: Icon, title, body }) => (
            <div key={title} className="rounded-lg border border-border bg-card p-5">
              <Icon className="size-5 text-muted-foreground" strokeWidth={1.5} />
              <h3 className="mt-4 text-[15px] font-medium tracking-tight">{title}</h3>
              <p className="mt-2 text-[13px] leading-relaxed text-muted-foreground">{body}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

const AGENT_TOOLS = [
  {
    name: "buy_signal",
    body: "The honest path — pay, run both QA gates, revoke automatically if the data fails either one.",
  },
  {
    name: "firewall_signal",
    body: "Same honest buy, but refuses pre-payment if the seller's price exceeds your configured spend cap.",
  },
  {
    name: "shady_signal",
    body: "Screens the seller's payout address against a denylist before ever signing a voucher.",
  },
  {
    name: "cheat_signal",
    body: "Buyer-abuse demo mode — pays, then revokes regardless of data quality, to show the MAD ban path from the other side.",
  },
];

function AgentIntegration() {
  return (
    <section id="agent" className="border-b border-border px-6 py-20 sm:px-10">
      <div className="mx-auto max-w-5xl">
        <h2 className="text-[13px] font-medium uppercase tracking-wide text-muted-foreground">
          Agent tools
        </h2>
        <p className="mt-3 max-w-2xl text-[14px] leading-relaxed text-muted-foreground">
          Enma ships as a real MCP server. Claude — or any MCP-speaking agent — gets
          four tools that all drive the exact same on-chain payment path as the CLI.
          Nothing is mocked for the connector; every call is a real voucher, a real
          QA run, a real revoke if it fails.
        </p>
        <div className="mt-8 grid gap-6 sm:grid-cols-2">
          {AGENT_TOOLS.map(({ name, body }) => (
            <div key={name} className="rounded-lg border border-border bg-card p-5">
              <span className="font-ledger text-[13px] text-foreground">{name}</span>
              <p className="mt-2 text-[13px] leading-relaxed text-muted-foreground">{body}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

const OBSERVABILITY_ITEMS = [
  {
    icon: Radio,
    title: "Live event feed",
    body:
      "Every payment, QA verdict, revoke, claim, and ban streams to the dashboard over WebSocket the moment it happens on-chain — with a Basescan link on every settled transaction.",
  },
  {
    icon: Wallet,
    title: "Wallet-aware filtering",
    body:
      "Connect a browser wallet on Base Sepolia and the feed filters down to your own activity — the same address the on-chain ledger and ban checks already key off.",
  },
  {
    icon: MessageSquareText,
    title: "Slack ops narrator",
    body:
      "A revoke, a ban, or a claim also posts as a plain-English line to a Slack channel — best-effort only, it never blocks the payment path if Slack is down.",
  },
];

function Observability() {
  return (
    <section id="observability" className="border-b border-border px-6 py-20 sm:px-10">
      <div className="mx-auto max-w-5xl">
        <h2 className="text-[13px] font-medium uppercase tracking-wide text-muted-foreground">
          Watch it happen
        </h2>
        <p className="mt-3 max-w-2xl text-[14px] leading-relaxed text-muted-foreground">
          Nothing about the payment lifecycle is hidden in a log file. The dashboard
          is the same live state the contracts and the ledger are actually in.
        </p>
        <div className="mt-8 grid gap-6 sm:grid-cols-3">
          {OBSERVABILITY_ITEMS.map(({ icon: Icon, title, body }) => (
            <div key={title} className="rounded-lg border border-border bg-card p-5">
              <Icon className="size-5 text-muted-foreground" strokeWidth={1.5} />
              <h3 className="mt-4 text-[15px] font-medium tracking-tight">{title}</h3>
              <p className="mt-2 text-[13px] leading-relaxed text-muted-foreground">{body}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

function DemoNote() {
  return (
    <section className="border-b border-border bg-card px-6 py-10 sm:px-10">
      <div className="mx-auto flex max-w-5xl items-start gap-3">
        <FlaskConical className="mt-0.5 size-4 shrink-0 text-muted-foreground" strokeWidth={1.5} />
        <p className="text-[13px] leading-relaxed text-muted-foreground">
          <span className="text-foreground">What's real, what's a stand-in:</span> the
          channel, the escrow, the revoke, the ledger, and every on-chain settlement
          are genuine transactions on Base Sepolia. The market-sentiment number
          itself is illustrative — it's Claude Opus reasoning over a mock news feed,
          not a live data source — because this demo is about proving the payment
          and trust mechanism works, not about producing real trading signal.
        </p>
      </div>
    </section>
  );
}

function Connect() {
  return (
    <section id="connect" className="px-6 py-20 sm:px-10">
      <div className="mx-auto max-w-3xl rounded-xl border border-border bg-card p-8 sm:p-12">
        <h2 className="text-[24px] font-medium tracking-tight">Connect your own agent</h2>
        <p className="mt-3 max-w-xl text-[14px] leading-relaxed text-muted-foreground">
          The dashboard is wallet-aware — connect a browser wallet and the live event
          feed filters down to your own on-chain activity. From there, wire an MCP
          connector so Claude itself can pay through Enma directly.
        </p>
        <ol className="mt-6 space-y-3 text-[14px]">
          <li className="flex gap-3">
            <span className="font-ledger text-muted-foreground">1</span>
            <span>
              Open the <a href={DASHBOARD_URL} className="underline underline-offset-2">dashboard</a> and
              connect a wallet on Base Sepolia.
            </span>
          </li>
          <li className="flex gap-3">
            <span className="font-ledger text-muted-foreground">2</span>
            <span>Click "Connect your agent" for a copy-paste MCP command and .env template.</span>
          </li>
          <li className="flex gap-3">
            <span className="font-ledger text-muted-foreground">3</span>
            <span className="font-ledger text-[13px]">
              claude mcp add enma -- npx tsx src/mcp.ts
            </span>
          </li>
        </ol>
        <p className="mt-6 text-[12px] text-muted-foreground">
          Ask Claude to "buy the sentiment signal for AAPL through Enma" and it calls the
          same real payment path the CLI uses — real voucher, real QA, real revoke.
        </p>
      </div>
    </section>
  );
}

function Footer() {
  return (
    <footer className="border-t border-border px-6 py-8 text-[12px] text-muted-foreground sm:px-10">
      <div className="mx-auto max-w-5xl">
        <span>Enma — built for the Startup Speedrun hackathon.</span>
      </div>
    </footer>
  );
}

export default function Landing() {
  return (
    <div className="min-h-screen bg-background">
      <Nav />
      <Hero />
      <Thesis />
      <Mechanism />
      <Beats />
      <Safety />
      <AgentIntegration />
      <Observability />
      <DemoNote />
      <Connect />
      <Footer />
    </div>
  );
}
