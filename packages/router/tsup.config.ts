import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["src/index.ts"],
  format: ["esm", "cjs"],
  dts: true,
  sourcemap: true,
  clean: true,
  treeshake: true,
  // Keep the canonical `node:` specifier in the output so edge/Deno runtimes
  // with Node compat resolve it (tsup strips it by default).
  removeNodeProtocol: false,
});
