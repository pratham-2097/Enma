import { http, createConfig } from "wagmi";
import { baseSepolia } from "wagmi/chains";
import { injected } from "wagmi/connectors";

// Enma's contracts (EnmaGuard, EnmaCollector) are deployed on Base Sepolia —
// see contracts/.env.example. Wallet-connect here targets the same network.
export const wagmiConfig = createConfig({
  chains: [baseSepolia],
  connectors: [injected()],
  transports: {
    [baseSepolia.id]: http(),
  },
});
