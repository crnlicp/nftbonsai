import Array "mo:core/Array";
import Blob "mo:core/Blob";
import Debug "mo:core/Debug";
import Error "mo:core/Error";
import Int "mo:core/Int";
import Iter "mo:core/Iter";
import Map "mo:core/Map";
import Nat "mo:core/Nat";
import Option "mo:core/Option";
import Principal "mo:core/Principal";
import Random "mo:core/Random";
import Result "mo:core/Result";
import Runtime "mo:core/Runtime";
import Set "mo:core/Set";
import Text "mo:core/Text";
import Time "mo:core/Time";
import Timer "mo:core/Timer";
import IC "mo:ic/Types";
import Call "mo:ic/Call";
import Json "mo:json";
import Types "../PaymentTypes";
import Paw "../lib/Paw";
import Tiers "../lib/Tiers";


mixin (state : Types.State, mock : Bool, self : Principal) {
  transient let locks = Set.empty<Text>();
  transient var polling = false;
  transient var pollTimer : ?Timer.TimerId = null;

  // Poll Paw only while purchases are pending, so an idle backend spends no cycles on timer executions.
  func ensurePolling<system>() {
    if (pollTimer == null and not state.pending.isEmpty()) {
      pollTimer := ?Timer.recurringTimer<system>(#seconds 30, pollPurchases);
    };
  };

  func nft<system>() : Types.Nft {
    let id = Runtime.envVar<system>("PUBLIC_CANISTER_ID:icrc7") ?? Runtime.trap("Missing NFT canister ID");
    actor(id);
  };

  func icpLedger<system>() : Types.Ledger {
    actor(Runtime.envVar<system>("ICP_LEDGER_ID") ?? "ryjl3-tyaaa-aaaaa-aaaba-cai");
  };

  // Ledger that collects a purchase: ICP, or the configured token. Null when the token was never configured.
  func ledgerFor<system>(method : Types.Method) : ?Types.Ledger {
    switch (method) {
      case (#token) state.token.map<Types.Token, Types.Ledger>(func t = actor(t.ledger.toText()));
      case _ ?icpLedger<system>();
    };
  };

  func unitName(method : Types.Method) : Text {
    switch (method) {
      case (#token) switch (state.token) { case (?t) t.symbol; case null "token" };
      case _ "ICP";
    };
  };

  func rangeText(anchors : [Nat], unit : Text) : Text {
    "Choose a price from " # anchors[0].toText() # " to " # anchors[anchors.size() - 1].toText() # " " # unit;
  };

  // Shared admission checks for all payment methods; amounts are validated by each entry point.
  func admit(caller : Principal) : ?Types.PaymentError {
    if (caller.isAnonymous()) return ?#unauthorized;
    if (state.pending.size() >= 200) return ?#rejected("Checkout capacity reached; try again later");
    var count = 0;
    var pending = 0;
    for ((_, p) in state.purchases.entries()) {
      if (p.caller == caller) {
        count += 1;
        if (Time.now() - p.createdAt < 60_000_000_000) return ?#rejected("Please wait one minute before creating another purchase");
        if (state.pending.contains(p.id)) pending += 1;
      };
    };
    if (pending >= 3 or count >= 1000) return ?#rejected("Purchase limit reached; resolve existing purchases first");
    null;
  };

  func newPurchase(caller : Principal, amountEur : Nat, tier : Nat, method : Types.Method) : Types.Purchase {
    state.counter += 1;
    let now = Time.now();
    {
      id = "bonsai-" # state.counter.toText(); tier; method; sequence = state.counter; invoiceId = null; caller;
      amountEur; checkoutUrl = null; paymentStatus = "creating"; fulfillment = #creating;
      nftId = null; seed = null; createdAt = now; updatedAt = now;
      nextCheck = now + 10_000_000_000; attempts = 0; lastError = null; sandbox = state.sandbox;
      amountE8s = null; ledgerBlock = null; payTime = null; artTier = null; lucky = false;
    };
  };

  func auth(caller : Principal) {
    if (caller.isAnonymous()) Runtime.trap("Sign in with Internet Identity");
  };
  func admin(caller : Principal) {
    auth(caller);
    if (not caller.isController()) Runtime.trap("Controller only");
  };
  func save(p : Types.Purchase) {
    state.purchases.add(p.id, p);
  };
  func problem(id : Text, message : Text) {
    let ?p = state.purchases.get(id) else return;
    let tries = Nat.min(p.attempts + 1, 10);
    save({ p with
      updatedAt = Time.now(); attempts = tries; lastError = ?message;
      nextCheck = Time.now() + (30 * (2 ** tries) : Nat) * 1_000_000_000;
    });
    Debug.print("purchase " # id # ": " # message);
  };

  public shared ({ caller }) func configurePaw(key : Text, usdcAsset : Text, redirect : Text, sandbox : Bool) : async Result.Result<(), Types.PaymentError> {
    if (caller.isAnonymous()) return #err(#unauthorized);
    if (not caller.isController()) return #err(#forbidden);
    if (key.size() == 0 or key.size() > 512) return #err(#rejected("Invalid API key length"));
    if (sandbox != key.startsWith(#text "sk_sandbox_")) return #err(#rejected("Key does not match sandbox/live mode"));
    if (not usdcAsset.startsWith(#text "usdc_") or usdcAsset.size() > 40) return #err(#rejected("Select a supported USDC asset from Paw's catalog"));
    if (redirect != "" and (not redirect.startsWith(#text "https://") or redirect.endsWith(#text "/"))) return #err(#rejected("Redirect must be an HTTPS origin without a trailing slash"));
    if (state.pending.size() > 0 and state.sandbox != sandbox) return #err(#rejected("Reconcile pending purchases before changing environment"));
    state.apiKey := key;
    state.asset := usdcAsset;
    state.redirect := redirect;
    state.sandbox := sandbox;
    #ok();
  };

  public query func paymentInfo() : async {
    mock : Bool; sandbox : Bool; configured : Bool; asset : Text; pending : Nat;
  } {
    { mock; sandbox = state.sandbox; configured = state.apiKey != ""; asset = state.asset; pending = state.pending.size() };
  };

  public query func pricing() : async {
    tiers : [{ name : Text; eur : Nat; icp : Nat; token : Nat }];
    minEur : Nat; maxEur : Nat; minIcp : Nat; maxIcp : Nat; minToken : Nat; maxToken : Nat;
    token : ?Types.Token;
  } {
    let last = Tiers.COUNT - 1 : Nat;
    {
      tiers = Array.tabulate(Tiers.COUNT, func i = {
        name = Tiers.NAMES[i]; eur = Tiers.EUR[i]; icp = state.icpTiers[i]; token = state.tokenTiers[i];
      });
      minEur = Tiers.MIN_EUR; maxEur = Tiers.MAX_EUR;
      minIcp = state.icpTiers[0]; maxIcp = state.icpTiers[last];
      minToken = state.tokenTiers[0]; maxToken = state.tokenTiers[last];
      token = state.token;
    };
  };

  // Public, free: how $BONSAI is being used to mint (collected = pulled from buyers).
  public query func tokenStats() : async { mints : Nat; collectedE8s : Nat; buyers : Nat } {
    let buyers = Set.empty<Principal>();
    var mints = 0;
    var collected = 0;
    for (p in state.purchases.values()) {
      if (p.method == #token and p.ledgerBlock != null) {
        collected += p.amountE8s ?? 0;
        buyers.add(p.caller);
        if (p.nftId != null) mints += 1;
      };
    };
    { mints; collectedE8s = collected; buyers = buyers.size() };
  };

  func pendingTokenPurchases() : Bool {
    for (id in state.pending.values()) {
      switch (state.purchases.get(id)) { case (?p) if (p.method == #token) return true; case null {} };
    };
    false;
  };

  // Enables token payments once the token is launched (e.g. on Soon). The ledger must be ICRC-1/ICRC-2 with 8 decimals.
  public shared ({ caller }) func setToken(token : ?Types.Token) : async Result.Result<(), Types.PaymentError> {
    if (caller.isAnonymous()) return #err(#unauthorized);
    if (not caller.isController()) return #err(#forbidden);
    if (pendingTokenPurchases()) return #err(#rejected("Reconcile pending token purchases before changing the token"));
    switch (token) {
      case (?t) if (t.symbol.size() == 0 or t.symbol.size() > 12) return #err(#rejected("Symbol must be 1-12 characters"));
      case null {};
    };
    state.token := token;
    #ok();
  };

  // Anchors are whole ICP or whole tokens, five strictly ascending values.
  public shared ({ caller }) func setTierPrices(method : Types.Method, anchors : [Nat]) : async Result.Result<(), Types.PaymentError> {
    if (caller.isAnonymous()) return #err(#unauthorized);
    if (not caller.isController()) return #err(#forbidden);
    if (not Tiers.validAnchors(anchors)) return #err(#rejected("Provide 5 ascending whole-unit prices between 1 and " # Tiers.MAX_ANCHOR.toText()));
    switch (method) {
      case (#icp) state.icpTiers := anchors;
      case (#token) state.tokenTiers := anchors;
      case (#paw) return #err(#rejected("Card tiers are fixed in euro"));
    };
    #ok();
  };

  func withdraw<system>(caller : Principal, method : Types.Method, to : Types.Account, amount : Nat) : async Result.Result<Nat, Types.PaymentError> {
    if (caller.isAnonymous()) return #err(#unauthorized);
    if (not caller.isController()) return #err(#forbidden);
    if (amount == 0) return #err(#rejected("Amount must be positive"));
    let ?ledger = ledgerFor<system>(method) else return #err(#rejected("Token is not configured"));
    try {
      switch (await ledger.icrc1_transfer({
        from_subaccount = null; to; amount; fee = null; memo = null;
        created_at_time = ?Int.abs(Time.now()).toNat64();
      })) {
        case (#Ok block) #ok block;
        case (#Err e) #err(#rejected("Ledger rejected transfer: " # debug_show e));
      };
    } catch (_) { #err(#rejected("Ledger call failed; check the balance before retrying")) };
  };

  // Move proceeds out of the backend's default account (amounts in e8s; the ledger fee is charged on top).
  public shared ({ caller }) func withdrawIcp(to : Types.Account, amount : Nat) : async Result.Result<Nat, Types.PaymentError> {
    await withdraw<system>(caller, #icp, to, amount);
  };
  public shared ({ caller }) func withdrawToken(to : Types.Account, amount : Nat) : async Result.Result<Nat, Types.PaymentError> {
    await withdraw<system>(caller, #token, to, amount);
  };

  func request(path : Text, body : ?Text, replicate : Bool) : async Result.Result<Text, Text> {
    if (state.apiKey == "") return #err("Paw API key not configured");
    try {
      let response = await Call.httpRequest({
        url = "https://api.pawpayments.com/api/v2/" # path;
        method = if (body == null) #get else #post;
        max_response_bytes = ?64_000;
        headers = [
          { name = "Content-Type"; value = "application/json" },
          { name = "Accept"; value = "application/json" },
          { name = "x-api-key"; value = state.apiKey },
        ];
        body = body.map(Text.encodeUtf8);
        is_replicated = ?replicate;
        transform = if (replicate and path.startsWith(#text "invoices/")) ?{ function = transformPawStatus; context = "" } else null;
      });
      if (response.status < 200 or response.status >= 300) return #err("Paw HTTP " # response.status.toText());
      switch (response.body.decodeUtf8()) {
        case (?text) #ok(text);
        case null #err("Paw returned non-UTF8 data");
      };
    } catch (_) {
      // Never log the upstream request or error body: checkout credentials and keys are sensitive.
      #err("Paw outcall failed; outcome may be unknown. Reconciliation is required.");
    };
  };

  public shared query func transformPawStatus(args : { context : Blob; response : IC.HttpRequestResult }) : async IC.HttpRequestResult {
    let r = args.response;
    if (r.status < 200 or r.status >= 300) return { r with headers = []; body = "" };
    let body = switch (r.body.decodeUtf8()) { case (?t) t; case null "" };
    switch (Paw.parse(body)) {
      case (#ok invoice) { { status = r.status; headers = []; body = Paw.canonical(invoice).encodeUtf8() } };
      case (#err _) { { status = 502; headers = []; body = "" } };
    };
  };

  public shared ({ caller }) func createPurchase(eur : Nat) : async Result.Result<Types.Purchase, Types.PaymentError> {
    switch (admit(caller)) { case (?e) return #err e; case null {} };
    if (not Tiers.valid(eur)) return #err(#rejected("Choose a price from €" # Tiers.MIN_EUR.toText() # " to €" # Tiers.MAX_EUR.toText()));
    if (not mock and state.apiKey == "") return #err(#rejected("Paw checkout is not configured"));
    let p = newPurchase(caller, eur, Tiers.tierOf(eur), #paw);
    let id = p.id;
    let amountEur = p.amountEur;
    save(p);
    state.pending.add(id);
    ensurePolling<system>();
    locks.add(id);
    try {
      if (mock) {
        let ready = { p with invoiceId = ?("mock-" # id); paymentStatus = "created"; fulfillment = #awaiting };
        save(ready);
        return #ok ready;
      };
      let body = Paw.createBody(id, amountEur, state.asset, state.redirect);
      let result = switch (await request("invoices", ?body, false)) {
        case (#ok body) Paw.parse(body);
        case (#err e) #err e;
      };
      switch (result) {
        case (#err e) {
          save({ p with fulfillment = #review; lastError = ?e; updatedAt = Time.now() });
          problem(id, "Invoice creation needs reconciliation; do not pay another invoice");
          #err(#rejected("Creation outcome needs reconciliation. Your purchase is saved; refresh its status."));
        };
        case (#ok invoice) {
          if (invoice.intent != id or invoice.currency != "EUR" or invoice.amount != amountEur or invoice.billing != "STATIC" or not Paw.environmentMatches(invoice, p.sandbox)) {
            save({ p with fulfillment = #review; invoiceId = ?invoice.id; lastError = ?"Paw invoice does not match purchase" });
            return #err(#rejected("Invoice mismatch; contact support"));
          };
          let url = invoice.url;
          let valid = switch (url) { case (?u) Paw.validUrl(u); case null false };
          let ready = { p with
            invoiceId = ?invoice.id;
            checkoutUrl = if (valid) url else null;
            paymentStatus = invoice.status; fulfillment = #awaiting; updatedAt = Time.now();
            lastError = if (valid) null else ?"Paw did not return a valid checkout link; contact support";
          };
          save(ready);
          #ok ready;
        };
      };
    } finally { ignore locks.delete(id) };
  };

  // Whole ICP from the ICP tier range. The buyer approves exactly amount + fee, so there is no quote to drift.
  public shared ({ caller }) func buyWithIcp(icp : Nat) : async Result.Result<Types.Purchase, Types.PaymentError> {
    if (not Tiers.inRange(icp, state.icpTiers)) return #err(#rejected(rangeText(state.icpTiers, "ICP")));
    await buyWithLedger(caller, #icp, icp, Tiers.tierIn(icp, state.icpTiers));
  };

  // Whole tokens from the token tier range; token payments get double lucky-bloom odds.
  public shared ({ caller }) func buyWithToken(tokens : Nat) : async Result.Result<Types.Purchase, Types.PaymentError> {
    let ?token = state.token else return #err(#rejected("Token payments are not enabled yet"));
    if (not Tiers.inRange(tokens, state.tokenTiers)) return #err(#rejected(rangeText(state.tokenTiers, token.symbol)));
    await buyWithLedger(caller, #token, tokens, Tiers.tierIn(tokens, state.tokenTiers));
  };

  func buyWithLedger(caller : Principal, method : Types.Method, units : Nat, tier : Nat) : async Result.Result<Types.Purchase, Types.PaymentError> {
    switch (admit(caller)) { case (?e) return #err e; case null {} };
    let base = newPurchase(caller, 0, tier, method);
    let p = { base with
      amountE8s = ?(units * Tiers.UNIT); payTime = ?Int.abs(Time.now()).toNat64();
      paymentStatus = "ledger_pending"; fulfillment = #awaiting;
    };
    save(p);
    state.pending.add(p.id);
    ensurePolling<system>();
    locks.add(p.id);
    try {
      await collect(p.id);
      let ?latest = state.purchases.get(p.id) else Runtime.trap("Missing purchase");
      if (latest.fulfillment == #paid) await fulfill(p.id);
    } finally { ignore locks.delete(p.id) };
    let ?final = state.purchases.get(p.id) else Runtime.trap("Missing purchase");
    if (final.fulfillment == #closed) return #err(#rejected(final.lastError ?? (unitName(method) # " payment failed")));
    #ok final;
  };

  // Pulls the approved ICP or tokens. Retries reuse the stored created_at_time and memo, so the ledger dedups them:
  // a Duplicate reply proves the first attempt was applied.
  func collect(id : Text) : async () {
    let ?p = state.purchases.get(id) else return;
    let unit = unitName(p.method);
    let (?amount, ?time) = (p.amountE8s, p.payTime) else { problem(id, unit # " purchase is missing its price"); return };
    let ?ledger = ledgerFor<system>(p.method) else { problem(id, "Token ledger is not configured"); return };
    let reply = try {
      await ledger.icrc2_transfer_from({
        spender_subaccount = null; from = { owner = p.caller; subaccount = null };
        to = { owner = self; subaccount = null }; amount; fee = null;
        memo = ?id.encodeUtf8(); created_at_time = ?time;
      });
    } catch (_) {
      problem(id, unit # " ledger reply unavailable; the payment will be re-checked");
      return;
    };
    let ?latest = state.purchases.get(id) else return;
    func paid(block : Nat) {
      save({ latest with ledgerBlock = ?block; paymentStatus = "ledger_paid"; fulfillment = #paid; updatedAt = Time.now(); lastError = null; attempts = 0 });
    };
    func fail(message : Text) {
      save({ latest with paymentStatus = "ledger_failed"; fulfillment = #closed; updatedAt = Time.now(); lastError = ?message });
      ignore state.pending.delete(id);
    };
    switch (reply) {
      case (#Ok block) paid(block);
      case (#Err(#Duplicate { duplicate_of })) paid(duplicate_of);
      case (#Err(#TemporarilyUnavailable)) problem(id, unit # " ledger temporarily unavailable; retrying");
      // A first attempt never reached the ledger, so these are final; after an unknown outcome they need review.
      case (#Err(#TooOld)) {
        if (latest.attempts == 0) fail(unit # " payment request expired")
        else save({ latest with fulfillment = #review; lastError = ?(unit # " payment outcome unknown; owner must reconcile") });
      };
      case (#Err(#InsufficientAllowance _)) fail(unit # " approval missing or too low");
      case (#Err(#InsufficientFunds _)) fail("Not enough " # unit # " in your wallet");
      case (#Err(#BadFee { expected_fee })) fail("Unexpected ledger fee " # expected_fee.toText());
      case (#Err(#CreatedInFuture _)) problem(id, "Ledger clock skew; retrying");
      case (#Err(#BadBurn _)) fail("Ledger rejected the payment");
      case (#Err(#GenericError { message })) fail("Ledger error: " # message);
    };
  };

  func fulfill(id : Text) : async () {
    let ?p = state.purchases.get(id) else return;
    if (p.nftId != null) { ignore state.pending.delete(id); return };
    var seed = p.seed;
    if (seed == null) {
      let entropy = await Random.blob();
      let ?current = state.purchases.get(id) else return;
      seed := ?entropy;
      let lucky = Tiers.lucky(entropy, current.method == #token);
      save({ current with seed; lucky; artTier = ?Tiers.artTier(current.tier, lucky); fulfillment = #paid; updatedAt = Time.now() });
    };
    let ?current = state.purchases.get(id) else return;
    let ?frozen = seed else Runtime.trap("Missing generation seed");
    save({ current with fulfillment = #minting });
    try {
      switch (await (with timeout = 120) nft<system>().mintV2(current.caller, frozen, current.artTier ?? Tiers.artTier(current.tier, current.lucky), mintKey(current))) {
        case (#ok tokenId) {
          let ?latest = state.purchases.get(id) else return;
          save({ latest with fulfillment = #minted; nftId = ?tokenId; updatedAt = Time.now(); lastError = null });
          ignore state.pending.delete(id);
        };
        case (#err e) {
          save({ current with fulfillment = #paid });
          problem(id, Types.errorText(e));
        };
      };
    } catch (_) {
      save({ current with fulfillment = #paid });
      problem(id, "Mint reply unavailable; retry will reconcile the same mint key");
    };
  };

  func mintKey(p : Types.Purchase) : Text {
    (switch (p.method) {
      case (#icp) "icp:";
      case (#token) "token:";
      case (#paw) if (mock) "mock:" else if (p.sandbox) "paw:sandbox:" else "paw:live:";
    }) # p.id;
  };

  // Only completed-mint provenance is public; checkout and invoice data stay private.
  public query func getMintDetails(keys : [Text]) : async [?Types.MintDetails] {
    if (keys.size() > 100) Runtime.trap("Request at most 100 mint details");
    keys.map(func key {
      if (key.size() > 128) return null;
      var id = "";
      for (part in key.split(#char ':')) { id := part };
      let ?p = state.purchases.get(id) else return null;
      let ?nftId = p.nftId else return null;
      if (p.fulfillment != #minted or mintKey(p) != key) return null;
      let price = switch (p.method) {
        case (#paw) ?#eur(p.amountEur);
        case (#icp) p.amountE8s.map<Nat, { #eur : Nat; #icp : Nat; #token : Nat }>(func amount = #icp amount);
        case (#token) p.amountE8s.map<Nat, { #eur : Nat; #icp : Nat; #token : Nat }>(func amount = #token amount);
      };
      ?{
        nftId; creator = p.caller; price; artTier = p.artTier; lucky = p.lucky;
        testMint = p.method == #paw and (mock or p.sandbox);
      };
    });
  };

  func reconcileCreation(p : Types.Purchase) : async () {
    let from = Int.abs(p.createdAt / 1_000_000_000 - 60).toText();
    let until = Int.abs(p.createdAt / 1_000_000_000 + 300).toText();
    var page = 1;
    var matches : [Paw.Invoice] = [];
    while (page <= 5) {
      let result = switch (await request("invoices?date_from=" # from # "&date_to=" # until # "&per_page=100&page=" # page.toText(), null, false)) {
        case (#ok body) Paw.envelope(body);
        case (#err e) { problem(p.id, e); return };
      };
      let values = switch (result) {
        case (#ok(#array values)) values;
        case _ { problem(p.id, "Cannot reconcile invoice list"); return };
      };
      for (v in values.values()) {
        if (Paw.text(v, "extra") == ?p.id) {
          switch (Paw.decode(v)) { case (#ok i) matches := matches.concat([i]); case (#err e) { problem(p.id, e); return } };
        };
      };
      if (values.size() < 100) break;
      page += 1;
    };
    if (matches.size() != 1 or page > 5) {
      problem(p.id, "Creation outcome ambiguous; owner must reconcile in the Paw dashboard. No automatic POST retry.");
      return;
    };
    let invoice = matches[0];
    // This unreplicated list only discovers the ID. A replicated GET authorizes settlement.
    save({ p with invoiceId = ?invoice.id; fulfillment = #awaiting; lastError = ?"Recovered invoice; checkout link may require support" });
  };

  func process(id : Text) : async () {
    if (locks.contains(id)) return;
    locks.add(id);
    try {
      let ?p = state.purchases.get(id) else return;
      if (p.fulfillment == #paid or p.fulfillment == #minting) { await fulfill(id); return };
      if (p.method != #paw) {
        if (p.fulfillment == #awaiting) await collect(id);
        let ?latest = state.purchases.get(id) else return;
        if (latest.fulfillment == #paid) await fulfill(id);
        return;
      };
      if (mock) {
        save({ p with paymentStatus = "success"; fulfillment = #paid; updatedAt = Time.now() });
        await fulfill(id);
        return;
      };
      let invoiceId = switch (p.invoiceId) {
        case (?i) i;
        case null { await reconcileCreation(p); return };
      };
      let response = switch (await request("invoices/" # invoiceId, null, true)) {
        case (#ok body) Paw.parse(body);
        case (#err e) { problem(id, e); return };
      };
      let invoice = switch (response) { case (#ok i) i; case (#err e) { problem(id, e); return } };
      if (invoice.id != invoiceId or invoice.intent != id or invoice.amount != p.amountEur or invoice.currency != "EUR" or invoice.billing != "STATIC" or state.sandbox != p.sandbox or not Paw.environmentMatches(invoice, p.sandbox)) {
        problem(id, "Settlement invoice identity, amount, currency or environment mismatch");
        return;
      };
      if (not Paw.known(invoice.status)) { problem(id, "Unknown Paw payment status"); return };
      let next : Types.Fulfillment = if (Paw.paid(invoice.status)) #paid else if (Paw.terminal(invoice.status)) #closed else #awaiting;
      save({ p with paymentStatus = invoice.status; fulfillment = next; updatedAt = Time.now(); nextCheck = Time.now() + 30_000_000_000; attempts = 0; lastError = null });
      if (next == #paid) await fulfill(id);
      if (next == #closed) ignore state.pending.delete(id);
    } catch (_) {
      problem(id, "Purchase processing failed; saved state will be retried");
    } finally { ignore locks.delete(id) };
  };

  public shared ({ caller }) func refreshPurchase(id : Text) : async Result.Result<Types.Purchase, Types.PaymentError> {
    if (caller.isAnonymous()) return #err(#unauthorized);
    let ?p = state.purchases.get(id) else return #err(#rejected("Purchase not found"));
    if (p.caller != caller and not caller.isController()) return #err(#rejected("Not your purchase"));
    if (p.fulfillment == #minted or p.fulfillment == #closed) return #ok p;
    if (Time.now() < p.nextCheck and not caller.isController()) return #err(#rejected("Next status check is not due yet"));
    await process(id);
    #ok(state.purchases.get(id) ?? p);
  };

  public query ({ caller }) func getMyPurchases() : async [Types.Purchase] {
    auth(caller);
    state.purchases.values().toArray().filter(func p = p.caller == caller).sort(func(a, b) = Int.compare(b.createdAt, a.createdAt));
  };

  public query ({ caller }) func reconciliationQueue() : async [Types.Purchase] {
    admin(caller);
    state.purchases.values().toArray().filter(func p = p.lastError != null or p.fulfillment == #review);
  };

  public shared ({ caller }) func attachPawInvoice(id : Text, invoiceId : Text) : async Result.Result<(), Types.PaymentError> {
    if (caller.isAnonymous()) return #err(#unauthorized);
    if (not caller.isController()) return #err(#forbidden);
    if (locks.contains(id)) return #err(#rejected("Purchase processing is in progress; retry later"));
    if (invoiceId.size() != 24 or not invoiceId.chars().all(func c = (c >= '0' and c <= '9') or (c >= 'a' and c <= 'f'))) return #err(#rejected("Invalid Paw invoice ID"));
    let ?p = state.purchases.get(id) else return #err(#rejected("Purchase not found"));
    if (p.nftId != null or p.invoiceId != null) return #err(#rejected("Purchase already has an invoice or NFT"));
    save({ p with invoiceId = ?invoiceId; fulfillment = #awaiting });
    state.pending.add(id);
    ensurePolling<system>();
    await process(id);
    #ok();
  };

  public shared ({ caller }) func closeUnknownPurchase(id : Text, reason : Text) : async Result.Result<(), Types.PaymentError> {
    if (caller.isAnonymous()) return #err(#unauthorized);
    if (not caller.isController()) return #err(#forbidden);
    if (locks.contains(id)) return #err(#rejected("Purchase processing is in progress; retry later"));
    let ?p = state.purchases.get(id) else return #err(#rejected("Purchase not found"));
    if (p.invoiceId != null or p.seed != null or p.nftId != null or (p.fulfillment != #creating and p.fulfillment != #review)) {
      return #err(#rejected("Only unresolved invoice creation can be closed manually"));
    };
    if (reason.size() < 10 or reason.size() > 500) return #err(#rejected("Record a dashboard reconciliation reason (10-500 characters)"));
    save({ p with fulfillment = #closed; paymentStatus = "closed_by_owner"; updatedAt = Time.now(); lastError = ?("Owner reconciliation: " # reason) });
    ignore state.pending.delete(id);
    #ok();
  };

  func pollPurchases() : async () {
    if (state.pending.isEmpty()) {
      switch (pollTimer) {
        case (?timer) { Timer.cancelTimer(timer); pollTimer := null };
        case null {};
      };
      return;
    };
    if (polling) return;
    polling := true;
    try {
      let ids = state.pending.values().toArray();
      if (ids.size() == 0) return;
      let start = state.cursor % ids.size();
      state.cursor := (start + Nat.min(10, ids.size())) % ids.size();
      var i = 0;
      while (i < Nat.min(10, ids.size())) {
        let id = ids[(start + i) % ids.size()];
        let ?p = state.purchases.get(id) else Runtime.trap("Missing pending purchase");
        if (Time.now() >= p.nextCheck) await process(id);
        i += 1;
      };
    } finally { polling := false };
  };
}
