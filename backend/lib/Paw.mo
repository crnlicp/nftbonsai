import Json "mo:json";
import Text "mo:core/Text";
import Nat "mo:core/Nat";
import Float "mo:core/Float";
import Int "mo:core/Int";
import Iter "mo:core/Iter";
import Result "mo:core/Result";

module {
  public type Invoice = {
    id : Text;
    intent : Text;
    currency : Text;
    amount : Nat;
    billing : Text;
    status : Text;
    sandbox : ?Bool;
    url : ?Text;
  };
  public func field(value : Json.Json, name : Text) : ?Json.Json {
    switch (value) {
      case (#object_ entries) {
        for ((k, v) in entries.values()) { if (k == name) return ?v };
        null;
      };
      case _ null;
    };
  };
  public func text(value : Json.Json, name : Text) : ?Text {
    switch (field(value, name)) { case (?#string t) ?t; case _ null };
  };
  public func decimal(value : Json.Json, name : Text) : ?Nat {
    switch (field(value, name)) {
      case (?#number(#int n)) { if (n >= 0) ?Int.abs(n) else null };
      case (?#number(#float f)) {
        if (f < 0 or f > 700 or f != Float.floor(f)) null else ?Int.abs(f.toInt());
      };
      case (?#string s) {
        let parts = s.split(#char '.').toArray();
        if (parts.size() == 1) Nat.fromText(s)
        else if (parts.size() == 2 and parts[1].size() > 0 and parts[1].chars().all(func c = c == '0')) Nat.fromText(parts[0])
        else null;
      };
      case _ null;
    };
  };
  public func decode(value : Json.Json) : Result.Result<Invoice, Text> {
    let ?id = text(value, "order_id") else return #err("invoice missing order_id");
    if (id.size() != 24 or not id.chars().all(func c = (c >= '0' and c <= '9') or (c >= 'a' and c <= 'f'))) return #err("invalid Paw invoice ID");
    let ?intent = text(value, "extra") else return #err("invoice missing intent");
    let ?currency = text(value, "fiat_currency") else return #err("invoice missing fiat_currency");
    let ?amount = decimal(value, "initial_fiat_amount") else return #err("invalid initial_fiat_amount");
    let ?billing = text(value, "billing_type") else return #err("invoice missing billing_type");
    let ?status = text(value, "status") else return #err("invoice missing status");
    let sandbox = switch (field(value, "sandbox")) {
      case (?#bool b) ?b;
      case (null or (?#null_)) null;
      case _ return #err("invalid sandbox marker");
    };
    #ok({ id; intent; currency; amount; billing; status; sandbox; url = text(value, "payment_url") });
  };
  public func envelope(body : Text) : Result.Result<Json.Json, Text> {
    let value = switch (Json.parse(body)) { case (#ok v) v; case (#err _) return #err("invalid Paw JSON") };
    switch (field(value, "ok")) {
      case (?#bool true) {
        switch (field(value, "result")) { case (?r) #ok r; case null #err("Paw response missing result") };
      };
      case _ #err("Paw request rejected or invalid envelope");
    };
  };
  public func parse(body : Text) : Result.Result<Invoice, Text> {
    switch (envelope(body)) { case (#err e) #err e; case (#ok v) decode(v) };
  };
  public func createBody(intent : Text, amount : Nat, asset : Text, redirect : Text) : Text {
    Json.stringify(Json.obj([
      ("amount", Json.str(amount.toText() # ".00")),
      ("fiat_currency", Json.str("EUR")),
      ("billing_type", Json.str("STATIC")),
      ("asset", Json.str(asset)),
      ("accepted_coins", Json.arr([Json.str(asset)])),
      ("underpay_tolerance", Json.int(0)),
      ("permanent_address", Json.bool(false)),
      ("extra", Json.str(intent)),
      ("title", Json.str("NFT Bonsai")),
      ("on_paid_url", if (redirect == "") Json.nullable() else Json.str(redirect # "/mint")),
      ("on_cancel_url", if (redirect == "") Json.nullable() else Json.str(redirect # "/mint")),
    ]), null);
  };
  public func validUrl(url : Text) : Bool {
    url.startsWith(#text "https://pay.pawpayments.com/checkout/") and url.size() <= 500;
  };
  public func environmentMatches(invoice : Invoice, sandbox : Bool) : Bool {
    // Paw documents key-routed environments; only webhooks guarantee this marker.
    invoice.sandbox == null or invoice.sandbox == ?sandbox;
  };
  public func paid(status : Text) : Bool { status == "success" or status == "paid_over" };
  public func terminal(status : Text) : Bool {
    paid(status) or status == "failed" or status == "high_risk" or status == "cancelled" or status == "expired" or status == "refunded";
  };
  public func known(status : Text) : Bool {
    terminal(status) or status == "created" or status == "confirming" or status == "partially_paid";
  };
  public func canonical(invoice : Invoice) : Text {
    Json.stringify(Json.obj([
      ("ok", Json.bool(true)),
      ("result", Json.obj([
        ("order_id", Json.str(invoice.id)), ("extra", Json.str(invoice.intent)),
        ("fiat_currency", Json.str(invoice.currency)), ("initial_fiat_amount", Json.int(invoice.amount)),
        ("billing_type", Json.str(invoice.billing)), ("status", Json.str(invoice.status)),
        ("sandbox", switch (invoice.sandbox) { case (?b) Json.bool(b); case null Json.nullable() }),
      ])),
    ]), null);
  };
}
