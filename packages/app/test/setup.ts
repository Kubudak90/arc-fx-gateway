import "dotenv/config";
process.env.NEXT_PUBLIC_USDC_ADDRESS ??= "0x3600000000000000000000000000000000000000";
process.env.NEXT_PUBLIC_EURC_ADDRESS ??= "0x89B50855Aa3bE2F677cD6303Cec089B5F319D72a";
process.env.NEXT_PUBLIC_RELAYER_ADDRESS ??= "0x9999999999999999999999999999999999999999";
// Live testnet gateway (ArcFXGateway, recorded in
// packages/contracts/deployments/arc-testnet.json). Tests use it as a
// stable default; nothing on-chain is touched.
process.env.GATEWAY_ADDRESS ??= "0x07BAC123A682D24d3eC439ce454cA8AC64eAe3A3";
process.env.NEXT_PUBLIC_GATEWAY_ADDRESS ??= "0x07BAC123A682D24d3eC439ce454cA8AC64eAe3A3";
// lib/auth/session.ts validates this at module load (audit L-3); give tests a
// deterministic 32+ char default so importing the real session module is safe.
process.env.IRON_SESSION_PASSWORD ??= "test-only-iron-session-password-32chars!!";
