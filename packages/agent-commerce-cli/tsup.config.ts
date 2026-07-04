import { defineConfig } from "tsup";

export default defineConfig({
  entry: { cli: "src/cli.ts" },
  format: ["esm"],
  target: "node18",
  platform: "node",
  clean: true,
  dts: false,
  sourcemap: false,
  // Inline the unpublished workspace packages (core, sdk, mcp) into the bundle.
  // Everything else (viem, siwe, @modelcontextprotocol/sdk, zod) stays external
  // and is declared in `dependencies`, so npm installs them for consumers.
  noExternal: [/^@arcora\//],
  banner: { js: "#!/usr/bin/env node" },
});
