import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["test/**/*.test.ts"],
    environment: "node",
    hookTimeout: 30000,
    testTimeout: 30000,
  },
});