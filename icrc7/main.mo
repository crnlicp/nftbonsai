import Principal "mo:core/Principal";
import Map "mo:core/Map";
import CertTree "mo:ic-certification/CertTree";
import Art "lib/Art";
import Types "types";
import Collection "mixins/Collection";

persistent actor self {
  let tokens : Map.Map<Nat, Types.NftRecord>;
  let counters : { var nextId : Nat; var blockCount : Nat; var lastBlockHash : ?Blob };
  let tokenApprovals : Map.Map<Nat, [Types.ApprovalRecord]>;
  let collectionApprovals : Map.Map<Principal, [Types.ApprovalRecord]>;
  let blocks : Map.Map<Nat, Types.Value>;
  let artwork : Map.Map<Nat, Art.Artwork>;
  let mintKeys : Map.Map<Text, Nat>;
  let mintRecipients : Map.Map<Text, { to : Principal; tier : Nat }>;
  let silhouettes : Map.Map<Blob, Blob>;
  let artworkHashes : Map.Map<Blob, Blob>;
  let certStore : CertTree.Store;

  include Collection(Principal.fromActor(self), tokens, counters, tokenApprovals,
    collectionApprovals, blocks, artwork, mintKeys, mintRecipients, silhouettes,
    artworkHashes, certStore);
  initializeCertification<system>();
}
