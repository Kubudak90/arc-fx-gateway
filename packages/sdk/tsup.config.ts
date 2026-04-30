import { defineConfig } from "tsup";

// Two builds in one tsup config:
//   1. The npm surface — ESM + CJS from src/index.ts. Same as v1.0.0.
//   2. The CDN surface — IIFE from src/cdn.ts that flattens the API so a
//      <script src="…"> integrator can write `Arcora.init(…)` directly.
export default defineConfig([
  {
    entry: ["src/index.ts"],
    format: ["esm", "cjs"],
    dts: true,
    sourcemap: true,
    clean: true,
    treeshake: true,
    minify: true,
  },
  {
    entry: { "arcora": "src/cdn.ts" },
    format: ["iife"],
    globalName: "Arcora",
    dts: false,
    sourcemap: true,
    clean: false,         // don't wipe the index.* outputs from build #1
    treeshake: true,
    minify: true,
    outExtension: () => ({ js: ".global.js" }),
  },
]);
