// Minimal ICRC-1/ICRC-2 ledger for PocketIC tests (default subaccounts only, 10_000 e8s fee).
import Map "mo:core/Map";
import Principal "mo:core/Principal";
import Text "mo:core/Text";
import Nat "mo:core/Nat";
import Nat64 "mo:core/Nat64";
import Blob "mo:core/Blob";
import Runtime "mo:core/Runtime";

persistent actor {
  type Account = { owner : Principal; subaccount : ?Blob };
  type Mode = { #normal; #unavailable; #trap };
  let FEE = 10_000;
  let balances = Map.empty<Principal, Nat>();
  let allowances = Map.empty<Text, Nat>();
  let seen = Map.empty<Text, Nat>();
  var block = 0;
  var mode : Mode = #normal;

  func balance(p : Principal) : Nat = balances.get(p) ?? 0;
  func key(from : Principal, spender : Principal) : Text = from.toText() # "/" # spender.toText();
  func next() : Nat { block += 1; block };

  public func mint(to : Principal, amount : Nat) : async () { balances.add(to, balance(to) + amount) };
  public func setMode(m : Mode) : async () { mode := m };

  public query func icrc1_balance_of(a : Account) : async Nat { balance(a.owner) };
  public query func icrc1_fee() : async Nat { FEE };

  public shared ({ caller }) func icrc2_approve(args : {
    spender : Account; amount : Nat; from_subaccount : ?Blob; expected_allowance : ?Nat;
    expires_at : ?Nat64; fee : ?Nat; memo : ?Blob; created_at_time : ?Nat64;
  }) : async { #Ok : Nat; #Err : { #InsufficientFunds : { balance : Nat }; #GenericError : { error_code : Nat; message : Text } } } {
    if (balance(caller) < FEE) return #Err(#InsufficientFunds { balance = balance(caller) });
    balances.add(caller, balance(caller) - FEE);
    allowances.add(key(caller, args.spender.owner), args.amount);
    #Ok(next());
  };

  type TransferFromError = {
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

  public shared ({ caller }) func icrc2_transfer_from(args : {
    spender_subaccount : ?Blob; from : Account; to : Account; amount : Nat;
    fee : ?Nat; memo : ?Blob; created_at_time : ?Nat64;
  }) : async { #Ok : Nat; #Err : TransferFromError } {
    switch mode { case (#trap) Runtime.trap("ledger down"); case (#unavailable) return #Err(#TemporarilyUnavailable); case (#normal) {} };
    let dedup = args.from.owner.toText() # "|" # debug_show (args.memo, args.created_at_time, args.amount);
    switch (seen.get(dedup)) { case (?b) return #Err(#Duplicate { duplicate_of = b }); case null {} };
    let k = key(args.from.owner, caller);
    let allowance = allowances.get(k) ?? 0;
    if (allowance < args.amount + FEE) return #Err(#InsufficientAllowance { allowance });
    let from = balance(args.from.owner);
    if (from < args.amount + FEE) return #Err(#InsufficientFunds { balance = from });
    allowances.add(k, allowance - args.amount - FEE);
    balances.add(args.from.owner, from - args.amount - FEE);
    balances.add(args.to.owner, balance(args.to.owner) + args.amount);
    let b = next();
    seen.add(dedup, b);
    #Ok b;
  };

  public shared ({ caller }) func icrc1_transfer(args : {
    from_subaccount : ?Blob; to : Account; amount : Nat;
    fee : ?Nat; memo : ?Blob; created_at_time : ?Nat64;
  }) : async { #Ok : Nat; #Err : { #InsufficientFunds : { balance : Nat }; #GenericError : { error_code : Nat; message : Text } } } {
    let from = balance(caller);
    if (from < args.amount + FEE) return #Err(#InsufficientFunds { balance = from });
    balances.add(caller, from - args.amount - FEE);
    balances.add(args.to.owner, balance(args.to.owner) + args.amount);
    #Ok(next());
  };
};
