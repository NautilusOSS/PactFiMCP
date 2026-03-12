# pactfi-mcp

MCP (Model Context Protocol) server for the [PactFi](https://pact.fi) AMM DEX on Algorand. Part of the [UluOS](https://github.com/NautilusOSS/UluOS) agent ecosystem.

## Architecture

```
┌──────────────┐     ┌──────────────┐     ┌──────────────────┐
│  PactFi MCP  │────▶│ UluWalletMCP │────▶│ UluBroadcastMCP  │
│  (this repo) │     │  (signing)   │     │  (submit to net) │
└──────┬───────┘     └──────────────┘     └──────────────────┘
       │
       ├── PactFi REST API (api.pact.fi) ── pool discovery & metadata
       └── Algorand algod (algonode.cloud) ── on-chain state & tx params
```

**No PactFi SDK dependency** — pools are queried via the PactFi REST API, quotes are computed locally using constant-product AMM math, and transactions are built directly with `algosdk`.

## Tools

| Tool | Description |
|------|-------------|
| `get_pools` | List PactFi pools with optional filters (symbol, verified, pool type) |
| `get_pool` | Get detailed pool info by app ID (on-chain reserves + API metadata) |
| `get_quote` | Compute swap quote with expected output, fee, price impact, and slippage |
| `swap_txn` | Build unsigned swap transaction group |
| `add_liquidity_txn` | Build unsigned add-liquidity transaction group |
| `remove_liquidity_txn` | Build unsigned remove-liquidity transaction group |

### Tool Details

#### get_pools

List PactFi liquidity pools. Supports filtering by token symbol, verification status, pool type (CONST or STABLE), and result limit.

#### get_pool

Fetch on-chain pool state (reserves A/B, LP supply, fee configuration) merged with API metadata (token names, prices, TVL, APR).

#### get_quote

Simulate a swap without building transactions. Provide `fromToken`/`toToken` symbols and an `amount`. Optionally specify `poolAppId` to target a specific pool, or let it auto-discover the highest-TVL pool for the pair.

#### swap_txn

Build a 2-transaction atomic group:
1. Deposit (payment or asset transfer) to pool escrow
2. Application call with `SWAP` + minimum received

#### add_liquidity_txn

Build a 3-transaction atomic group:
1. Deposit primary asset to pool escrow
2. Deposit secondary asset to pool escrow
3. Application call with `ADDLIQ` + minimum LP tokens

#### remove_liquidity_txn

Build a 2-transaction atomic group:
1. Deposit LP tokens to pool escrow
2. Application call with `REMLIQ` + minimum primary + minimum secondary

## Agent Flow Example

```
Agent: get_quote(fromToken="ALGO", toToken="USDC", amount="100")
  → { expectedOutput: "8.52", minimumReceived: "8.47", poolAppId: 1073557308, ... }

Agent: swap_txn(fromToken="ALGO", toToken="USDC", amount="100", sender="ABC...")
  → { transactions: ["base64...", "base64..."], details: { ... } }

Agent: UluWalletMCP.sign_transactions(signerId="my-signer", transactions=["base64..."])
  → { signedTransactions: ["base64..."] }

Agent: UluBroadcastMCP.broadcast_transactions(network="algorand-mainnet", txns=["base64..."])
  → { txIds: ["TXID..."] }
```

## Setup

```bash
npm install
```

## Usage

```bash
node index.js
```

## Adding to a Client

```json
{
  "mcpServers": {
    "pactfi-mcp": {
      "command": "node",
      "args": ["/absolute/path/to/pactfi-mcp/index.js"]
    }
  }
}
```

## Data Sources

- **PactFi REST API** (`api.pact.fi`): pool listing, token metadata, TVL, volume, APR
- **Algorand algod** (`mainnet-api.algonode.cloud`): on-chain pool state, transaction parameters

## Supported Pool Types

- **Constant Product** (`CONST`): Standard x·y=k AMM pools — fully supported
- **Stableswap** (`STABLE`): Curve-style stable pools — quotes use constant-product approximation (on-chain execution uses the correct stableswap invariant)

## Known Limitations

- Stableswap quote accuracy: off-chain quotes approximate using constant-product math. The on-chain contract uses the correct StableSwap invariant, so actual execution may differ slightly.
- Pool discovery via API may not include all pools. For specific pools, use the `appId` parameter directly.

## License

MIT
