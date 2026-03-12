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
  return algosdk.getApplicationAddress(appId);
}

function decodeGlobalState(stateArray) {
  const state = {};
  for (const entry of stateArray) {
    const keyBuf = Buffer.from(entry.key, "base64");
    const key = keyBuf.toString("utf-8");
    if (entry.value.type === 2) {
      state[key] = entry.value.uint;
    } else {
      state[key] = Buffer.from(entry.value.bytes, "base64");
    }
  }
  return state;
}

export async function getPoolStateOnChain(appId) {
  const algod = getAlgodClient();
  const appInfo = await algod.getApplicationByID(appId).do();
  const globalState = appInfo.params?.["global-state"] ?? appInfo["params"]?.["global-state"] ?? [];
  const decoded = decodeGlobalState(globalState);

  return {
    appId,
    escrowAddress: getApplicationAddress(appId),
    primaryAssetId: decoded["ASSET_A"] ?? 0,
    secondaryAssetId: decoded["ASSET_B"] ?? 0,
    primaryLiquidity: BigInt(decoded["A"] ?? 0),
    secondaryLiquidity: BigInt(decoded["B"] ?? 0),
    totalLpTokens: BigInt(decoded["L"] ?? 0),
    lpAssetId: decoded["LTID"] ?? 0,
    feeBps: decoded["FEE_BPS"] ?? 30,
    pactFeeBps: decoded["PACT_FEE_BPS"] ?? 0,
    contractName: decoded["CONTRACT_NAME"]
      ? decoded["CONTRACT_NAME"].toString("utf-8")
      : "PACT AMM",
    version: decoded["VERSION"] ?? 0,
  };
}

export async function getSuggestedParams() {
  const algod = getAlgodClient();
  return algod.getTransactionParams().do();
}

export { chainConfig };
