import { safeGetCanisterEnv } from "@icp-sdk/core/agent/canister-env";

export function canisterEnv() {
  const config = safeGetCanisterEnv();
  if (!config?.["PUBLIC_CANISTER_ID:backend"] || !config["PUBLIC_CANISTER_ID:icrc7"]) {
    throw new Error("Canister configuration is missing. Open the deployed frontend or start Vite against a running, deployed local network.");
  }
  return config;
}

function nftOrigin(): string {
  const config = canisterEnv();
  const nft = config["PUBLIC_CANISTER_ID:icrc7"];
  const local = window.location.hostname === "localhost" || window.location.hostname.endsWith(".localhost");
  const origin = config["PUBLIC_NFT_IMAGE_ORIGIN"] || (local
    ? `${window.location.protocol}//${nft}.localhost${window.location.port ? `:${window.location.port}` : ""}`
    : `https://${nft}.icp.net`);
  return origin;
}

export function nftImageUrl(id: bigint): string {
  return `${nftOrigin()}/nft/${id}.svg`;
}

/** Collection logo served (and certified) by the NFT canister; wallets read it from `icrc7:logo`. */
export function collectionLogoUrl(): string {
  return `${nftOrigin()}/logo.svg`;
}

export function isLocalNetwork(): boolean {
  return window.location.hostname === "localhost" || window.location.hostname.endsWith(".localhost");
}
