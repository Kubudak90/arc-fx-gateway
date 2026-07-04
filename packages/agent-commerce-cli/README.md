# @arcora/agent-commerce

Turn an AI agent into an Arcorapay merchant in one command, and serve the
commerce tools over MCP.

## Onboard (become a live merchant)

    npx @arcora/agent-commerce onboard

Generates (or `--import <key>`) a wallet, waits for Arc testnet gas
(faucet.circle.com), registers the merchant on-chain, and writes your
`ak_live_` key + an MCP config to `~/.arcora/mcp-config.json`.

## Serve (the MCP server your agent connects to)

Add to your agent's MCP config (Hermes, Claude Desktop/Code, any MCP host):

    {
      "mcpServers": {
        "arcora-commerce": {
          "command": "npx",
          "args": ["-y", "@arcora/agent-commerce", "serve"],
          "env": { "ARCORA_API_KEY": "ak_live_…", "ARCORA_BASE_URL": "https://arcorapay.xyz" }
        }
      }
    }

Tools: `list_catalog`, `create_invoice`, `get_checkout_status`. Buyers pay in
USDC on Arc or bridge from Base. Testnet today.
