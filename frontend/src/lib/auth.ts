import { AuthClient } from "@icp-sdk/auth/client";
import type { Identity } from "@icp-sdk/core/agent";
import { safeGetCanisterEnv } from "@icp-sdk/core/agent/canister-env";

const environment = safeGetCanisterEnv();
const providerHostname = environment?.PUBLIC_II_AUTHORIZE_URL
  ? new URL(environment.PUBLIC_II_AUTHORIZE_URL).hostname
  : undefined;
const usesLocalIdentity = providerHostname === "localhost" || providerHostname?.endsWith(".localhost") === true;
const isLocalCallback = usesLocalIdentity && window.location.pathname === "/auth";
// Custom domains (e.g. icpbonsai.app) sign in as the canister origin, so users keep one principal on every URL.
// II already treats ic0.app, icp0.io and icp.net as the same origin, so those must not set it.
const hostname = window.location.hostname;
const frontendId = environment?.["PUBLIC_CANISTER_ID:frontend"];
const isGatewayHost = ["ic0.app", "icp0.io", "icp.net"].some((domain) => hostname === domain || hostname.endsWith(`.${domain}`));
const isLocalHost = hostname === "localhost" || hostname === "127.0.0.1" || hostname.endsWith(".localhost");
const derivationOrigin = frontendId && !isGatewayHost && !isLocalHost ? `https://${frontendId}.icp.net` : undefined;
export const authClient = new AuthClient({
  agentOptions: { rootKey: environment?.IC_ROOT_KEY },
  ...(derivationOrigin ? { derivationOrigin } : {}),
  ...(isLocalCallback ? { transport: "redirect" as const } : {}),
  ...(environment?.PUBLIC_II_AUTHORIZE_URL ? {
    identityProvider: {
      authorizeUrl: environment.PUBLIC_II_AUTHORIZE_URL,
      canisterId: "rdmx6-jaaaa-aaaaa-aaadq-cai",
    },
  } : {}),
});

let localSignIn: Promise<Identity> | undefined;

export async function currentIdentity(): Promise<Identity | undefined> {
  if (isLocalCallback) {
    localSignIn ??= authClient.signIn({
      returnTo: new URLSearchParams(window.location.search).get("next") ?? "/mint",
    });
    return localSignIn;
  }
  return authClient.isAuthenticated() ? authClient.getIdentity() : undefined;
}
export async function login(): Promise<Identity | undefined> {
  if (usesLocalIdentity) {
    const callback = new URL("/auth", window.location.origin);
    callback.searchParams.set("next", window.location.pathname + window.location.search + window.location.hash);
    window.location.assign(callback);
    return undefined;
  }
  return authClient.signIn();
}
export async function logout(): Promise<void> {
  await authClient.signOut();
}
