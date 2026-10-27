import { AuthClient } from "@icp-sdk/auth/client";
import type { Identity } from "@icp-sdk/core/agent";
import { safeGetCanisterEnv } from "@icp-sdk/core/agent/canister-env";

const environment = safeGetCanisterEnv();
// Custom domains (e.g. icpbonsai.app) sign in as the canister origin, so users keep one principal on every URL.
// II already treats ic0.app, icp0.io and icp.net as the same origin, so those must not set it.
const hostname = window.location.hostname;
const frontendId = environment?.["PUBLIC_CANISTER_ID:frontend"];
const isGatewayHost = ["ic0.app", "icp0.io", "icp.net"].some((domain) => hostname === domain || hostname.endsWith(`.${domain}`));
const isLocalHost = hostname === "localhost" || hostname === "127.0.0.1" || hostname.endsWith(".localhost");
const derivationOrigin = frontendId && !isGatewayHost && !isLocalHost ? `https://${frontendId}.icp.net` : undefined;
export const authClient = new AuthClient({
  // Hosted II must not inherit the local app's API host.
  agentOptions: { host: "https://icp-api.io" },
  ...(derivationOrigin ? { derivationOrigin } : {}),
});

export async function currentIdentity(): Promise<Identity | undefined> {
  return authClient.isAuthenticated() ? authClient.getIdentity() : undefined;
}
export async function login(): Promise<Identity> {
  return authClient.signIn();
}
export async function logout(): Promise<void> {
  await authClient.signOut();
}
