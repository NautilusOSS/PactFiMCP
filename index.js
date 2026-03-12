import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { getPools, getPool } from "./lib/pools.js";
import { getQuote } from "./lib/swap.js";
import {
  buildSwapTxns,
  buildAddLiquidityTxns,
  buildRemoveLiquidityTxns,
} from "./lib/builders.js";

const server = new McpServer({
  name: "pactfi-mcp",
  version: "0.1.0",
});

function ok(data) {
  return {
    content: [{ type: "text", text: JSON.stringify(data, null, 2) }],
  };
}

function err(error) {
  return {
    isError: true,
    content: [{ type: "text", text: String(error?.message ?? error) }],
  };
}

// ── Pool discovery ──────────────────────────────────────────────────────────

server.tool(
  "get_pools",
  "List PactFi AMM liquidity pools on Algorand with optional filters. Returns pool metadata, TVL, volume, and APR.",
  {
    symbol: z
      .string()
      .optional()
      .describe("Filter pools containing this token symbol (e.g. ALGO, USDC, goBTC)"),
    is_verified: z.boolean().optional().describe("Filter for verified pools only"),
    pool_type: z
      .enum(["CONST", "STABLE"])
      .optional()
      .describe("Filter by pool type: CONST (constant product) or STABLE (stableswap)"),
    limit: z
      .number()
      .optional()
      .describe("Maximum number of results to return (default 20)"),
  },
  async (params) => {
    try {
      const pools = await getPools(params);
      return ok(pools);
    } catch (e) {
      return err(e);
    }
  }
);

server.tool(
  "get_pool",
  "Get detailed PactFi pool information by application ID. Returns on-chain reserves, fee configuration, LP supply, and API metadata.",
  {
    appId: z
      .number()
      .describe("Pool application ID on Algorand"),
  },
  async ({ appId }) => {
    try {
      const pool = await getPool(appId);
      return ok(pool);
    } catch (e) {
      return err(e);
    }
  }
);

// ── Swap quotes ─────────────────────────────────────────────────────────────

server.tool(
  "get_quote",
  "Get a swap quote from PactFi using constant-product AMM math. Computes expected output, fee, price impact, and minimum received after slippage. Provide either a poolAppId or fromToken+toToken symbols to auto-discover the best pool.",
  {
    poolAppId: z
      .number()
      .optional()
      .describe("Pool application ID (optional if fromToken and toToken are provided)"),
    fromToken: z
      .string()
      .describe("Token symbol to swap from (e.g. ALGO, USDC)"),
    toToken: z
      .string()
      .describe("Token symbol to swap to (e.g. USDC, ALGO)"),
    amount: z
      .string()
      .describe("Amount to swap in human-readable units (e.g. '100' for 100 ALGO)"),
    slippage: z
      .number()
      .optional()
      .default(0.5)
      .describe("Slippage tolerance in percent (default 0.5)"),
  },
  async (params) => {
    try {
      const quote = await getQuote(params);
      return ok(quote);
    } catch (e) {
      return err(e);
    }
  }
);

// ── Transaction builders ────────────────────────────────────────────────────

server.tool(
  "swap_txn",
  "Build unsigned transactions to swap tokens on PactFi. Returns base64-encoded transaction group for signing via UluWalletMCP. Finds the best pool automatically if poolAppId is not specified.",
  {
    poolAppId: z
      .number()
      .optional()
      .describe("Pool application ID (optional — auto-discovered from token symbols)"),
    fromToken: z
      .string()
      .describe("Token symbol to swap from (e.g. ALGO, USDC)"),
    toToken: z
      .string()
      .describe("Token symbol to swap to"),
    amount: z
      .string()
      .describe("Amount to swap in human-readable units"),
    sender: z
      .string()
      .describe("Sender wallet address"),
    slippage: z
      .number()
      .optional()
      .default(0.5)
      .describe("Slippage tolerance in percent (default 0.5)"),
  },
  async (params) => {
    try {
      const result = await buildSwapTxns(params);
      return ok(result);
    } catch (e) {
      return err(e);
    }
  }
);

server.tool(
  "add_liquidity_txn",
  "Build unsigned transactions to add liquidity to a PactFi pool. Returns base64-encoded transaction group for signing via UluWalletMCP.",
  {
    poolAppId: z
      .number()
      .describe("Pool application ID"),
    primaryAmount: z
      .string()
      .describe("Amount of primary asset in human-readable units"),
    secondaryAmount: z
      .string()
      .describe("Amount of secondary asset in human-readable units"),
    sender: z
      .string()
      .describe("Sender wallet address"),
    slippage: z
      .number()
      .optional()
      .default(0.5)
      .describe("Slippage tolerance in percent (default 0.5)"),
  },
  async (params) => {
    try {
      const result = await buildAddLiquidityTxns(params);
      return ok(result);
    } catch (e) {
      return err(e);
    }
  }
);

server.tool(
  "remove_liquidity_txn",
  "Build unsigned transactions to remove liquidity from a PactFi pool. Returns base64-encoded transaction group for signing via UluWalletMCP.",
  {
    poolAppId: z
      .number()
      .describe("Pool application ID"),
    lpAmount: z
      .string()
      .describe("Amount of LP tokens to burn in human-readable units"),
    sender: z
      .string()
      .describe("Sender wallet address"),
    slippage: z
      .number()
      .optional()
      .default(0.5)
      .describe("Slippage tolerance in percent (default 0.5)"),
  },
  async (params) => {
    try {
      const result = await buildRemoveLiquidityTxns(params);
      return ok(result);
    } catch (e) {
      return err(e);
    }
  }
);

const transport = new StdioServerTransport();
await server.connect(transport);
