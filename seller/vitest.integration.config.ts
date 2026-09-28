import { defineConfig } from "vitest/config";

// Plain Node environment: test/integration/** drives a real, already-running
// `wrangler dev` over HTTP and talks to Base Sepolia + the live x402 facilitator
// directly, so it must not run inside the Workers-pool isolate.
export default defineConfig({
  test: {
    include: ["test/integration/**/*.test.ts"],
    environment: "node",
  },
});
