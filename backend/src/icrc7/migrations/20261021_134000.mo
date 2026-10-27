import Map "mo:core/Map";
import CertTree "mo:ic-certification/CertTree";

module {
  type Traits = {
    trunkStyle : Nat8; branchCount : Nat8; leafColor : Nat8; leafDensity : Nat8;
    potStyle : Nat8; potColor : Nat8; ground : Nat8; season : Nat8; sky : Nat8;
    moonPhase : Nat8; specialElem : Nat8; trunkThick : Nat8; trunkColor : Nat8;
  };
  type Account = { owner : Principal; subaccount : ?Blob };
  type Approval = { spender : Account; expiresAt : ?Nat64; createdAt : Nat64 };
  type Token = {
    id : Nat; var owner : Principal; traits : Traits; createdAt : Int; paymentId : Text;
  };
  type Value = {
    #Nat : Nat; #Int : Int; #Text : Text; #Blob : Blob;
    #Array : [Value]; #Map : [(Text, Value)];
  };
  type Point = { x : Int; y : Int };
  type Artwork = {
    version : Nat; seed : Blob; attempt : Nat; traits : Traits;
    skeleton : [{ start : Point; end : Point; width : Int }];
    pads : [{ center : Point; rx : Int; ry : Int }];
    pixels : Blob; silhouette : Blob; pixelHash : Blob; silhouetteHash : Blob; svg : Text;
  };
  type OldActor = {};
  type NewActor = {
    tokens : Map.Map<Nat, Token>;
    counters : { var nextId : Nat; var blockCount : Nat; var lastBlockHash : ?Blob };
    tokenApprovals : Map.Map<Nat, [Approval]>;
    collectionApprovals : Map.Map<Principal, [Approval]>;
    blocks : Map.Map<Nat, Value>; artwork : Map.Map<Nat, Artwork>;
    mintKeys : Map.Map<Text, Nat>;
    mintRecipients : Map.Map<Text, { to : Principal; amount : Nat }>;
    silhouettes : Map.Map<Blob, Blob>; artworkHashes : Map.Map<Blob, Blob>;
    certStore : CertTree.Store;
  };
  public func migration(_old : OldActor) : NewActor {
    {
      tokens = Map.empty();
      counters = { var nextId = 0; var blockCount = 0; var lastBlockHash = null };
      tokenApprovals = Map.empty(); collectionApprovals = Map.empty();
      blocks = Map.empty(); artwork = Map.empty(); mintKeys = Map.empty();
      mintRecipients = Map.empty(); silhouettes = Map.empty(); artworkHashes = Map.empty();
      certStore = CertTree.newStore();
    };
  };
}
