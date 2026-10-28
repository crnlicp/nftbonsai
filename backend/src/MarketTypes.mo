import Map "mo:core/Map";

module {
  public type Currency = { #icp; #token };
  public type Reference = { icp : Nat; token : Nat };
  public type Phase = { #locking; #active; #cancelling; #cancelled; #collecting; #delivering; #paying; #sold; #review };
  public type Listing = {
    id : Nat; nftId : Nat; seller : Principal; currency : Currency;
    ledger : Principal; price : Nat; revision : Nat; phase : Phase;
    buyer : ?Principal; fee : Nat; appFee : Nat; proceeds : Nat;
    createdAt : Int; updatedAt : Int; payTime : ?Nat64; payoutTime : ?Nat64;
    paymentBlock : ?Nat; deliveryBlock : ?Nat; payoutBlock : ?Nat;
    feeTime : ?Nat64; feeBlock : ?Nat; sweepFee : ?Nat;
    paymentUncertain : Bool;
    payoutUncertain : Bool;
    error : ?Text;
  };
  public type State = {
    listings : Map.Map<Nat, Listing>;
    current : Map.Map<Nat, Nat>;
    references : Map.Map<Text, Reference>;
    var nextId : Nat;
  };
  public type Quote = { listing : Listing; approvalFee : Nat; paymentFee : Nat; payoutFee : Nat; totalDebit : Nat; sellerReceives : Nat };
  public type Nft = actor {
    getNft : shared query Nat -> async ?{ id : Nat; owner : Principal; paymentId : Text };
    lockForSale : (Nat, Principal, Nat) -> async { #ok; #err : Text };
    unlockSale : (Nat, Nat) -> async { #ok; #err : Text };
    deliverSale : (Nat, Nat, Principal) -> async { #ok : Nat; #err : Text };
  };
}
