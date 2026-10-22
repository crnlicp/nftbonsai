import Map "mo:core/Map";
import Set "mo:core/Set";

module {
  type Purchase = {
    id : Text; sequence : Nat; invoiceId : ?Text; caller : Principal;
    amountEur : Nat; checkoutUrl : ?Text; paymentStatus : Text;
    fulfillment : { #creating; #awaiting; #paid; #minting; #minted; #review; #closed };
    nftId : ?Nat; seed : ?Blob; createdAt : Int; updatedAt : Int;
    nextCheck : Int; attempts : Nat; lastError : ?Text; sandbox : Bool;
  };
  type OldActor = {};
  type NewActor = {
    paw : {
      purchases : Map.Map<Text, Purchase>; pending : Set.Set<Text>;
      var counter : Nat; var cursor : Nat; var apiKey : Text;
      var asset : Text; var redirect : Text; var sandbox : Bool;
    };
  };
  public func migration(_old : OldActor) : NewActor {
    {
      paw = {
        purchases = Map.empty(); pending = Set.empty();
        var counter = 0; var cursor = 0; var apiKey = "";
        var asset = "usdc_eth"; var redirect = ""; var sandbox = false;
      };
    };
  };
}
