import { safeGetCanisterEnv } from "@icp-sdk/core/agent/canister-env";

export function canisterEnv() {
  const config = safeGetCanisterEnv();
  if (!config?.["PUBLIC_CANISTER_ID:backend"] || !config["PUBLIC_CANISTER_ID:icrc7"]) {
    throw new Error("Canister configuration is missing. Open the deployed frontend or start Vite against a running, deployed local network.");
  }
  return config;
}

export function nftImageUrl(id: bigint): string {
  const config = canisterEnv();
  const nft = config["PUBLIC_CANISTER_ID:icrc7"];
  const local = window.location.hostname === "localhost" || window.location.hostname.endsWith(".localhost");
  const origin = config["PUBLIC_NFT_IMAGE_ORIGIN"] || (local
    ? `${window.location.protocol}//${nft}.localhost${window.location.port ? `:${window.location.port}` : ""}`
    : `https://${nft}.icp.net`);
  return `${origin}/nft/${id}.svg`;
}
