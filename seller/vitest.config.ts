import { defineConfig } from "vitest/config";
import { cloudflareTest } from "@cloudflare/vitest-pool-workers";

// test/integration/** runs against a live `wrangler dev` + the real facilitator over
// plain HTTP/RPC — it belongs in Node, not the Workers-pool isolate this config drives.
export default defineConfig({
  test: {
    exclude: ["**/node_modules/**", "test/integration/**"],
  },
  plugins: [
    cloudflareTest({
      wrangler: { configPath: "./wrangler.jsonc" },
    }),
  ],
});
