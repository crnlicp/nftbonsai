import type { Identity } from "@icp-sdk/core/agent";
import { createActor as createBackend } from "../bindings/backend";
import { createActor as createNft } from "../bindings/icrc7";
import { canisterEnv } from "./env";

export async function backendActor(identity?: Identity) {
  const config = canisterEnv();
  return createBackend(config["PUBLIC_CANISTER_ID:backend"]!, {
    agentOptions: { identity, rootKey: config.IC_ROOT_KEY },
  });
}

export async function icrc7Actor(identity?: Identity) {
  const config = canisterEnv();
  return createNft(config["PUBLIC_CANISTER_ID:icrc7"]!, {
    agentOptions: { identity, rootKey: config.IC_ROOT_KEY },
  });
}
