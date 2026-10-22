import Map "mo:core/Map";
import Set "mo:core/Set";

module {
  type Fulfillment = { #creating; #awaiting; #paid; #minting; #minted; #review; #closed };
  type Purchase = {
    id : Text; tier : Nat; method : { #paw; #icp }; sequence : Nat; invoiceId : ?Text; caller : Principal;
    amountEur : Nat; checkoutUrl : ?Text; paymentStatus : Text;
    fulfillment : Fulfillment;
    nftId : ?Nat; seed : ?Blob; createdAt : Int; updatedAt : Int;
    nextCheck : Int; attempts : Nat; lastError : ?Text; sandbox : Bool;
    amountE8s : ?Nat; ledgerBlock : ?Nat; payTime : ?Nat64; artTier : ?Nat; lucky : Bool;
  };
  type OldActor = {
    paw : {
      purchases : Map.Map<Text, Purchase>; pending : Set.Set<Text>;
      var counter : Nat; var cursor : Nat; var apiKey : Text;
      var asset : Text; var redirect : Text; var sandbox : Bool;
      var icpPrices : [Nat];
    };
  };
  type NewActor = {
    paw : {
      purchases : Map.Map<Text, Purchase>; pending : Set.Set<Text>;
      var counter : Nat; var cursor : Nat; var apiKey : Text;
      var asset : Text; var redirect : Text; var sandbox : Bool;
      var e8sPerEur : Nat;
    };
  };

  // Fixed per-tier ICP prices become one EUR→ICP rate, because any euro price in range is now valid.
  // Starting rate: 1 ICP ≈ €2.44 (October 2026), i.e. ≈0.41 ICP per euro.
  public func migration(old : OldActor) : NewActor {
    let o = old.paw;
    {
      paw = {
        purchases = o.purchases; pending = o.pending;
        var counter = o.counter; var cursor = o.cursor; var apiKey = o.apiKey;
        var asset = o.asset; var redirect = o.redirect; var sandbox = o.sandbox;
        var e8sPerEur = 40_983_606;
      };
    };
  };
}
