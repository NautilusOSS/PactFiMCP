import { fetchPools, fetchPoolByAppId } from "./api.js";
import { getPoolStateOnChain } from "./client.js";

function formatApiPool(pool) {
  return {
    appId: Number(pool.on_chain_id),
    escrowAddress: pool.on_chain_address,
    version: pool.version,
    poolType: pool.pool_type,
    feeBps: pool.fee_bps,
    isVerified: pool.is_verified,
    isDeprecated: pool.is_deprecated,
    primaryAsset: {
      id: Number(pool.primary_asset.on_chain_id),
      symbol: pool.primary_asset.unit_name,
      name: pool.primary_asset.name,
      decimals: pool.primary_asset.decimals,
      priceUsd: pool.primary_asset.price,
    },
    secondaryAsset: {
      id: Number(pool.secondary_asset.on_chain_id),
      symbol: pool.secondary_asset.unit_name,
      name: pool.secondary_asset.name,
      decimals: pool.secondary_asset.decimals,
      priceUsd: pool.secondary_asset.price,
    },
    lpAsset: {
      id: Number(pool.pool_asset.on_chain_id),
      symbol: pool.pool_asset.unit_name,
      name: pool.pool_asset.name,
      decimals: pool.pool_asset.decimals,
    },
    tvlUsd: pool.tvl_usd,
    volume24h: pool.volume_24h,
    volume7d: pool.volume_7d,
    feeUsd24h: pool.fee_usd_24h,
    feeUsd7d: pool.fee_usd_7d,
    apr7d: pool.apr_7d,
  };
}

export async function getPools({ symbol, is_verified, pool_type, limit } = {}) {
  const params = { limit: limit || 20 };

  if (is_verified !== undefined) params.is_verified = is_verified;

  if (symbol) {
    const upper = symbol.toUpperCase();
    const [d1, d2] = await Promise.all([
      fetchPools({ ...params, primary_asset__unit_name: upper }),
      fetchPools({ ...params, secondary_asset__unit_name: upper }),
    ]);

    const seen = new Set();
    const merged = [];
    for (const p of [...d1.results, ...d2.results]) {
      if (!seen.has(p.on_chain_id)) {
        seen.add(p.on_chain_id);
        merged.push(p);
      }
    }

    let results = merged;
    if (pool_type) results = results.filter((p) => p.pool_type === pool_type);
    return results.map(formatApiPool);
  }

  const data = await fetchPools(params);
  let results = data.results;
  if (pool_type) results = results.filter((p) => p.pool_type === pool_type);
  return results.map(formatApiPool);
}

export async function getPool(appId) {
  const [onChain, apiPool] = await Promise.all([
    getPoolStateOnChain(appId),
    fetchPoolByAppId(appId),
  ]);

  const result = {
    appId,
    escrowAddress: onChain.escrowAddress,
    contractName: onChain.contractName,
    version: onChain.version,
    feeBps: onChain.feeBps,
    primaryAsset: {
      id: onChain.primaryAssetId,
      liquidity: onChain.primaryLiquidity.toString(),
    },
    secondaryAsset: {
      id: onChain.secondaryAssetId,
      liquidity: onChain.secondaryLiquidity.toString(),
    },
    lpAsset: {
      id: onChain.lpAssetId,
      totalSupply: onChain.totalLpTokens.toString(),
    },
  };

  if (apiPool) {
    result.primaryAsset.symbol = apiPool.primary_asset.unit_name;
    result.primaryAsset.name = apiPool.primary_asset.name;
    result.primaryAsset.decimals = apiPool.primary_asset.decimals;
    result.primaryAsset.priceUsd = apiPool.primary_asset.price;
    result.secondaryAsset.symbol = apiPool.secondary_asset.unit_name;
    result.secondaryAsset.name = apiPool.secondary_asset.name;
    result.secondaryAsset.decimals = apiPool.secondary_asset.decimals;
    result.secondaryAsset.priceUsd = apiPool.secondary_asset.price;
    result.lpAsset.symbol = apiPool.pool_asset.unit_name;
    result.lpAsset.decimals = apiPool.pool_asset.decimals;
    result.poolType = apiPool.pool_type;
    result.isVerified = apiPool.is_verified;
    result.isDeprecated = apiPool.is_deprecated;
    result.tvlUsd = apiPool.tvl_usd;
    result.volume24h = apiPool.volume_24h;
    result.apr7d = apiPool.apr_7d;
  }

  return result;
}
