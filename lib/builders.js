import algosdk from "algosdk";
import { getPoolStateOnChain, getSuggestedParams, getApplicationAddress } from "./client.js";
import { fetchPoolByAppId, findBestPool } from "./api.js";
import {
  toBaseUnits,
  fromBaseUnits,
  computeConstantProductSwap,
  computeMinimumReceived,
} from "./swap.js";

const encoder = new TextEncoder();

function encodeAppArgs(args) {
  return args.map((arg) => {
    if (typeof arg === "string") return encoder.encode(arg);
    if (typeof arg === "bigint" || typeof arg === "number") {
      return algosdk.encodeUint64(Number(arg));
    }
    return arg;
  });
}

function makeDepositTx(senderAddr, receiverAddr, assetId, amount, note, sp) {
  const bigAmount = BigInt(amount);
  if (assetId === 0) {
    return algosdk.makePaymentTxnWithSuggestedParamsFromObject({
      sender: senderAddr,
      receiver: receiverAddr,
      amount: bigAmount,
      note: encoder.encode(note),
      suggestedParams: sp,
    });
  }
  return algosdk.makeAssetTransferTxnWithSuggestedParamsFromObject({
    sender: senderAddr,
    receiver: receiverAddr,
    amount: bigAmount,
    assetIndex: assetId,
    note: encoder.encode(note),
    suggestedParams: sp,
  });
}

function encodeTxns(txns) {
  return txns.map((txn) =>
    Buffer.from(algosdk.encodeUnsignedTransaction(txn)).toString("base64")
  );
}

function resolveDirection(poolState, apiPool, fromSymbol) {
  const upper = fromSymbol.toUpperCase();
  const priSym = apiPool?.primary_asset?.unit_name?.toUpperCase();
  const secSym = apiPool?.secondary_asset?.unit_name?.toUpperCase();
  const priId = String(poolState.primaryAssetId);
  const secId = String(poolState.secondaryAssetId);

  if (upper === priSym || upper === priId) return "primary_to_secondary";
  if (upper === secSym || upper === secId) return "secondary_to_primary";
  throw new Error(
    `Token "${fromSymbol}" not in pool. Assets: ${priSym || priId}/${secSym || secId}`
  );
}

export async function buildSwapTxns({
  poolAppId,
  fromToken,
  toToken,
  amount,
  sender,
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
  const sp = await getSuggestedParams();
  const escrow = getApplicationAddress(appId);

  const direction = resolveDirection(poolState, apiPool, fromToken);
  const isPrimaryIn = direction === "primary_to_secondary";

  const inAssetId = isPrimaryIn ? poolState.primaryAssetId : poolState.secondaryAssetId;
  const inDecimals = isPrimaryIn
    ? (apiPool?.primary_asset?.decimals ?? 6)
    : (apiPool?.secondary_asset?.decimals ?? 6);
  const outDecimals = isPrimaryIn
    ? (apiPool?.secondary_asset?.decimals ?? 6)
    : (apiPool?.primary_asset?.decimals ?? 6);

  const liqIn = isPrimaryIn ? poolState.primaryLiquidity : poolState.secondaryLiquidity;
  const liqOut = isPrimaryIn ? poolState.secondaryLiquidity : poolState.primaryLiquidity;
  const amountInBase = toBaseUnits(amount, inDecimals);

  const isStableswap = poolState.poolType === "STABLESWAP";
  if (isStableswap) {
    throw new Error(
      "Stableswap pools require the StableSwap (Curve) invariant for accurate swap " +
      "calculations. This MCP currently supports constant-product pools only. " +
      "Use get_quote for an approximate stableswap quote."
    );
  }

  const { netAmountOut } = computeConstantProductSwap(liqIn, liqOut, amountInBase, poolState.feeBps);
  const minimumReceived = computeMinimumReceived(netAmountOut, slippage);

  const txn1 = makeDepositTx(
    sender,
    escrow,
    inAssetId,
    amountInBase,
    "Pact swap deposit",
    sp
  );

  const appCallSp = { ...sp, fee: 2000, flatFee: true };
  const foreignAssets =
    poolState.primaryAssetId === 0
      ? [poolState.secondaryAssetId]
      : [poolState.primaryAssetId, poolState.secondaryAssetId];

  const txn2 = algosdk.makeApplicationNoOpTxnFromObject({
    sender,
    appIndex: appId,
    appArgs: encodeAppArgs(["SWAP", Number(minimumReceived)]),
    foreignAssets,
    suggestedParams: appCallSp,
  });

  const grouped = algosdk.assignGroupID([txn1, txn2]);

  const inSymbol = isPrimaryIn
    ? (apiPool?.primary_asset?.unit_name ?? String(inAssetId))
    : (apiPool?.secondary_asset?.unit_name ?? String(inAssetId));
  const outSymbol = isPrimaryIn
    ? (apiPool?.secondary_asset?.unit_name ?? String(poolState.secondaryAssetId))
    : (apiPool?.primary_asset?.unit_name ?? String(poolState.primaryAssetId));

  return {
    transactions: encodeTxns(grouped),
    details: {
      poolAppId: appId,
      direction,
      fromToken: inSymbol,
      toToken: outSymbol,
      amountIn: amount,
      expectedOutput: fromBaseUnits(netAmountOut, outDecimals),
      minimumReceived: fromBaseUnits(minimumReceived, outDecimals),
      slippagePct: slippage,
    },
  };
}

export async function buildAddLiquidityTxns({
  poolAppId,
  primaryAmount,
  secondaryAmount,
  sender,
  slippage = 0.5,
}) {
  const poolState = await getPoolStateOnChain(poolAppId);
  const apiPool = await fetchPoolByAppId(poolAppId, {
    primaryAssetId: poolState.primaryAssetId,
    secondaryAssetId: poolState.secondaryAssetId,
  });
  const sp = await getSuggestedParams();
  const escrow = getApplicationAddress(poolAppId);

  const priDecimals = apiPool?.primary_asset?.decimals ?? 6;
  const secDecimals = apiPool?.secondary_asset?.decimals ?? 6;

  const priBase = toBaseUnits(primaryAmount, priDecimals);
  const secBase = toBaseUnits(secondaryAmount, secDecimals);

  const isInitial = poolState.totalLpTokens === 0n;
  let expectedLp;
  if (isInitial) {
    const product = priBase * secBase;
    expectedLp = sqrt(product);
    if (expectedLp <= 1000n) throw new Error("Initial liquidity too small");
  } else {
    const lpFromPri = (priBase * poolState.totalLpTokens) / poolState.primaryLiquidity;
    const lpFromSec = (secBase * poolState.totalLpTokens) / poolState.secondaryLiquidity;
    expectedLp = lpFromPri < lpFromSec ? lpFromPri : lpFromSec;
    if (expectedLp <= 0n) throw new Error("Amount of minted liquidity tokens must be greater than 0");
  }

  const slippageBps = BigInt(Math.round(slippage * 100));
  let minimumLp = expectedLp - (expectedLp * slippageBps) / 10000n;
  if (minimumLp < 0n) minimumLp = 0n;
  if (isInitial) minimumLp -= 1000n;

  const txn1 = makeDepositTx(
    sender,
    escrow,
    poolState.primaryAssetId,
    priBase,
    "Pact add liquidity deposit",
    sp
  );
  const txn2 = makeDepositTx(
    sender,
    escrow,
    poolState.secondaryAssetId,
    secBase,
    "Pact add liquidity deposit",
    sp
  );

  const appCallSp = { ...sp, fee: 3000, flatFee: true };
  const foreignAssets =
    poolState.primaryAssetId === 0
      ? [poolState.secondaryAssetId, poolState.lpAssetId]
      : [poolState.primaryAssetId, poolState.secondaryAssetId, poolState.lpAssetId];

  const txn3 = algosdk.makeApplicationNoOpTxnFromObject({
    sender,
    appIndex: poolAppId,
    appArgs: encodeAppArgs(["ADDLIQ", Number(minimumLp)]),
    foreignAssets,
    suggestedParams: appCallSp,
  });

  const grouped = algosdk.assignGroupID([txn1, txn2, txn3]);
  const lpDecimals = apiPool?.pool_asset?.decimals ?? 6;

  return {
    transactions: encodeTxns(grouped),
    details: {
      poolAppId,
      primaryAsset: apiPool?.primary_asset?.unit_name ?? String(poolState.primaryAssetId),
      secondaryAsset: apiPool?.secondary_asset?.unit_name ?? String(poolState.secondaryAssetId),
      primaryAmount,
      secondaryAmount,
      expectedLpTokens: fromBaseUnits(expectedLp, lpDecimals),
      minimumLpTokens: fromBaseUnits(minimumLp, lpDecimals),
      slippagePct: slippage,
    },
  };
}

export async function buildRemoveLiquidityTxns({
  poolAppId,
  lpAmount,
  sender,
  slippage = 0.5,
}) {
  const poolState = await getPoolStateOnChain(poolAppId);
  const apiPool = await fetchPoolByAppId(poolAppId, {
    primaryAssetId: poolState.primaryAssetId,
    secondaryAssetId: poolState.secondaryAssetId,
  });
  const sp = await getSuggestedParams();
  const escrow = getApplicationAddress(poolAppId);

  const lpDecimals = apiPool?.pool_asset?.decimals ?? 6;
  const priDecimals = apiPool?.primary_asset?.decimals ?? 6;
  const secDecimals = apiPool?.secondary_asset?.decimals ?? 6;

  const lpBase = toBaseUnits(lpAmount, lpDecimals);

  if (poolState.totalLpTokens === 0n) {
    throw new Error("Pool has no liquidity");
  }

  const expectedPrimary = (lpBase * poolState.primaryLiquidity) / poolState.totalLpTokens;
  const expectedSecondary = (lpBase * poolState.secondaryLiquidity) / poolState.totalLpTokens;

  const slippageBps = BigInt(Math.round(slippage * 100));
  const minPrimary = (expectedPrimary * (10000n - slippageBps)) / 10000n;
  const minSecondary = (expectedSecondary * (10000n - slippageBps)) / 10000n;

  const txn1 = makeDepositTx(
    sender,
    escrow,
    poolState.lpAssetId,
    lpBase,
    "Pact remove liquidity deposit",
    sp
  );

  const appCallSp = { ...sp, fee: 3000, flatFee: true };
  const foreignAssets =
    poolState.primaryAssetId === 0
      ? [poolState.secondaryAssetId]
      : [poolState.primaryAssetId, poolState.secondaryAssetId];

  const txn2 = algosdk.makeApplicationNoOpTxnFromObject({
    sender,
    appIndex: poolAppId,
    appArgs: encodeAppArgs(["REMLIQ", Number(minPrimary), Number(minSecondary)]),
    foreignAssets,
    suggestedParams: appCallSp,
  });

  const grouped = algosdk.assignGroupID([txn1, txn2]);

  return {
    transactions: encodeTxns(grouped),
    details: {
      poolAppId,
      lpAmount,
      expectedPrimary: fromBaseUnits(expectedPrimary, priDecimals),
      expectedSecondary: fromBaseUnits(expectedSecondary, secDecimals),
      minimumPrimary: fromBaseUnits(minPrimary, priDecimals),
      minimumSecondary: fromBaseUnits(minSecondary, secDecimals),
      primaryAsset: apiPool?.primary_asset?.unit_name ?? String(poolState.primaryAssetId),
      secondaryAsset: apiPool?.secondary_asset?.unit_name ?? String(poolState.secondaryAssetId),
      slippagePct: slippage,
    },
  };
}

function sqrt(value) {
  if (value < 0n) throw new Error("Square root of negative number");
  if (value === 0n) return 0n;
  let z = value;
  let x = value / 2n + 1n;
  while (x < z) {
    z = x;
    x = (value / x + x) / 2n;
  }
  return z;
}
