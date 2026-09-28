export const NETWORKS = {
  testnet: {
    chainId: 84532,
    caip2: "eip155:84532",
    usdc: "0x036CbD53842c5426634e7929541eC2318f3dCF7e",
    facilitatorUrl: "https://x402.org/facilitator",
  },
  mainnet: {
    chainId: 8453,
    caip2: "eip155:8453",
    usdc: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
    facilitatorUrl: process.env.CDP_FACILITATOR_URL,
  },
} as const;

export type NetworkName = keyof typeof NETWORKS;

export const ACTIVE: NetworkName = (process.env.ENMA_NETWORK as NetworkName) ?? "testnet";
