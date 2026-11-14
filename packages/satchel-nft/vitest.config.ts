import { defineConfig } from "vitest/config";

const live = process.env.SATCHEL_LIVE === "1" || process.env.SATCHEL_LIVE_ARCHIVAL === "1";

export default defineConfig({
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
    ...(live ? { fileParallelism: false, testTimeout: 60_000 } : {}),
  },
});
