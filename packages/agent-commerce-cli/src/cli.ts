// packages/agent-commerce-cli/src/cli.ts
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { writeFileSync } from "node:fs";
import { createPublicClient, createWalletClient, http, formatEther } from "viem";
import { arcTestnet, ARC_RPC, BASE_URL, GATEWAY_ABI, GATEWAY, SERVER_WALLET, ARC_USDC, FAUCET_URL, GAS_FLOOR_WEI, MERCHANT_KEYFILE } from "./constants";
import { resolveWallet } from "./lib/wallet";
import { resolveMerchantKey } from "./lib/merchant-key";
import { waitForGas } from "./lib/gas";
import { onboardMerchant } from "./lib/onboard";
import { mcpServerEntry, renderConfigs } from "./lib/config-writer";

const USAGE =
  "usage: arcora-agent-commerce <onboard|serve|refund> [--import <key>] [--keyfile <path>] [--payout-chain <id>] [--payout-address <0x…>]\n" +
  "  onboard            register this wallet as a merchant + write MCP config\n" +
  "  serve              run the MCP server (refund_invoice enabled when a merchant key is present)\n" +
  "  refund <invoiceId> refund a PAID invoice to its original payer on Arc";

function flag(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

async function main() {
  const cmd = process.argv[2];

  if (cmd === "serve") {
    const { buildServer } = await import("@arcora/agent-commerce-mcp");
    const { Commerce, loadConfig, createRefunder } = await import("@arcora/agent-commerce-core");
    const { StdioServerTransport } = await import("@modelcontextprotocol/sdk/server/stdio.js");
    const merchantKey = resolveMerchantKey();
    const refunder = merchantKey ? createRefunder({ privateKey: merchantKey }) : undefined;
    if (!refunder) {
      console.error("refund_invoice disabled: set ARCORA_MERCHANT_KEY or run onboard to create ~/.arcora/merchant.key");
    }
    const server = buildServer(new Commerce(loadConfig()), { refunder });
    await server.connect(new StdioServerTransport());
    return; // stdio server runs until the host closes the pipe
  }

  if (cmd === "refund") {
    const invoiceId = process.argv[3];
    if (!invoiceId) { console.error("usage: arcora-agent-commerce refund <invoiceId>"); process.exit(1); return; }
    const { createRefunder } = await import("@arcora/agent-commerce-core");
    const merchantKey = resolveMerchantKey();
    if (!merchantKey) {
      console.error("no merchant key: set ARCORA_MERCHANT_KEY or run onboard to create ~/.arcora/merchant.key");
      process.exit(1);
      return;
    }
    const refunder = createRefunder({ privateKey: merchantKey });
    const result = await refunder.refund(invoiceId);
    console.log(`refund tx: ${result.txHash} status: ${result.status}`);
    return;
  }

  if (cmd !== "onboard") { console.error(USAGE); process.exit(1); }

  const keyfile = resolve(flag("keyfile") ?? MERCHANT_KEYFILE);
  const importKey = flag("import") ?? process.env.ARCORA_MERCHANT_KEY;

  // Optional merchant payout-chain config (the OUT hop, Plan 7): settle the
  // merchant's revenue on a chain of its choice instead of Arc.
  const payoutChainRaw = flag("payout-chain");
  const payoutChainId = payoutChainRaw !== undefined ? Number(payoutChainRaw) : undefined;
  const payoutChainAddress = flag("payout-address");
  if (payoutChainRaw !== undefined && !Number.isInteger(payoutChainId)) {
    console.error("--payout-chain must be a numeric chain id (e.g. 84532 for Base Sepolia)");
    process.exit(1);
  }

  const wallet = resolveWallet({ keyfilePath: keyfile, importKey });
  console.log(`merchant wallet: ${wallet.address}`);
  if (wallet.created) console.log(`⚠ fresh wallet — key saved to ${keyfile}. BACK IT UP: your earnings settle to this wallet.`);

  const pub = createPublicClient({ chain: arcTestnet, transport: http(ARC_RPC) });
  const walletClient = createWalletClient({ account: wallet.account, chain: arcTestnet, transport: http(ARC_RPC) });

  await waitForGas({
    getBalance: () => pub.getBalance({ address: wallet.account.address }),
    floor: GAS_FLOOR_WEI,
    onNeedFunds: () => console.log(`\nNeed Arc gas. Fund this wallet with testnet USDC:\n  ${FAUCET_URL}\n  address: ${wallet.address}\nWaiting for the balance to arrive…`),
    pollMs: 5000,
    maxPolls: 120,
  });
  console.log(`gas ok: ${formatEther(await pub.getBalance({ address: wallet.account.address }))} USDC`);

  const res = await onboardMerchant({
    account: wallet.account, baseUrl: BASE_URL,
    pub: { readContract: (x) => pub.readContract(x as never) as Promise<readonly unknown[]>, waitForTransactionReceipt: (x) => pub.waitForTransactionReceipt(x) },
    wallet: { writeContract: (x) => walletClient.writeContract(x as never) },
    fetchImpl: fetch,
    nowSec: Math.floor(Date.now() / 1000),
    onStep: (m) => console.log(`  · ${m}`),
    payoutChainId,
    payoutChainAddress,
    // Cross-chain-payout merchants register the relayer's Arc sweep address as
    // their on-chain payoutAddress (onboard.ts resolves the default / env when
    // unset). Surfaced here so an operator can override per-onboard.
    sweepAddress: process.env.ARCORA_RELAYER_SWEEP_ADDRESS,
  });

  if (!res.apiKey) {
    console.log(`\nThis wallet was already bootstrapped — no new key issued. Use your existing ak_live_ key, or onboard a fresh wallet (omit --import).`);
    console.log(`On-chain activation is confirmed (merchant registered + delegate authorized).`);
    return;
  }

  const entry = mcpServerEntry({ apiKey: res.apiKey, baseUrl: BASE_URL });
  const { generic } = renderConfigs(entry);
  const outDir = join(homedir(), ".arcora");
  writeFileSync(join(outDir, "mcp-config.json"), generic, { mode: 0o600 });

  console.log(`\n✓ Live merchant: ${res.merchantAddress}`);
  console.log(`✓ API key: ${res.apiKey.slice(0, 12)}… (full key in ${join(outDir, "mcp-config.json")}, chmod 600)`);
  if (res.payoutChainId !== undefined) {
    console.log(`✓ Payout chain: ${res.payoutChainId}${res.payoutChainAddress ? ` → ${res.payoutChainAddress}` : " (Arc — settle on Arc)"}`);
  }
  console.log(`\nAdd this MCP server to your agent (Hermes / Claude / any MCP host):\n`);
  console.log(generic);
  console.log(`\nThen ask your agent: "what do you sell?" → "buy <item-id>". Buyers can pay in USDC on Arc or bridge from Base.`);
}

main().catch((e) => { console.error("onboard failed:", e?.message ?? e); process.exit(1); });
