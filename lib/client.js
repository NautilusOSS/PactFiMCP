import algosdk from "algosdk";
import { readFileSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const config = JSON.parse(
  readFileSync(join(__dirname, "..", "data", "contracts.json"), "utf-8")
);

const chainConfig = config.algorand;

export function getAlgodClient() {
  return new algosdk.Algodv2(
    chainConfig.algodToken,
    chainConfig.algodUrl,
    chainConfig.algodPort
  );
}

export function getApplicationAddress(appId) {
  const addr = algosdk.getApplicationAddress(appId);
  return typeof addr === "string" ? addr : addr.toString();
}

function decodeGlobalState(stateArray) {
  const state = {};
  for (const entry of stateArray) {
    const keyBuf = Buffer.from(entry.key, "base64");
    const key = keyBuf.toString("utf-8");
    if (entry.value.type === 2) {
      state[key] = Number(entry.value.uint);
    } else {
      state[key] = Buffer.from(entry.value.bytes, "base64");
    }
  }
  return state;
}

/**
 * Decode the packed CONFIG blob into individual uint64 values.
 * Constant-product pools: [ASSET_A, ASSET_B, FEE_BPS]
 * Stableswap pools:       [ASSET_A, ASSET_B, FEE_BPS, PRECISION]
 */
function decodeConfigBlob(configBuf) {
  const result = { ASSET_A: 0, ASSET_B: 0, FEE_BPS: 30 };
  if (!configBuf || configBuf.length < 24) return result;

  result.ASSET_A = Number(configBuf.readBigUInt64BE(0));
  result.ASSET_B = Number(configBuf.readBigUInt64BE(8));
  result.FEE_BPS = Number(configBuf.readBigUInt64BE(16));
  if (configBuf.length >= 32) {
    result.PRECISION = Number(configBuf.readBigUInt64BE(24));
  }
  return result;
}

function resolvePoolType(contractName) {
  if (contractName === "[SI] PACT AMM") return "STABLESWAP";
  if (contractName === "PACT AMM [NFT]") return "NFT_CONSTANT_PRODUCT";
  return "CONSTANT_PRODUCT";
}

export async function getPoolStateOnChain(appId) {
  const algod = getAlgodClient();
  const appInfo = await algod.getApplicationByID(appId).do();
  const globalState =
    appInfo.params?.globalState ??
    appInfo.params?.["global-state"] ??
    [];
  const decoded = decodeGlobalState(globalState);

  const configValues = decodeConfigBlob(decoded["CONFIG"]);

  const contractName = decoded["CONTRACT_NAME"]
    ? decoded["CONTRACT_NAME"].toString("utf-8")
    : undefined;

  return {
    appId,
    escrowAddress: getApplicationAddress(appId),
    primaryAssetId: configValues.ASSET_A,
    secondaryAssetId: configValues.ASSET_B,
    primaryLiquidity: BigInt(decoded["A"] ?? 0),
    secondaryLiquidity: BigInt(decoded["B"] ?? 0),
    totalLpTokens: BigInt(decoded["L"] ?? 0),
    lpAssetId: decoded["LTID"] ?? 0,
    feeBps: decoded["FEE_BPS"] ?? configValues.FEE_BPS,
    pactFeeBps: decoded["PACT_FEE_BPS"] ?? 0,
    contractName: contractName ?? "PACT AMM",
    poolType: resolvePoolType(contractName),
    precision: configValues.PRECISION ?? decoded["PRECISION"] ?? undefined,
    version: decoded["VERSION"] ?? 0,
    initialA: decoded["INITIAL_A"] ?? undefined,
    initialATime: decoded["INITIAL_A_TIME"] ?? undefined,
    futureA: decoded["FUTURE_A"] ?? undefined,
    futureATime: decoded["FUTURE_A_TIME"] ?? undefined,
  };
}

export async function getSuggestedParams() {
  const algod = getAlgodClient();
  return algod.getTransactionParams().do();
}

export { chainConfig };
