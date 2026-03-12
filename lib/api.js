import { readFileSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const config = JSON.parse(
  readFileSync(join(__dirname, "..", "data", "contracts.json"), "utf-8")
);

const BASE_URL = config.algorand.pactApiUrl;

async function get(path) {
  const url = `${BASE_URL}${path}`;
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`PactFi API ${res.status}: ${res.statusText} — ${url}`);
  }
  return res.json();
}

export async function fetchPools(params = {}) {
  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== null) qs.set(k, String(v));
  }
  const query = qs.toString();
  return get(`/api/pools${query ? `?${query}` : ""}`);
}

export async function fetchPoolByAppId(appId) {
  const data = await fetchPools({ limit: 100 });
  const pool = data.results.find((p) => String(p.on_chain_id) === String(appId));
  if (!pool) {
    const data2 = await fetchPools({ offset: 100, limit: 100 });
    return data2.results.find((p) => String(p.on_chain_id) === String(appId)) ?? null;
  }
  return pool;
}

export async function findBestPool(symbolA, symbolB) {
  const normalize = (s) => s.toUpperCase();
  const a = normalize(symbolA);
  const b = normalize(symbolB);

  const data1 = await fetchPools({
    primary_asset__unit_name: a,
    secondary_asset__unit_name: b,
    limit: 20,
  });
  const data2 = await fetchPools({
    primary_asset__unit_name: b,
    secondary_asset__unit_name: a,
    limit: 20,
  });

  const allPools = [...data1.results, ...data2.results];
  if (allPools.length === 0) {
    throw new Error(`No PactFi pool found for ${symbolA}/${symbolB}`);
  }

  allPools.sort((x, y) => {
    if (x.is_deprecated !== y.is_deprecated) return x.is_deprecated ? 1 : -1;
    if (x.is_verified !== y.is_verified) return x.is_verified ? -1 : 1;
    return parseFloat(y.tvl_usd || "0") - parseFloat(x.tvl_usd || "0");
  });

  return allPools[0];
}
