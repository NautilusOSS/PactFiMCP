import { getPoolStateOnChain } from "./client.js";
import { fetchPoolByAppId, findBestPool } from "./api.js";

export function toBaseUnits(amount, decimals) {
  const parts = String(amount).split(".");
  const whole = parts[0];
  const frac = (parts[1] || "").padEnd(decimals, "0").slice(0, decimals);
  return BigInt(whole) * 10n ** BigInt(decimals) + BigInt(frac);
}

export function fromBaseUnits(amount, decimals) {
  const s = amount.toString().padStart(decimals + 1, "0");
  const whole = s.slice(0, s.length - decimals);
  const frac = s.slice(s.length - decimals);
  const trimmed = frac.replace(/0+$/, "");
  return trimmed ? `${whole}.${trimmed}` : whole;
}

/**
 * Constant product swap: output = (liqOut * amountIn) / (liqIn + amountIn)
 * Fee is deducted from the gross output.
 */
export function computeConstantProductSwap(liqIn, liqOut, amountIn, feeBps) {
  if (liqIn === 0n || liqOut === 0n) {
    throw new Error("Pool has zero liquidity");
  }
  const grossAmountOut = (liqOut * amountIn) / (liqIn + amountIn);
  const fee = grossAmountOut - (grossAmountOut * (10000n - BigInt(feeBps))) / 10000n;
  const netAmountOut = grossAmountOut - fee;
  return { grossAmountOut, fee, netAmountOut };
}

export function computeMinimumReceived(netAmountOut, slippagePct) {
  const slippageBps = BigInt(Math.round(slippagePct * 100));
  return (netAmountOut * (10000n - slippageBps)) / 10000n;
}

export function computePriceImpact(liqIn, liqOut, amountIn, netAmountOut) {
  if (amountIn === 0n || netAmountOut === 0n) return 0;
  const spotNum = liqOut * 10000n;
  const spotDen = liqIn;
  const execNum = netAmountOut * 10000n;
  const execDen = amountIn;
  const impactBps =
    10000n - (execNum * spotDen * 10000n) / (execDen * spotNum);
  return Number(impactBps) / 100;
}

function resolveSwapDirection(poolState, apiPool, fromSymbol) {
  const upper = fromSymbol.toUpperCase();
  const priSymbol = apiPool?.primary_asset?.unit_name?.toUpperCase();
  const secSymbol = apiPool?.secondary_asset?.unit_name?.toUpperCase();
  const priId = String(poolState.primaryAssetId);
  const secId = String(poolState.secondaryAssetId);

  if (upper === priSymbol || upper === priId) {
    return "primary_to_secondary";
  }
  if (upper === secSymbol || upper === secId) {
    return "secondary_to_primary";
  }
  throw new Error(
    `Token "${fromSymbol}" not found in pool. ` +
      `Pool assets: ${priSymbol || priId} / ${secSymbol || secId}`
  );
}

export async function getQuote({
  poolAppId,
  fromToken,
  toToken,
  amount,
  slippage = 0.5,
}) {
  let apiPool;
  let appId = poolAppId;

  if (!appId) {
    if (!fromToken || !toToken) {
      throw new Error("Provide poolAppId or both fromToken and toToken");
    }
    apiPool = await findBestPool(fromToken, toToken);
    appId = Number(apiPool.on_chain_id);
  }

  const poolState = await getPoolStateOnChain(appId);

  if (!apiPool) {
    apiPool = await fetchPoolByAppId(appId, {
      primaryAssetId: poolState.primaryAssetId,
      secondaryAssetId: poolState.secondaryAssetId,
    });
  }

  const isStableswap = poolState.poolType === "STABLESWAP";

  const direction = resolveSwapDirection(
    poolState,
    apiPool,
    fromToken || (apiPool ? apiPool.primary_asset.unit_name : String(poolState.primaryAssetId))
  );

  const isPrimaryIn = direction === "primary_to_secondary";
  const liqIn = isPrimaryIn ? poolState.primaryLiquidity : poolState.secondaryLiquidity;
  const liqOut = isPrimaryIn ? poolState.secondaryLiquidity : poolState.primaryLiquidity;

  const inDecimals = isPrimaryIn
    ? (apiPool?.primary_asset?.decimals ?? 6)
    : (apiPool?.secondary_asset?.decimals ?? 6);
  const outDecimals = isPrimaryIn
    ? (apiPool?.secondary_asset?.decimals ?? 6)
    : (apiPool?.primary_asset?.decimals ?? 6);

  const amountInBase = toBaseUnits(amount, inDecimals);
  const { grossAmountOut, fee, netAmountOut } = computeConstantProductSwap(
    liqIn,
    liqOut,
    amountInBase,
    poolState.feeBps
  );
  const minimumReceived = computeMinimumReceived(netAmountOut, slippage);
  const priceImpact = computePriceImpact(liqIn, liqOut, amountInBase, netAmountOut);

  const inSymbol = isPrimaryIn
    ? (apiPool?.primary_asset?.unit_name ?? String(poolState.primaryAssetId))
    : (apiPool?.secondary_asset?.unit_name ?? String(poolState.secondaryAssetId));
  const outSymbol = isPrimaryIn
    ? (apiPool?.secondary_asset?.unit_name ?? String(poolState.secondaryAssetId))
    : (apiPool?.primary_asset?.unit_name ?? String(poolState.primaryAssetId));

  const result = {
    poolAppId: appId,
    poolType: poolState.poolType,
    direction,
    fromToken: inSymbol,
    toToken: outSymbol,
    amountIn: amount,
    amountInBaseUnits: amountInBase.toString(),
    expectedOutput: fromBaseUnits(netAmountOut, outDecimals),
    expectedOutputBaseUnits: netAmountOut.toString(),
    grossOutput: fromBaseUnits(grossAmountOut, outDecimals),
    fee: fromBaseUnits(fee, outDecimals),
    feeBps: poolState.feeBps,
    minimumReceived: fromBaseUnits(minimumReceived, outDecimals),
    minimumReceivedBaseUnits: minimumReceived.toString(),
    slippagePct: slippage,
    priceImpactPct: priceImpact,
    rate: netAmountOut > 0n
      ? (Number(amountInBase) / Number(netAmountOut)).toFixed(8)
      : "N/A",
    poolState: {
      primaryLiquidity: poolState.primaryLiquidity.toString(),
      secondaryLiquidity: poolState.secondaryLiquidity.toString(),
    },
  };

  if (isStableswap) {
    result.warning =
      "This is a stableswap pool. The quote uses constant-product approximation; " +
      "on-chain execution uses the StableSwap (Curve) invariant and may differ.";
  }

  return result;
}
