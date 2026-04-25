import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["test/**/*.test.ts", "lib/**/*.test.ts", "app/**/*.test.ts"],
    setupFiles: ["./test/setup.ts"],
  },
  resolve: {
    alias: { "@": new URL("./", import.meta.url).pathname },
  },
});
