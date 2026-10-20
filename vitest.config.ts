import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["packages/*/src/**/*.test.ts", "stations/*/**/*.test.ts", "apps/*/src/**/*.test.ts"],
  },
});
