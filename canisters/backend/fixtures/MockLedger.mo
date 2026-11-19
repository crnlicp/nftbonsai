// Minimal ICRC-1/ICRC-2 ledger for PocketIC tests.
import Map "mo:core/Map";
import Principal "mo:core/Principal";
import Text "mo:core/Text";
import Nat "mo:core/Nat";
import Nat64 "mo:core/Nat64";
import Blob "mo:core/Blob";
import Runtime "mo:core/Runtime";
import Array "mo:core/Array";
import Time "mo:core/Time";
import Int "mo:core/Int";

persistent actor {
  type Account = { owner : Principal; subaccount : ?Blob };
  type Mode = { #normal; #unavailable; #trap };
  let FEE = 10_000;
  let balances = Map.empty<Text, Nat>();
  let allowances = Map.empty<Text, Nat>();
  let seen = Map.empty<Text, Nat>();
  var block = 0;
  var mode : Mode = #normal;
  var payoutMode : Mode = #normal;
  var currentFee = FEE;

  func accountKey(a : Account) : Text {
    let suffix = switch (a.subaccount) {
      case null "";
      case (?b) if (b.toArray().all(func byte = byte == 0)) "" else debug_show b;
    };
    a.owner.toText() # "/" # suffix;
  };
  func accountBalance(a : Account) : Nat = balances.get(accountKey(a)) ?? 0;
  func balance(p : Principal) : Nat = accountBalance({ owner = p; subaccount = null });
  func setBalance(a : Account, amount : Nat) { balances.add(accountKey(a), amount) };
  func key(from : Principal, spender : Principal) : Text = from.toText() # "/" # spender.toText();
  func next() : Nat { block += 1; block };
  func tooOld(stamp : ?Nat64) : Bool {
    switch stamp { case (?t) Int.abs(Time.now()) > t.toNat() + 86_400_000_000_000; case null false };
  };

  public func mint(to : Principal, amount : Nat) : async () { setBalance({ owner = to; subaccount = null }, balance(to) + amount) };
  public func setMode(m : Mode) : async () { mode := m };
  public func setPayoutMode(m : Mode) : async () { payoutMode := m };
  public func setFee(fee : Nat) : async () { currentFee := fee };

  public query func icrc1_balance_of(a : Account) : async Nat { accountBalance(a) };
  public query func icrc1_fee() : async Nat { currentFee };

  public shared ({ caller }) func icrc2_approve(args : {
    spender : Account; amount : Nat; from_subaccount : ?Blob; expected_allowance : ?Nat;
    expires_at : ?Nat64; fee : ?Nat; memo : ?Blob; created_at_time : ?Nat64;
  }) : async { #Ok : Nat; #Err : { #InsufficientFunds : { balance : Nat }; #GenericError : { error_code : Nat; message : Text } } } {
    if (balance(caller) < currentFee) return #Err(#InsufficientFunds { balance = balance(caller) });
    setBalance({ owner = caller; subaccount = args.from_subaccount }, balance(caller) - currentFee);
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
    if (tooOld(args.created_at_time)) return #Err(#TooOld);
    let dedup = "pull|" # accountKey(args.from) # "|" # debug_show (args.to, args.memo, args.created_at_time, args.amount, args.fee);
    switch (seen.get(dedup)) { case (?b) return #Err(#Duplicate { duplicate_of = b }); case null {} };
    if (args.fee != null and args.fee != ?currentFee) return #Err(#BadFee { expected_fee = currentFee });
    let k = key(args.from.owner, caller);
    let allowance = allowances.get(k) ?? 0;
    if (allowance < args.amount + currentFee) return #Err(#InsufficientAllowance { allowance });
    let from = accountBalance(args.from);
    if (from < args.amount + currentFee) return #Err(#InsufficientFunds { balance = from });
    allowances.add(k, allowance - args.amount - currentFee);
    setBalance(args.from, from - args.amount - currentFee);
    setBalance(args.to, accountBalance(args.to) + args.amount);
    let b = next();
    seen.add(dedup, b);
    #Ok b;
  };

  public shared ({ caller }) func icrc1_transfer(args : {
    from_subaccount : ?Blob; to : Account; amount : Nat;
    fee : ?Nat; memo : ?Blob; created_at_time : ?Nat64;
  }) : async { #Ok : Nat; #Err : TransferFromError } {
    switch payoutMode { case (#trap) Runtime.trap("payout down"); case (#unavailable) return #Err(#TemporarilyUnavailable); case (#normal) {} };
    if (tooOld(args.created_at_time)) return #Err(#TooOld);
    let source = { owner = caller; subaccount = args.from_subaccount };
    let dedup = "send|" # accountKey(source) # "|" # debug_show (args.to, args.memo, args.created_at_time, args.amount, args.fee);
    switch (seen.get(dedup)) { case (?b) return #Err(#Duplicate { duplicate_of = b }); case null {} };
    if (args.fee != null and args.fee != ?currentFee) return #Err(#BadFee { expected_fee = currentFee });
    let from = accountBalance(source);
    if (from < args.amount + currentFee) return #Err(#InsufficientFunds { balance = from });
    setBalance(source, from - args.amount - currentFee);
    setBalance(args.to, accountBalance(args.to) + args.amount);
    let b = next();
    seen.add(dedup, b);
    #Ok(b);
  };
};
