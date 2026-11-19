import Map "mo:core/Map";
import Set "mo:core/Set";

module {
  public type PaymentError = { #unauthorized; #forbidden; #rejected : Text };
  public func errorText(error : PaymentError) : Text {
    switch (error) {
      case (#unauthorized) "Sign in with Internet Identity";
      case (#forbidden) "Controller access required";
      case (#rejected message) message;
    };
  };
  public type Fulfillment = { #creating; #awaiting; #paid; #minting; #minted; #review; #closed };
  public type Method = { #paw; #icp; #token };
  public type MintDetails = {
    nftId : Nat;
    creator : Principal;
    price : ?{ #eur : Nat; #icp : Nat; #token : Nat };
    artTier : ?Nat;
    lucky : Bool;
    testMint : Bool;
  };
  // A Soon-launched ICRC-1/ICRC-2 token (8 decimals) accepted as payment, set by controllers after launch.
  public type Token = { ledger : Principal; market : Principal; symbol : Text };
  public type Purchase = {
    id : Text;
    tier : Nat;
    method : Method;
    sequence : Nat;
    invoiceId : ?Text;
    caller : Principal;
    amountEur : Nat;
    checkoutUrl : ?Text;
    paymentStatus : Text;
    fulfillment : Fulfillment;
    nftId : ?Nat;
    seed : ?Blob;
    createdAt : Int;
    updatedAt : Int;
    nextCheck : Int;
    attempts : Nat;
    lastError : ?Text;
    sandbox : Bool;
    // Ledger checkout (ICP or token, both 8 decimals): amount pulled via ICRC-2, its ledger block,
    // and the fixed created_at_time used for dedup on retries.
    amountE8s : ?Nat;
    ledgerBlock : ?Nat;
    payTime : ?Nat64;
    // Art tier actually minted (tier + 1 on a lucky bloom, capped at Imperial).
    artTier : ?Nat;
    lucky : Bool;
  };
  public type State = {
    purchases : Map.Map<Text, Purchase>;
    pending : Set.Set<Text>;
    var counter : Nat;
    var cursor : Nat;
    var apiKey : Text;
    var asset : Text;
    var redirect : Text;
    var sandbox : Bool;
    // Tier anchors in whole ICP / whole tokens; any whole amount between the first and last is valid.
    var icpTiers : [Nat];
    var tokenTiers : [Nat];
    var token : ?Token;
  };
  public type Account = { owner : Principal; subaccount : ?Blob };
  public type TransferFromError = {
    #BadFee : { expected_fee : Nat };
    #BadBurn : { min_burn_amount : Nat };
    #InsufficientFunds : { balance : Nat };
    #InsufficientAllowance : { allowance : Nat };
    #TooOld;
    #CreatedInFuture : { ledger_time : Nat64 };
    #Duplicate : { duplicate_of : Nat };
    #TemporarilyUnavailable;
    #GenericError : { error_code : Nat; message : Text };
  };
  public type TransferError = {
    #BadFee : { expected_fee : Nat };
    #BadBurn : { min_burn_amount : Nat };
    #InsufficientFunds : { balance : Nat };
    #TooOld;
    #CreatedInFuture : { ledger_time : Nat64 };
    #Duplicate : { duplicate_of : Nat };
    #TemporarilyUnavailable;
    #GenericError : { error_code : Nat; message : Text };
  };
  public type Ledger = actor {
    icrc2_transfer_from : ({
      spender_subaccount : ?Blob; from : Account; to : Account; amount : Nat;
      fee : ?Nat; memo : ?Blob; created_at_time : ?Nat64;
    }) -> async { #Ok : Nat; #Err : TransferFromError };
    icrc1_transfer : ({
      from_subaccount : ?Blob; to : Account; amount : Nat;
      fee : ?Nat; memo : ?Blob; created_at_time : ?Nat64;
    }) -> async { #Ok : Nat; #Err : TransferError };
  };
  public type Nft = actor {
    mintV2 : (Principal, Blob, Nat, Text) -> async { #ok : Nat; #err : PaymentError };
    getMintByKey : shared query Text -> async ?Nat;
  };
}
