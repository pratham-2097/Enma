import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["test/e2e/**/*.test.ts", "test/integration/**/*.test.ts"],
    environment: "node",
  },
});
