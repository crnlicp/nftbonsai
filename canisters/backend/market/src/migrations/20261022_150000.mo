import Map "mo:core/Map";
import Nat "mo:core/Nat";
import Set "mo:core/Set";

module {
  type Fulfillment = { #creating; #awaiting; #paid; #minting; #minted; #review; #closed };
  type OldPurchase = {
    id : Text; sequence : Nat; invoiceId : ?Text; caller : Principal;
    amountEur : Nat; checkoutUrl : ?Text; paymentStatus : Text;
    fulfillment : Fulfillment;
    nftId : ?Nat; seed : ?Blob; createdAt : Int; updatedAt : Int;
    nextCheck : Int; attempts : Nat; lastError : ?Text; sandbox : Bool;
  };
  type NewPurchase = {
    id : Text; tier : Nat; method : { #paw; #icp }; sequence : Nat; invoiceId : ?Text; caller : Principal;
    amountEur : Nat; checkoutUrl : ?Text; paymentStatus : Text;
    fulfillment : Fulfillment;
    nftId : ?Nat; seed : ?Blob; createdAt : Int; updatedAt : Int;
    nextCheck : Int; attempts : Nat; lastError : ?Text; sandbox : Bool;
    amountE8s : ?Nat; ledgerBlock : ?Nat; payTime : ?Nat64; artTier : ?Nat; lucky : Bool;
  };
  type OldActor = {
    paw : {
      purchases : Map.Map<Text, OldPurchase>; pending : Set.Set<Text>;
      var counter : Nat; var cursor : Nat; var apiKey : Text;
      var asset : Text; var redirect : Text; var sandbox : Bool;
    };
  };
  type NewActor = {
    paw : {
      purchases : Map.Map<Text, NewPurchase>; pending : Set.Set<Text>;
      var counter : Nat; var cursor : Nat; var apiKey : Text;
      var asset : Text; var redirect : Text; var sandbox : Bool;
      var icpPrices : [Nat];
    };
  };

  // Purchases gain a named tier (derived from the old EUR band), a payment method and ICP checkout fields.
  public func migration(old : OldActor) : NewActor {
    let o = old.paw;
    {
      paw = {
        purchases = o.purchases.map(func(_ : Text, p : OldPurchase) : NewPurchase {
          let a = if (p.amountEur < 10) 10 else if (p.amountEur > 700) 700 else p.amountEur;
          let tier = Nat.min(4, ((a - 10) * 5) / 691);
          { p with tier; method = #paw; amountE8s = null; ledgerBlock = null; payTime = null; artTier = ?tier; lucky = false };
        });
        pending = o.pending;
        var counter = o.counter; var cursor = o.cursor; var apiKey = o.apiKey;
        var asset = o.asset; var redirect = o.redirect; var sandbox = o.sandbox;
        var icpPrices = [300_000_000, 900_000_000, 2_400_000_000, 6_000_000_000, 15_000_000_000];
      };
    };
  };
}
