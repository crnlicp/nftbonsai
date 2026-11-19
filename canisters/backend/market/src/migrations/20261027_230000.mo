import Map "mo:core/Map";
import Set "mo:core/Set";

module {
  type Fulfillment = { #creating; #awaiting; #paid; #minting; #minted; #review; #closed };
  type OldPurchase = {
    id : Text; tier : Nat; method : { #paw; #icp }; sequence : Nat; invoiceId : ?Text; caller : Principal;
    amountEur : Nat; checkoutUrl : ?Text; paymentStatus : Text;
    fulfillment : Fulfillment;
    nftId : ?Nat; seed : ?Blob; createdAt : Int; updatedAt : Int;
    nextCheck : Int; attempts : Nat; lastError : ?Text; sandbox : Bool;
    amountE8s : ?Nat; ledgerBlock : ?Nat; payTime : ?Nat64; artTier : ?Nat; lucky : Bool;
  };
  type NewPurchase = {
    id : Text; tier : Nat; method : { #paw; #icp; #token }; sequence : Nat; invoiceId : ?Text; caller : Principal;
    amountEur : Nat; checkoutUrl : ?Text; paymentStatus : Text;
    fulfillment : Fulfillment;
    nftId : ?Nat; seed : ?Blob; createdAt : Int; updatedAt : Int;
    nextCheck : Int; attempts : Nat; lastError : ?Text; sandbox : Bool;
    amountE8s : ?Nat; ledgerBlock : ?Nat; payTime : ?Nat64; artTier : ?Nat; lucky : Bool;
  };
  type Token = { ledger : Principal; market : Principal; symbol : Text };
  type OldActor = {
    paw : {
      purchases : Map.Map<Text, OldPurchase>; pending : Set.Set<Text>;
      var counter : Nat; var cursor : Nat; var apiKey : Text;
      var asset : Text; var redirect : Text; var sandbox : Bool;
      var e8sPerEur : Nat;
    };
  };
  type NewActor = {
    paw : {
      purchases : Map.Map<Text, NewPurchase>; pending : Set.Set<Text>;
      var counter : Nat; var cursor : Nat; var apiKey : Text;
      var asset : Text; var redirect : Text; var sandbox : Bool;
      var icpTiers : [Nat]; var tokenTiers : [Nat]; var token : ?Token;
    };
  };

  // ICP is now priced in fixed whole-ICP tiers (no EUR rate), and a Soon-launched token becomes a third method.
  public func migration(old : OldActor) : NewActor {
    let o = old.paw;
    {
      paw = {
        purchases = o.purchases.map(func(_ : Text, p : OldPurchase) : NewPurchase = p);
        pending = o.pending;
        var counter = o.counter; var cursor = o.cursor; var apiKey = o.apiKey;
        var asset = o.asset; var redirect = o.redirect; var sandbox = o.sandbox;
        var icpTiers = [9, 19, 49, 99, 249];
        var tokenTiers = [9_000, 19_000, 49_000, 99_000, 249_000];
        var token = null;
      };
    };
  };
}
