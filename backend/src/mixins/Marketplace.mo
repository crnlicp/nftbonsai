import Map "mo:core/Map";
import Nat "mo:core/Nat";
import Nat64 "mo:core/Nat64";
import Text "mo:core/Text";
import Int "mo:core/Int";
import Principal "mo:core/Principal";
import Time "mo:core/Time";
import Runtime "mo:core/Runtime";
import Timer "mo:core/Timer";
import Debug "mo:core/Debug";
import Set "mo:core/Set";
import Option "mo:core/Option";
import Iter "mo:core/Iter";
import Array "mo:core/Array";
import Types "../MarketTypes";
import Payments "../PaymentTypes";
import Policy "../lib/Market";

mixin (market : Types.State, paw : Payments.State, self : Principal) {
  transient let running = Set.empty<Nat>();
  transient var marketTimer : ?Timer.TimerId = null;
  transient var scanning = false;
  transient var scanCursor = 0;

  func captureReference(p : Payments.Purchase) {
    if (market.references.containsKey(p.id)) return;
    switch (Policy.reference(p, paw.icpTiers, paw.tokenTiers)) {
      case (?r) market.references.add(p.id, r);
      case null {};
    };
  };

  func marketNft<system>() : Types.Nft {
    actor(Runtime.envVar<system>("PUBLIC_CANISTER_ID:icrc7") ?? Runtime.trap("Missing NFT canister ID"));
  };
  type Ledger = actor {
    icrc1_fee : shared query () -> async Nat;
    icrc1_balance_of : shared query Payments.Account -> async Nat;
    icrc2_transfer_from : ({
      spender_subaccount : ?Blob; from : Payments.Account; to : Payments.Account;
      amount : Nat; fee : ?Nat; memo : ?Blob; created_at_time : ?Nat64;
    }) -> async { #Ok : Nat; #Err : Payments.TransferFromError };
    icrc1_transfer : ({
      from_subaccount : ?Blob; to : Payments.Account; amount : Nat; fee : ?Nat;
      memo : ?Blob; created_at_time : ?Nat64;
    }) -> async { #Ok : Nat; #Err : Payments.TransferError };
  };
  func ledger(id : Principal) : Ledger { actor(id.toText()) };
  func saveListing(l : Types.Listing) { market.listings.add(l.id, { l with updatedAt = Time.now() }) };
  func currentListing(nftId : Nat) : ?Types.Listing {
    let ?id = market.current.get(nftId) else return null;
    market.listings.get(id);
  };
  func pending(l : Types.Listing) : Bool {
    l.phase == #locking or l.phase == #cancelling or l.phase == #collecting or l.phase == #delivering or l.phase == #paying;
  };
  func marketProblem(l : Types.Listing, text : Text) {
    saveListing({ l with error = ?text });
    Debug.print("market " # l.id.toText() # ": " # text);
  };
  func marketAuth(caller : Principal) {
    if (caller.isAnonymous()) Runtime.trap("Sign in to trade bonsai");
  };
  func ensureMarketPolling<system>() {
    if (marketTimer != null) return;
    for (l in market.listings.values()) {
      if (pending(l)) {
        marketTimer := ?Timer.recurringTimer<system>(#seconds 30, pollMarket);
        return;
      };
    };
  };
  func pollMarket() : async () {
    if (scanning) return;
    scanning := true;
    try {
      let candidates = market.listings.values().toArray().filter(pending);
      if (candidates.size() > 0) {
        var count = 0;
        while (count < Nat.min(10, candidates.size())) {
          await resumeMarket(candidates[(scanCursor + count) % candidates.size()].id);
          count += 1;
        };
        scanCursor := (scanCursor + count) % candidates.size();
      };
      if (not market.listings.values().any(pending)) {
        switch marketTimer { case (?id) Timer.cancelTimer(id); case null {} };
        marketTimer := null;
      };
    } finally { scanning := false };
  };

  public query func marketPolicy() : async { feeBps : Nat; maxMultiple : Nat; token : ?Payments.Token } {
    { feeBps = 200; maxMultiple = 2; token = paw.token };
  };
  public query func marketListings(ids : [Nat]) : async [?Types.Listing] {
    if (ids.size() > 100) Runtime.trap("Request at most 100 listings");
    ids.map(currentListing);
  };
  public query ({ caller }) func myMarketActivity(before : ?Nat) : async [Types.Listing] {
    marketAuth(caller);
    let rows = market.listings.values().toArray().filter(func l =
      (l.seller == caller or l.buyer == ?caller) and (switch before { case (?id) l.id < id; case null true }))
      .sort(func(a, b) = Nat.compare(b.id, a.id));
    Array.tabulate(Nat.min(50, rows.size()), func i = rows[i]);
  };
  public query func mintReferences(keys : [Text]) : async [?Types.Reference] {
    if (keys.size() > 100) Runtime.trap("Request at most 100 references");
    keys.map(func key {
      var id = "";
      for (part in key.split(#char ':')) id := part;
      let ?p = paw.purchases.get(id) else return null;
      if (p.fulfillment != #minted or p.nftId == null) return null;
      market.references.get(id);
    });
  };
  func selectedLedger<system>(currency : Types.Currency) : ?Principal {
    switch currency {
      case (#icp) ?Principal.fromText(Runtime.envVar<system>("ICP_LEDGER_ID") ?? "ryjl3-tyaaa-aaaaa-aaaba-cai");
      case (#token) paw.token.map(func t = t.ledger);
    };
  };

  public shared ({ caller }) func listBonsai(nftId : Nat, currency : Types.Currency, price : Nat) : async { #ok : Types.Listing; #err : Text } {
    marketAuth(caller);
    if (price == 0) return #err("Price must be positive");
    let ?ledgerId = selectedLedger<system>(currency) else return #err("$BONSAI trading is not configured");
    let nft = await marketNft<system>().getNft(nftId);
    let ?token = nft else return #err("Bonsai not found");
    if (token.owner != caller) return #err("Only the current owner can list this bonsai");
    var purchaseId = "";
    for (part in token.paymentId.split(#char ':')) purchaseId := part;
    let ?p = paw.purchases.get(purchaseId) else return #err("Original mint receipt unavailable; sending is still available");
    if (p.fulfillment != #minted or p.nftId != ?nftId) return #err("Original mint receipt does not match");
    let ?reference = market.references.get(p.id) else return #err("Original mint reference unavailable");
    if (price > Policy.cap(reference, currency)) return #err("Price exceeds 2x original mint reference");
    let fee = await ledger(ledgerId).icrc1_fee();
    let appFee = Policy.appFee(price);
    if (appFee == 0 or price <= appFee + fee) return #err("Price must cover the app fee and payout network fee");
    // Recheck local state after awaits, before reserving this token.
    switch (currentListing(nftId)) {
      case (?existing) if (existing.phase != #cancelled and existing.phase != #sold) return #err("Cancel the existing listing before changing its price");
      case null {};
    };
    let now = Time.now();
    let l : Types.Listing = {
      id = market.nextId; nftId; seller = caller; currency; ledger = ledgerId; price; revision = market.nextId;
      phase = #locking; buyer = null; fee; appFee; proceeds = price - appFee - fee;
      createdAt = now; updatedAt = now; payTime = null; payoutTime = null;
      paymentBlock = null; deliveryBlock = null; payoutBlock = null; error = null; feeTime = null; feeBlock = null; sweepFee = null; paymentUncertain = false; payoutUncertain = false;
    };
    market.nextId += 1;
    market.current.add(nftId, l.id); saveListing(l);
    ensureMarketPolling<system>();
    await resumeMarket(l.id);
    #ok(market.listings.get(l.id) ?? l);
  };

  public shared ({ caller }) func cancelListing(id : Nat) : async { #ok : Types.Listing; #err : Text } {
    marketAuth(caller);
    let ?l = market.listings.get(id) else return #err("Listing not found");
    if (l.seller != caller) return #err("Only the seller can cancel");
    if (running.contains(id)) return #err("Listing operation in progress; retry shortly");
    if (l.phase != #active and l.phase != #locking and l.phase != #cancelling) return #err("A reserved or completed sale cannot be cancelled");
    saveListing({ l with phase = #cancelling; error = null });
    ensureMarketPolling<system>();
    await resumeMarket(id);
    #ok(market.listings.get(id) ?? l);
  };

  public shared func marketQuote(id : Nat) : async { #ok : Types.Quote; #err : Text } {
    let ?l = market.listings.get(id) else return #err("Listing not found");
    if (l.phase != #active) return #err("Listing is not available");
    let fee = await ledger(l.ledger).icrc1_fee();
    if (l.price <= l.appFee + fee) return #err("Ledger fee exceeds seller proceeds");
    #ok { listing = l; approvalFee = fee; paymentFee = fee; payoutFee = fee; totalDebit = l.price + 2 * fee; sellerReceives = l.price - l.appFee - fee };
  };

  public shared ({ caller }) func buyBonsai(id : Nat, revision : Nat, expectedFee : Nat) : async { #ok : Types.Listing; #err : Text } {
    marketAuth(caller);
    let ?l = market.listings.get(id) else return #err("Listing not found");
    if (l.buyer == ?caller and l.phase != #active) {
      await resumeMarket(id);
      return #ok(market.listings.get(id) ?? l);
    };
    if (l.phase != #active or l.revision != revision) return #err("Listing changed or was reserved; refresh the quote");
    if (l.seller == caller) return #err("You cannot buy your own bonsai");
    if (running.contains(id)) return #err("Listing operation in progress");
    let actualFee = await ledger(l.ledger).icrc1_fee();
    let ?latest = market.listings.get(id) else return #err("Listing not found");
    if (latest.phase != #active or latest.revision != revision) return #err("Listing changed or was reserved");
    if (actualFee != expectedFee) return #err("Network fee changed; review a new quote");
    if (latest.price <= latest.appFee + actualFee) return #err("Price no longer covers payout fees");
    saveListing({ latest with phase = #collecting; buyer = ?caller; fee = actualFee;
      proceeds = latest.price - latest.appFee - actualFee; payTime = ?Int.abs(Time.now()).toNat64(); error = null });
    ensureMarketPolling<system>();
    await resumeMarket(id);
    #ok(market.listings.get(id) ?? latest);
  };

  public shared ({ caller }) func retryMarket(id : Nat) : async { #ok : Types.Listing; #err : Text } {
    marketAuth(caller);
    let ?l = market.listings.get(id) else return #err("Sale not found");
    if (l.seller != caller and l.buyer != ?caller) return #err("This is not your sale");
    if (running.contains(id)) return #err("Sale operation in progress; retry shortly");
    if (l.phase == #review) {
      saveListing({ l with phase = if (l.deliveryBlock == null) #collecting else #paying; error = null });
      ensureMarketPolling<system>();
    };
    await resumeMarket(id);
    #ok(market.listings.get(id) ?? l);
  };

  public shared ({ caller }) func claimMarketFee(id : Nat) : async { #ok : Nat; #err : Text } {
    if (caller.isAnonymous() or not caller.isController()) return #err("Controller only");
    let ?l = market.listings.get(id) else return #err("Sale not found");
    if (l.phase != #sold) return #err("Seller must be paid before withdrawing the app fee");
    switch (l.feeBlock) { case (?block) return #ok block; case null {} };
    if (running.contains(id)) return #err("Sale operation in progress");
    running.add(id);
    try {
      let bank = ledger(l.ledger);
      let fee = switch (l.sweepFee) { case (?saved) saved; case null await bank.icrc1_fee() };
      if (l.appFee <= fee) return #err("App fee does not cover its own network fee");
      let stamp = l.feeTime ?? Int.abs(Time.now()).toNat64();
      if (Int.abs(Time.now()).toNat64() > stamp + 86_400_000_000_000) return #err("Fee withdrawal outcome needs ledger reconciliation");
      saveListing({ l with feeTime = ?stamp; sweepFee = ?fee });
      switch (await bank.icrc1_transfer({
        from_subaccount = ?Policy.subaccount(id); to = { owner = self; subaccount = null };
        amount = l.appFee - fee; fee = ?fee; memo = ?("fee:" # id.toText()).encodeUtf8(); created_at_time = ?stamp;
      })) {
        case (#Ok block) { saveListing({ l with feeTime = ?stamp; feeBlock = ?block; sweepFee = ?fee }); #ok block };
        case (#Err(#Duplicate d)) { saveListing({ l with feeTime = ?stamp; feeBlock = ?d.duplicate_of; sweepFee = ?fee }); #ok(d.duplicate_of) };
        case (#Err e) #err("App fee transfer rejected: " # debug_show e);
      };
    } catch (_) { #err("Fee withdrawal reply unavailable; retry the same sale") }
    finally { running.remove(id) };
  };

  func resumeMarket(id : Nat) : async () {
    if (running.contains(id)) return;
    running.add(id);
    try {
      var l = market.listings.get(id) ?? Runtime.trap("Sale not found");
      if (l.phase == #locking) {
        switch (await marketNft<system>().lockForSale(l.nftId, l.seller, id)) {
          case (#err text) { saveListing({ l with phase = #cancelled; error = ?text }); return };
          case (#ok) { l := { l with phase = #active; error = null }; saveListing(l); return };
        };
      };
      if (l.phase == #cancelling) {
        switch (await marketNft<system>().unlockSale(l.nftId, id)) {
          case (#err text) { marketProblem(l, text); return };
          case (#ok) { saveListing({ l with phase = #cancelled; error = null }); return };
        };
      };
      let account = { owner = self; subaccount = ?Policy.subaccount(id) };
      let bank = ledger(l.ledger);
      if (l.phase == #collecting) {
        let ?buyer = l.buyer else Runtime.trap("Missing buyer");
        let ?stamp = l.payTime else Runtime.trap("Missing debit time");
        // A full price in this isolated account proves the sale is funded even
        // after a lost reply. Zero alone never proves an uncertain call failed.
        let funded = await bank.icrc1_balance_of(account);
        if (funded < l.price) {
          switch (await bank.icrc2_transfer_from({
            spender_subaccount = null; from = { owner = buyer; subaccount = null }; to = account;
            amount = l.price; fee = ?l.fee; memo = ?("sale:" # id.toText()).encodeUtf8(); created_at_time = ?stamp;
          })) {
            case (#Ok block) { l := { l with paymentBlock = ?block } };
            case (#Err(#Duplicate d)) { l := { l with paymentBlock = ?d.duplicate_of } };
            case (#Err(#TooOld)) {
              // The ledger has closed this transaction's acceptance window.
              // Read again afterwards, so no outstanding original call can
              // debit the buyer after we release their reservation.
              let balance = await bank.icrc1_balance_of(account);
              if (balance == 0) {
                saveListing({ l with phase = #active; buyer = null; payTime = null;
                  paymentUncertain = false; revision = l.revision + 1;
                  error = ?"Expired payment was not debited; listing is available again" }); return;
              };
              if (balance < l.price) {
                saveListing({ l with phase = #review; error = ?"Unexpected partial sale balance; ledger review required" }); return;
              };
            };
            case (#Err e) {
              // Keep reservations on uncertainty; only definite non-debits reopen.
              if (l.paymentUncertain) {
                marketProblem(l, "An earlier debit outcome is uncertain; reservation remains protected: " # debug_show e);
                return;
              };
              switch e {
                case (#InsufficientFunds _) { saveListing({ l with phase = #active; buyer = null; payTime = null; revision = l.revision + 1; error = ?"Buyer balance is insufficient" }); return };
                case (#InsufficientAllowance _) { saveListing({ l with phase = #active; buyer = null; payTime = null; revision = l.revision + 1; error = ?"Approve the quoted amount plus payment fee" }); return };
                case (#BadFee _) { saveListing({ l with phase = #active; buyer = null; payTime = null; revision = l.revision + 1; error = ?"Network fee changed; review the new quote" }); return };
                case _ { marketProblem(l, "Payment pending: " # debug_show e); return };
              };
            };
          };
        };
        l := { l with phase = #delivering; error = null }; saveListing(l);
      };
      if (l.phase == #delivering) {
        let ?buyer = l.buyer else Runtime.trap("Missing buyer");
        switch (await marketNft<system>().deliverSale(l.nftId, id, buyer)) {
          case (#err text) { marketProblem(l, "Paid; NFT delivery pending: " # text); return };
          case (#ok block) {
            l := { l with phase = #paying; deliveryBlock = ?block; payoutTime = ?Int.abs(Time.now()).toNat64(); error = null };
            saveListing(l);
          };
        };
      };
      if (l.phase == #paying) {
        let ?stamp = l.payoutTime else Runtime.trap("Missing payout time");
        let balance = await bank.icrc1_balance_of(account);
        if (balance == l.appFee) { saveListing({ l with phase = #sold; error = null }); return };
        switch (await bank.icrc1_transfer({
          from_subaccount = account.subaccount; to = { owner = l.seller; subaccount = null };
          amount = l.proceeds; fee = ?l.fee; memo = ?("payout:" # id.toText()).encodeUtf8(); created_at_time = ?stamp;
        })) {
          case (#Ok block) saveListing({ l with phase = #sold; payoutBlock = ?block; error = null });
          case (#Err(#Duplicate d)) saveListing({ l with phase = #sold; payoutBlock = ?d.duplicate_of; error = null });
          case (#Err(#TooOld)) {
            let balance = await bank.icrc1_balance_of(account);
            if (balance == l.appFee) { saveListing({ l with phase = #sold; error = null }); return };
            if (balance < l.price) {
              saveListing({ l with phase = #review; error = ?"Unexpected payout balance; ledger review required" }); return;
            };
            let fee = await bank.icrc1_fee();
            if (l.price <= l.appFee + fee) {
              saveListing({ l with phase = #review; error = ?"Payout fee exceeds proceeds; funds remain reserved" }); return;
            };
            saveListing({ l with fee; proceeds = l.price - l.appFee - fee;
              payoutTime = ?Int.abs(Time.now()).toNat64(); payoutUncertain = false;
              error = ?"Ledger confirmed the old payout expired without payment; safely retrying proceeds" });
          };
          case (#Err(#BadFee detail)) {
            if (l.payoutUncertain) {
              marketProblem(l, "An earlier payout outcome is uncertain; keeping its original deduplication arguments");
            } else if (l.price <= l.appFee + detail.expected_fee) {
              saveListing({ l with phase = #review; error = ?"Payout fee exceeds proceeds; ledger review required" });
            } else {
              saveListing({ l with fee = detail.expected_fee; proceeds = l.price - l.appFee - detail.expected_fee;
                payoutTime = ?Int.abs(Time.now()).toNat64(); error = ?"Payout network fee changed; retry will use the corrected fee" });
            };
          };
          case (#Err e) marketProblem(l, "NFT delivered; seller payout pending: " # debug_show e);
        };
      };
    } catch (_) {
      let ?l = market.listings.get(id) else return;
      marketProblem({ l with paymentUncertain = l.paymentUncertain or l.phase == #collecting;
        payoutUncertain = l.payoutUncertain or l.phase == #paying }, "Canister reply unavailable; saved sale will resume without a new charge");
    } finally { running.remove(id) };
  };
}
