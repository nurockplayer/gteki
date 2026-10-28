import { configDefaults, defineConfig } from "vitest/config";

const testRoots = ["packages/*/src", "stations/*", "apps/*/src"];

export default defineConfig(({ mode }) => {
  const heavy = mode === "heavy";
  const testPattern = heavy ? "*.heavy.test.ts" : "*.test.ts";
  return {
    test: {
      include: [
        ...testRoots.map((root) => `${root}/**/${testPattern}`),
        ...(heavy ? [] : ["tools/*.test.mjs", "tools/map/*.test.ts", "tools/private-overlay/*.test.ts"]),
      ],
      exclude: heavy ? configDefaults.exclude : [...configDefaults.exclude, "**/*.heavy.test.ts"],
      execArgv: [`--max-old-space-size=${process.env.GTEKI_TEST_HEAP_MB ?? "3072"}`],
    },
  };
});
