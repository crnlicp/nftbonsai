import Map "mo:core/Map";
import Set "mo:core/Set";
import Text "mo:core/Text";
import Nat "mo:core/Nat";
import Option "mo:core/Option";

module {
  type Currency = { #icp; #token };
  type Reference = { icp : Nat; token : Nat };
  type Phase = { #locking; #active; #cancelling; #cancelled; #collecting; #delivering; #paying; #sold; #review };
  type Listing = {
    id : Nat; nftId : Nat; seller : Principal; currency : Currency;
    ledger : Principal; price : Nat; revision : Nat; phase : Phase;
    buyer : ?Principal; fee : Nat; appFee : Nat; proceeds : Nat;
    createdAt : Int; updatedAt : Int; payTime : ?Nat64; payoutTime : ?Nat64;
    paymentBlock : ?Nat; deliveryBlock : ?Nat; payoutBlock : ?Nat; error : ?Text;
    feeTime : ?Nat64; feeBlock : ?Nat; sweepFee : ?Nat;
    paymentUncertain : Bool;
    payoutUncertain : Bool;
  };
  type Purchase = {
    id : Text; tier : Nat; method : { #paw; #icp; #token }; sequence : Nat; invoiceId : ?Text; caller : Principal;
    amountEur : Nat; checkoutUrl : ?Text; paymentStatus : Text;
    fulfillment : { #creating; #awaiting; #paid; #minting; #minted; #review; #closed };
    nftId : ?Nat; seed : ?Blob; createdAt : Int; updatedAt : Int; nextCheck : Int;
    attempts : Nat; lastError : ?Text; sandbox : Bool; amountE8s : ?Nat;
    ledgerBlock : ?Nat; payTime : ?Nat64; artTier : ?Nat; lucky : Bool;
  };
  type Paw = {
    purchases : Map.Map<Text, Purchase>; pending : Set.Set<Text>;
    var counter : Nat; var cursor : Nat; var apiKey : Text; var asset : Text;
    var redirect : Text; var sandbox : Bool; var icpTiers : [Nat]; var tokenTiers : [Nat];
    var token : ?{ ledger : Principal; market : Principal; symbol : Text };
  };
  type OldActor = { paw : Paw };
  type NewActor = {
    paw : Paw;
    market : {
      listings : Map.Map<Nat, Listing>; current : Map.Map<Nat, Nat>;
      references : Map.Map<Text, Reference>; var nextId : Nat;
    };
  };
  public func migration(old : OldActor) : NewActor {
    let refs = Map.empty<Text, Reference>();
    let eur = [49, 99, 199, 499, 999];
    for ((id, p) in old.paw.purchases.entries()) {
      if (p.tier < 5) {
        let i = p.tier;
        let icp = old.paw.icpTiers[i];
        let token = old.paw.tokenTiers[i];
        let r = switch (p.method) {
          case (#paw) ?{ icp = p.amountEur * icp * 100_000_000 / eur[i]; token = p.amountEur * token * 100_000_000 / eur[i] };
          case (#icp) p.amountE8s.map(func amount = { icp = amount; token = amount * token / icp });
          case (#token) p.amountE8s.map(func amount = { icp = amount * icp / token; token = amount });
        };
        switch r { case (?value) refs.add(id, value); case null {} };
      };
    };
    {
      paw = old.paw;
      market = { listings = Map.empty(); current = Map.empty(); references = refs; var nextId = 1 };
    };
  };
}
