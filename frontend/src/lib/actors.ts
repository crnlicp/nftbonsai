import { Actor, HttpAgent, type Identity } from "@icp-sdk/core/agent";
import type { IDL } from "@icp-sdk/core/candid";
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

export type ArtLabPreview = {
  svg: string; tier: bigint; style: bigint; leafColor: bigint; branchCount: bigint; valid: boolean;
};

/** Canister id of the local-only art-lab preview canister, when this environment deployed it. */
export function artLabId(): string | undefined {
  try {
    return canisterEnv()["PUBLIC_CANISTER_ID:art-lab"];
  } catch {
    return undefined;
  }
}

export function artLabActor() {
  const config = canisterEnv();
  const canisterId = artLabId();
  if (!canisterId) throw new Error("The art-lab canister is only deployed to the local environment.");
  const agent = HttpAgent.createSync({ rootKey: config.IC_ROOT_KEY });
  const idlFactory: IDL.InterfaceFactory = ({ IDL }) => IDL.Service({
    preview: IDL.Func([IDL.Vec(IDL.Nat8), IDL.Nat], [IDL.Vec(IDL.Record({
      svg: IDL.Text, tier: IDL.Nat, style: IDL.Nat, leafColor: IDL.Nat, branchCount: IDL.Nat, valid: IDL.Bool,
    }))], ["query"]),
  });
  return Actor.createActor<{ preview: (nonce: Uint8Array, count: bigint) => Promise<ArtLabPreview[]> }>(idlFactory, { agent, canisterId });
}
