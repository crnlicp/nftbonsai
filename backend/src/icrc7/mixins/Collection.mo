import { leb128; sha; repHash } "../lib/Hash";
import { type BonsaiTraits; type Account; type NftRecord; type NftPublic; type Value; type TransferArg; type TransferError; type TransferResult; type ApprovalInfo; type ApproveTokenArg; type ApproveTokenError; type ApproveTokenResult; type ApproveCollectionArg; type ApproveCollectionError; type ApproveCollectionResult; type RevokeTokenApprovalArg; type RevokeTokenApprovalError; type RevokeTokenApprovalResult; type RevokeCollectionApprovalArg; type RevokeCollectionApprovalError; type RevokeCollectionApprovalResult; type IsApprovedArg; type TokenApproval; type CollectionApproval; type TransferFromArg; type TransferFromError; type TransferFromResult; type ApprovalRecord; type GetBlocksArgs; type GetBlocksResult; type GetArchivesArgs; type ArchiveInfo; type DataCertificate; type HeaderField; type HttpRequest; type HttpResponse } "../types";
/// Minimal ICRC-7 NFT collection for the bonsai dapp.
///
/// Only the backend canister (whose principal is read from
/// `PUBLIC_CANISTER_ID:backend` at deploy time) may call `mint`. Everyone else
/// can read metadata, list tokens, and transfer their own tokens. Anonymous
/// callers are rejected on every update.

import Principal "mo:core/Principal";
import Map "mo:core/Map";
import List "mo:core/List";
import Array "mo:core/Array";
import Nat "mo:core/Nat";
import Nat8 "mo:core/Nat8";
import Nat16 "mo:core/Nat16";
import Nat64 "mo:core/Nat64";
import Int "mo:core/Int";
import Text "mo:core/Text";
import Iter "mo:core/Iter";
import Blob "mo:core/Blob";
import Time "mo:core/Time";
import Runtime "mo:core/Runtime";
import CertifiedData "mo:core/CertifiedData";
import CertTree "mo:ic-certification/CertTree";
import Option "mo:core/Option";

import Art "../lib/Art";
import Certification "../lib/Certification";
import Payments "../../PaymentTypes";

mixin (
  canisterId : Principal,
  tokens : Map.Map<Nat, NftRecord>,
  counters : { var nextId : Nat; var blockCount : Nat; var lastBlockHash : ?Blob },
  tokenApprovals : Map.Map<Nat, [ApprovalRecord]>,
  collectionApprovals : Map.Map<Principal, [ApprovalRecord]>,
  blocks : Map.Map<Nat, Value>,
  artwork : Map.Map<Nat, Art.Artwork>,
  mintKeys : Map.Map<Text, Nat>,
  mintRecipients : Map.Map<Text, { to : Principal; tier : Nat }>,
  silhouettes : Map.Map<Blob, Blob>,
  artworkHashes : Map.Map<Blob, Blob>,
  certStore : CertTree.Store,
) {

  // ---------------------------------------------------------------------------
  // Types
  // ---------------------------------------------------------------------------

  transient let maxApprovals : Nat = 10;
  transient let certified = CertTree.Ops(certStore);


  // ---------------------------------------------------------------------------
  // Guards
  // ---------------------------------------------------------------------------

  func requireAuth(caller : Principal) {
    if (caller.isAnonymous()) { Runtime.trap("anonymous caller not allowed") };
  };

  func backendAuthorized<system>(caller : Principal) : Bool {
    let expected = Principal.fromText(Runtime.envVar<system>("PUBLIC_CANISTER_ID:backend") ?? Runtime.trap("Backend canister ID is not configured"));
    not caller.isAnonymous() and caller == expected;
  };

  // ---------------------------------------------------------------------------
  // Internal helpers (accounts, approvals, ICRC-3 hashing)
  // ---------------------------------------------------------------------------

  func nowNanos() : Nat64 { Int.abs(Time.now()).toNat64() };

  // Treat a null subaccount and the all-zero 32-byte subaccount as identical.
  func isDefaultSub(s : ?Blob) : Bool {
    switch (s) {
      case null true;
      case (?b) {
        let arr = b.toArray();
        if (arr.size() != 32) return false;
        var i = 0;
        while (i < 32) { if (arr[i] != 0) return false; i += 1 };
        true;
      };
    };
  };

  func subEqual(a : ?Blob, b : ?Blob) : Bool {
    if (isDefaultSub(a) and isDefaultSub(b)) return true;
    switch (a, b) { case (?x, ?y) x == y; case _ false };
  };

  func accountEqual(a : Account, b : Account) : Bool {
    a.owner == b.owner and subEqual(a.subaccount, b.subaccount);
  };

  func accountValue(a : Account) : Value {
    switch (a.subaccount) {
      case (?sub) #Array([#Blob(a.owner.toBlob()), #Blob sub]);
      case null #Array([#Blob(a.owner.toBlob())]);
    };
  };

  func approvalActive(a : ApprovalRecord, now : Nat64) : Bool {
    switch (a.expiresAt) { case (?e) e > now; case null true };
  };

  func anyActiveMatch(list : [ApprovalRecord], spender : Account, now : Nat64) : Bool {
    for (a in list.values()) {
      if (accountEqual(a.spender, spender) and approvalActive(a, now)) return true;
    };
    false;
  };

  // True if `spender` may move `token_id` owned by `owner` (token or collection
  // approval, not expired).
  func isSpenderApproved(token_id : Nat, owner : Principal, spender : Account, now : Nat64) : Bool {
    let tList = switch (tokenApprovals.get(token_id)) { case (?a) a; case null [] };
    if (anyActiveMatch(tList, spender, now)) return true;
    let cList = switch (collectionApprovals.get(owner)) { case (?a) a; case null [] };
    anyActiveMatch(cList, spender, now);
  };

  func toApprovalInfo(a : ApprovalRecord) : ApprovalInfo {
    {
      spender = a.spender;
      from_subaccount = null;
      expires_at = a.expiresAt;
      memo = null;
      created_at_time = ?a.createdAt;
    };
  };

  // Append a block to the ICRC-3 log and return its index.
  func appendBlock(btype : Text, tx : Value) : Nat {
    let fields = List.empty<(Text, Value)>();
    switch (counters.lastBlockHash) {
      case (?h) fields.add(("phash", #Blob h));
      case null {};
    };
    fields.add(("btype", #Text btype));
    fields.add(("ts", #Nat(nowNanos().toNat())));
    fields.add(("tx", tx));
    let block : Value = #Map(fields.toArray());
    let idx = counters.blockCount;
    blocks.add(idx, block);
    counters.blockCount += 1;
    counters.lastBlockHash := ?repHash(block);
    certified.put(["last_block_index"], leb128(idx).toBlob());
    certified.put(["last_block_hash"], counters.lastBlockHash ?? "");
    certified.setCertifiedData();
    idx;
  };

  // Record a token approval for one spender, replacing any existing approval by
  // the same spender. Enforces the per-token approval cap.
  func putTokenApproval(token_id : Nat, info : ApprovalInfo) {
    let rec : ApprovalRecord = {
      spender = info.spender;
      expiresAt = info.expires_at;
      createdAt = nowNanos();
    };
    let existing = switch (tokenApprovals.get(token_id)) { case (?a) a; case null [] };
    let filtered = existing.filter(func a { not accountEqual(a.spender, info.spender) });
    let next = filtered.concat([rec]);
    let capped = if (next.size() > maxApprovals) {
      next.sliceToArray(next.size() - maxApprovals, next.size());
    } else next;
    tokenApprovals.add(token_id, capped);
  };

  func putCollectionApproval(owner : Principal, info : ApprovalInfo) {
    let rec : ApprovalRecord = {
      spender = info.spender;
      expiresAt = info.expires_at;
      createdAt = nowNanos();
    };
    let existing = switch (collectionApprovals.get(owner)) { case (?a) a; case null [] };
    let filtered = existing.filter(func a { not accountEqual(a.spender, info.spender) });
    let next = filtered.concat([rec]);
    let capped = if (next.size() > maxApprovals) {
      next.sliceToArray(next.size() - maxApprovals, next.size());
    } else next;
    collectionApprovals.add(owner, capped);
  };


  // ---------------------------------------------------------------------------
  // Admin
  // ---------------------------------------------------------------------------

  public query func getImageBaseUrl() : async Text {
    "https://" # canisterId.toText() # ".icp.net/nft/";
  };

  // ---------------------------------------------------------------------------
  // Mint (backend-only)
  // ---------------------------------------------------------------------------

  public shared ({ caller }) func mintV2(to : Principal, seed : Blob, tier : Nat, key : Text) : async { #ok : Nat; #err : Payments.PaymentError } {
    if (caller.isAnonymous()) return #err(#unauthorized);
    if (not backendAuthorized<system>(caller)) return #err(#forbidden);
    if (to.isAnonymous() or seed.size() != 32 or tier > 4 or key.size() == 0 or key.size() > 128) return #err(#rejected("Invalid mint input"));
    switch (mintKeys.get(key)) {
      case (?id) {
        let existing = artwork.get(id) ?? Runtime.trap("Mint key belongs to a legacy token");
        let recipient = mintRecipients.get(key) ?? Runtime.trap("Missing mint receipt");
        if (existing.seed != seed or recipient.to != to or recipient.tier != tier) return #err(#rejected("Conflicting mint replay"));
        return #ok id;
      };
      case null {};
    };
    var attempt = 0;
    while (attempt < 32) {
      let candidate = Art.generate(seed, tier, attempt);
      if (not Art.valid(candidate) or silhouettes.containsKey(candidate.silhouetteHash) or artworkHashes.containsKey(candidate.pixelHash)) {
        attempt += 1;
        continue;
      };
      let id = counters.nextId;
      counters.nextId += 1;
      tokens.add(id, { id; var owner = to; traits = candidate.traits; createdAt = Time.now(); paymentId = key });
      artwork.add(id, candidate);
      mintKeys.add(key, id);
      mintRecipients.add(key, { to; tier });
      silhouettes.add(candidate.silhouetteHash, candidate.silhouette);
      artworkHashes.add(candidate.pixelHash, candidate.svg.encodeUtf8());
      certifyImage(id, candidate.svg.encodeUtf8());
      ignore appendBlock("7mint", #Map([
        ("op", #Text "7mint"), ("tid", #Nat id), ("to", accountValue({ owner = to; subaccount = null })),
      ]));
      return #ok id;
    };
    #err(#rejected("No distinct valid artwork after 32 candidates; paid purchase remains recoverable"));
  };

  public query func getMintByKey(key : Text) : async ?Nat { mintKeys.get(key) };
  public query func getNft(id : Nat) : async ?NftPublic { tokens.get(id).map(toPublic) };
  public query func getArtwork(id : Nat) : async ?Art.Artwork { artwork.get(id) };
  public query func listPage(before : ?Nat, limit : Nat) : async [NftPublic] {
    let out = List.empty<NftPublic>();
    var i = Nat.min(before ?? counters.nextId, counters.nextId);
    while (i > 0 and out.size() < Nat.min(limit, 100)) {
      i -= 1;
      switch (tokens.get(i)) { case (?rec) out.add(toPublic(rec)); case null {} };
    };
    out.toArray();
  };

  func certifyImage(id : Nat, bytes : Blob) {
    let path : CertTree.Path = ["http_expr", "nft", Text.encodeUtf8(id.toText() # ".svg"), "<$>"];
    putHttp(path, imageResponse(bytes));
    putHttp(path, methodNotAllowed());
    certified.setCertifiedData();
  };

  func httpHeaders(response : HttpResponse) : [(Text, Value)] {
    response.headers.map<HeaderField, (Text, Value)>(func ((name, value)) = (name.toLower(), #Text value)).concat([
      (":ic-cert-status", #Nat(response.status_code.toNat())),
    ]);
  };

  func httpHash(response : HttpResponse) : Blob {
    sha(repHash(#Map(httpHeaders(response))).toArray().concat(sha(response.body).toArray()).toBlob());
  };

  func httpPath(path : CertTree.Path, response : HttpResponse) : CertTree.Path {
    let suffix : CertTree.Path = [sha(Certification.expression.encodeUtf8()), "", httpHash(response)];
    path.concat(suffix);
  };

  func putHttp(path : CertTree.Path, response : HttpResponse) {
    certified.put(httpPath(path, response), "");
  };

  // ---------------------------------------------------------------------------
  // ICRC-7 standard reads
  // ---------------------------------------------------------------------------

  public query func icrc7_name() : async Text { "NFT Bonsai" };
  public query func icrc7_symbol() : async Text { "BONSAI" };
  public query func icrc7_description() : async ?Text {
    ?"Generative pixel-art bonsai NFTs minted on the Internet Computer.";
  };
  public query func icrc7_logo() : async ?Text { null };
  public query func icrc7_total_supply() : async Nat { counters.nextId };
  public query func icrc7_supply_cap() : async ?Nat { null };
  public query func icrc7_max_query_batch_size() : async ?Nat { ?100 };
  public query func icrc7_max_update_batch_size() : async ?Nat { ?100 };
  public query func icrc7_default_take_value() : async ?Nat { ?50 };
  public query func icrc7_max_take_value() : async ?Nat { ?200 };
  public query func icrc7_max_memo_size() : async ?Nat { ?32 };

  // ICRC-10 standards discovery — wallets (e.g. Oisy) call this to recognise
  // the collection as ICRC-7 compliant.
  public query func icrc10_supported_standards() : async [{ name : Text; url : Text }] {
    [
      { name = "ICRC-7"; url = "https://github.com/dfinity/ICRC/tree/main/ICRCs/ICRC-7" },
      { name = "ICRC-10"; url = "https://github.com/dfinity/ICRC/tree/main/ICRCs/ICRC-10" },
      { name = "ICRC-37"; url = "https://github.com/dfinity/ICRC/tree/main/ICRCs/ICRC-37" },
      { name = "ICRC-3"; url = "https://github.com/dfinity/ICRC/tree/main/ICRCs/ICRC-3" },
    ];
  };

  public query func icrc7_collection_metadata() : async [(Text, Value)] {
    [
      ("icrc7:name", #Text "NFT Bonsai"),
      ("icrc7:symbol", #Text "BONSAI"),
      ("icrc7:description", #Text "Generative pixel-art bonsai NFTs minted on the Internet Computer."),
      ("icrc7:total_supply", #Nat(counters.nextId)),
    ];
  };

  public query func icrc7_owner_of(ids : [Nat]) : async [?Account] {
    ids.map<Nat, ?Account>(func id {
      switch (tokens.get(id)) {
        case (?rec) ?{ owner = rec.owner; subaccount = null };
        case null null;
      };
    });
  };

  public query func icrc7_balance_of(accounts : [Account]) : async [Nat] {
    accounts.map(func acc {
      var n : Nat = 0;
      for ((_, rec) in tokens.entries()) {
        if (rec.owner == acc.owner) { n += 1 };
      };
      n;
    });
  };

  public query func icrc7_tokens(prev : ?Nat, take : ?Nat) : async [Nat] {
    let limit : Nat = switch (take) { case (?n) n; case null 50 };
    let start : Nat = switch (prev) { case (?p) p + 1; case null 0 };
    let out = List.empty<Nat>();
    var i = start;
    while (i < counters.nextId and out.size() < limit) {
      switch (tokens.get(i)) { case (?_) out.add(i); case null {} };
      i += 1;
    };
    out.toArray();
  };

  public query func icrc7_tokens_of(account : Account, prev : ?Nat, take : ?Nat) : async [Nat] {
    let limit : Nat = switch (take) { case (?n) n; case null 50 };
    let start : Nat = switch (prev) { case (?p) p + 1; case null 0 };
    let out = List.empty<Nat>();
    var i = start;
    while (i < counters.nextId and out.size() < limit) {
      switch (tokens.get(i)) {
        case (?rec) { if (rec.owner == account.owner) { out.add(i) } };
        case null {};
      };
      i += 1;
    };
    out.toArray();
  };

  public query func icrc7_token_metadata(ids : [Nat]) : async [?[(Text, Value)]] {
    ids.map<Nat, ?[(Text, Value)]>(func id {
      switch (tokens.get(id)) {
        case null null;
        case (?rec) ?Array.concat([
          ("icrc7:metadata:uri:image", #Text(imageUri(id))),
          ("bonsai:payment_id", #Text(rec.paymentId)),
          ("bonsai:created_at_ns", #Int(rec.createdAt)),
          ("bonsai:traits", #Map(traitsAsValue(rec.traits))),
        ], switch (artwork.get(id)) {
          case null [];
          case (?a) [
            ("bonsai:generation_version", #Nat(a.version)),
            ("bonsai:seed", #Blob(a.seed)),
            ("bonsai:accepted_attempt", #Nat(a.attempt)),
            ("bonsai:artwork_hash", #Blob(a.pixelHash)),
            ("bonsai:silhouette_hash", #Blob(a.silhouetteHash)),
          ];
        });
      };
    });
  };

  func imageUri(id : Nat) : Text {
    "https://" # canisterId.toText() # ".icp.net/nft/" # id.toText() # ".svg";
  };

  func traitsAsValue(t : BonsaiTraits) : [(Text, Value)] {
    [
      ("trunkStyle",  #Nat(t.trunkStyle.toNat())),
      ("branchCount", #Nat(t.branchCount.toNat())),
      ("leafColor",   #Nat(t.leafColor.toNat())),
      ("leafDensity", #Nat(t.leafDensity.toNat())),
      ("potStyle",    #Nat(t.potStyle.toNat())),
      ("potColor",    #Nat(t.potColor.toNat())),
      ("ground",      #Nat(t.ground.toNat())),
      ("season",      #Nat(t.season.toNat())),
      ("sky",         #Nat(t.sky.toNat())),
      ("moonPhase",   #Nat(t.moonPhase.toNat())),
      ("specialElem", #Nat(t.specialElem.toNat())),
      ("trunkThick",  #Nat(t.trunkThick.toNat())),
      ("trunkColor",  #Nat(t.trunkColor.toNat())),
    ];
  };

  // ---------------------------------------------------------------------------
  // Canonical SVGs and error responses share the ICRC-3 certified tree.
  // ---------------------------------------------------------------------------

  public type HeaderField = (Text, Text);

  public type HttpRequest = {
    method : Text;
    url : Text;
    headers : [HeaderField];
    body : Blob;
  };

  public type HttpResponse = {
    status_code : Nat16;
    headers : [HeaderField];
    body : Blob;
  };

  func parseTokenId(url : Text) : ?Nat {
    let noQuery = url.split(#char '?').toArray();
    if (noQuery.size() == 0) { return null };
    let path = noQuery[0];
    let ?suffix = path.stripStart(#text "/nft/") else return null;
    let ?number = suffix.stripEnd(#text ".svg") else return null;
    let ?id = Nat.fromText(number) else return null;
    if (path != "/nft/" # id.toText() # ".svg") return null;
    ?id;
  };

  func httpNotFound() : HttpResponse {
    {
      status_code = 404;
      headers = [("Content-Type", "text/plain"), ("IC-CertificateExpression", Certification.expression)];
      body = Text.encodeUtf8("not found");
    };
  };

  func imageResponse(body : Blob) : HttpResponse {
    {
      status_code = 200; body;
      headers = [
        ("Content-Type", "image/svg+xml"),
        ("Cache-Control", "public, max-age=31536000, immutable"),
        ("IC-CertificateExpression", Certification.expression),
      ];
    };
  };

  func methodNotAllowed() : HttpResponse {
    {
      status_code = 405; body = "method not allowed";
      headers = [("Content-Type", "text/plain"), ("Allow", "GET"), ("IC-CertificateExpression", Certification.expression)];
    };
  };

  public query func http_request(req : HttpRequest) : async HttpResponse {
    let path = req.url.split(#char '?').toArray()[0];
    var expressionPath : [Text] = ["http_expr", "", "<*>"];
    let rec = switch (parseTokenId(req.url)) { case (?id) tokens.get(id); case null null };
    let response = switch (rec) {
      case (?token) {
        expressionPath := ["http_expr", "nft", token.id.toText() # ".svg", "<$>"];
        if (req.method != "GET") methodNotAllowed()
        else imageResponse((artwork.get(token.id) ?? Runtime.trap("Missing canonical artwork")).svg.encodeUtf8());
      };
      case null { if (req.method != "GET") methodNotAllowed() else httpNotFound() };
    };
    let labels = expressionPath.map(Text.encodeUtf8);
    let paths = List.empty<CertTree.Path>();
    paths.add(httpPath(labels, response));
    if (Option.isNull(rec)) {
      // Wildcard proofs also exclude exact matches and more-specific wildcards.
      var prefix : CertTree.Path = ["http_expr"];
      let wildcard : CertTree.Path = ["<*>"];
      let trailingWildcard : CertTree.Path = ["", "<*>"];
      let empty : CertTree.Path = [""];
      let exact : CertTree.Path = ["<$>"];
      paths.add(prefix.concat(wildcard));
      for (segment in path.split(#char '/')) {
        if (segment != "") {
          prefix := prefix.concat([segment.encodeUtf8()]);
          paths.add(prefix.concat(wildcard));
          paths.add(prefix.concat(trailingWildcard));
        };
      };
      if (path.endsWith(#text "/")) prefix := prefix.concat(empty);
      paths.add(prefix.concat(exact));
    };
    let witness = certified.encodeWitness(certified.reveals(paths.values()));
    let certHeaders = switch (CertifiedData.getCertificate()) {
      case (?certificate) [("IC-Certificate", "certificate=:" # Certification.base64(certificate) # ":, tree=:" # Certification.base64(witness) # ":, expr_path=:" # Certification.base64(Certification.expressionPath(expressionPath)) # ":, version=2")];
      case null [];
    };
    { response with headers = response.headers.concat(certHeaders) };
  };

  // ---------------------------------------------------------------------------
  // Transfer (basic single-token; no atomic batch, no approvals)
  // ---------------------------------------------------------------------------

  public type TransferResult = { #Ok : Nat; #Err : TransferError };

  public shared ({ caller }) func icrc7_transfer(args : [TransferArg]) : async [?TransferResult] {
    requireAuth(caller);
    args.map<TransferArg, ?TransferResult>(func arg {
      ?(switch (tokens.get(arg.token_id)) {
        case null { #Err(#NonExistingTokenId) };
        case (?rec) {
          if (rec.owner != caller) { #Err(#Unauthorized) }
          else if (arg.to.owner.isAnonymous()) { #Err(#InvalidRecipient) }
          else {
            rec.owner := arg.to.owner;
            tokenApprovals.remove(arg.token_id);
            ignore appendBlock("7xfer", #Map([
              ("op", #Text "7xfer"),
              ("tid", #Nat(arg.token_id)),
              ("from", accountValue({ owner = caller; subaccount = arg.from_subaccount })),
              ("to", accountValue(arg.to)),
            ]));
            #Ok(arg.token_id);
          };
        };
      });
    });
  };

  // ---------------------------------------------------------------------------
  // ICRC-37 — approvals & transfer_from
  // ---------------------------------------------------------------------------

  public query func icrc37_max_approvals_per_token_or_collection() : async ?Nat {
    ?maxApprovals;
  };

  public query func icrc37_max_revoke_approvals() : async ?Nat { ?100 };

  public shared ({ caller }) func icrc37_approve_tokens(args : [ApproveTokenArg]) : async [?ApproveTokenResult] {
    requireAuth(caller);
    args.map<ApproveTokenArg, ?ApproveTokenResult>(func arg {
      let info = arg.approval_info;
      ?(switch (tokens.get(arg.token_id)) {
        case null #Err(#NonExistingTokenId);
        case (?rec) {
          if (rec.owner != caller) #Err(#Unauthorized)
          else if (info.spender.owner == caller or info.spender.owner.isAnonymous()) #Err(#InvalidSpender)
          else {
            putTokenApproval(arg.token_id, info);
            let idx = appendBlock("37approve", #Map([
              ("op", #Text "37approve"),
              ("tid", #Nat(arg.token_id)),
              ("from", accountValue({ owner = rec.owner; subaccount = info.from_subaccount })),
              ("spender", accountValue(info.spender)),
            ]));
            #Ok(idx);
          };
        };
      });
    });
  };

  public shared ({ caller }) func icrc37_approve_collection(args : [ApproveCollectionArg]) : async [?ApproveCollectionResult] {
    requireAuth(caller);
    args.map<ApproveCollectionArg, ?ApproveCollectionResult>(func arg {
      let info = arg.approval_info;
      ?(if (info.spender.owner == caller or info.spender.owner.isAnonymous()) #Err(#InvalidSpender)
        else {
          putCollectionApproval(caller, info);
          let idx = appendBlock("37approve_coll", #Map([
            ("op", #Text "37approve_coll"),
            ("from", accountValue({ owner = caller; subaccount = info.from_subaccount })),
            ("spender", accountValue(info.spender)),
          ]));
          #Ok(idx);
        });
    });
  };

  public shared ({ caller }) func icrc37_revoke_token_approvals(args : [RevokeTokenApprovalArg]) : async [?RevokeTokenApprovalResult] {
    requireAuth(caller);
    args.map<RevokeTokenApprovalArg, ?RevokeTokenApprovalResult>(func arg {
      ?(switch (tokens.get(arg.token_id)) {
        case null #Err(#NonExistingTokenId);
        case (?rec) {
          if (rec.owner != caller) #Err(#Unauthorized)
          else {
            let existing = switch (tokenApprovals.get(arg.token_id)) { case (?a) a; case null [] };
            switch (arg.spender) {
              case null {
                if (existing.size() == 0) #Err(#ApprovalDoesNotExist)
                else {
                  tokenApprovals.remove(arg.token_id);
                  #Ok(appendBlock("37revoke", #Map([
                    ("op", #Text "37revoke"),
                    ("tid", #Nat(arg.token_id)),
                  ])));
                };
              };
              case (?s) {
                let remaining = existing.filter(func a { not accountEqual(a.spender, s) });
                if (remaining.size() == existing.size()) #Err(#ApprovalDoesNotExist)
                else {
                  if (remaining.size() == 0) tokenApprovals.remove(arg.token_id)
                  else tokenApprovals.add(arg.token_id, remaining);
                  #Ok(appendBlock("37revoke", #Map([
                    ("op", #Text "37revoke"),
                    ("tid", #Nat(arg.token_id)),
                    ("spender", accountValue(s)),
                  ])));
                };
              };
            };
          };
        };
      });
    });
  };

  public shared ({ caller }) func icrc37_revoke_collection_approvals(args : [RevokeCollectionApprovalArg]) : async [?RevokeCollectionApprovalResult] {
    requireAuth(caller);
    args.map<RevokeCollectionApprovalArg, ?RevokeCollectionApprovalResult>(func arg {
      let existing = switch (collectionApprovals.get(caller)) { case (?a) a; case null [] };
      ?(switch (arg.spender) {
        case null {
          if (existing.size() == 0) #Err(#ApprovalDoesNotExist)
          else {
            collectionApprovals.remove(caller);
            #Ok(appendBlock("37revoke_coll", #Map([("op", #Text "37revoke_coll")])));
          };
        };
        case (?s) {
          let remaining = existing.filter(func a { not accountEqual(a.spender, s) });
          if (remaining.size() == existing.size()) #Err(#ApprovalDoesNotExist)
          else {
            if (remaining.size() == 0) collectionApprovals.remove(caller)
            else collectionApprovals.add(caller, remaining);
            #Ok(appendBlock("37revoke_coll", #Map([
              ("op", #Text "37revoke_coll"),
              ("spender", accountValue(s)),
            ])));
          };
        };
      });
    });
  };

  public query func icrc37_is_approved(args : [IsApprovedArg]) : async [Bool] {
    let now = nowNanos();
    args.map(func arg {
      switch (tokens.get(arg.token_id)) {
        case null false;
        case (?rec) isSpenderApproved(arg.token_id, rec.owner, arg.spender, now);
      };
    });
  };

  public query func icrc37_get_token_approvals(token_id : Nat, _prev : ?TokenApproval, take : ?Nat) : async [TokenApproval] {
    let limit : Nat = switch (take) { case (?n) if (n > 200) 200 else n; case null 50 };
    let list = switch (tokenApprovals.get(token_id)) { case (?a) a; case null [] };
    let out = List.empty<TokenApproval>();
    for (a in list.values()) {
      if (out.size() < limit) { out.add({ token_id; approval_info = toApprovalInfo(a) }) };
    };
    out.toArray();
  };

  public query func icrc37_get_collection_approvals(owner : Account, _prev : ?CollectionApproval, take : ?Nat) : async [CollectionApproval] {
    let limit : Nat = switch (take) { case (?n) if (n > 200) 200 else n; case null 50 };
    let list = switch (collectionApprovals.get(owner.owner)) { case (?a) a; case null [] };
    let out = List.empty<CollectionApproval>();
    for (a in list.values()) {
      if (out.size() < limit) { out.add(toApprovalInfo(a)) };
    };
    out.toArray();
  };

  public shared ({ caller }) func icrc37_transfer_from(args : [TransferFromArg]) : async [?TransferFromResult] {
    requireAuth(caller);
    let now = nowNanos();
    args.map<TransferFromArg, ?TransferFromResult>(func arg {
      let spender : Account = { owner = caller; subaccount = arg.spender_subaccount };
      ?(switch (tokens.get(arg.token_id)) {
        case null #Err(#NonExistingTokenId);
        case (?rec) {
          if (not accountEqual({ owner = rec.owner; subaccount = null }, arg.from)) #Err(#Unauthorized)
          else if (arg.to.owner.isAnonymous()) #Err(#InvalidRecipient)
          else if (not isSpenderApproved(arg.token_id, rec.owner, spender, now)) #Err(#Unauthorized)
          else {
            rec.owner := arg.to.owner;
            tokenApprovals.remove(arg.token_id);
            let idx = appendBlock("7xfer", #Map([
              ("op", #Text "37xfer_from"),
              ("tid", #Nat(arg.token_id)),
              ("from", accountValue(arg.from)),
              ("to", accountValue(arg.to)),
              ("spender", accountValue(spender)),
            ]));
            #Ok(idx);
          };
        };
      });
    });
  };

  // ---------------------------------------------------------------------------
  // ICRC-3 — transaction log
  // ---------------------------------------------------------------------------

  public query func icrc3_get_blocks(args : GetBlocksArgs) : async GetBlocksResult {
    let out = List.empty<{ id : Nat; block : Value }>();
    label scan for (req in args.values()) {
      var i = req.start;
      let end = req.start + req.length;
      while (i < end and i < counters.blockCount) {
        if (out.size() >= 1000) { break scan };
        switch (blocks.get(i)) {
          case (?b) out.add({ id = i; block = b });
          case null {};
        };
        i += 1;
      };
    };
    { log_length = counters.blockCount; blocks = out.toArray(); archived_blocks = [] };
  };

  public query func icrc3_get_archives(_args : GetArchivesArgs) : async [ArchiveInfo] {
    [];
  };

  public query func icrc3_get_tip_certificate() : async ?DataCertificate {
    let ?certificate = CertifiedData.getCertificate() else return null;
    if (counters.blockCount == 0) return null;
    let paths : [CertTree.Path] = [["last_block_index"], ["last_block_hash"]];
    ?{ certificate; hash_tree = certified.encodeWitness(certified.reveals(paths.values())) };
  };

  public query func icrc3_supported_block_types() : async [{ block_type : Text; url : Text }] {
    let icrc7 = "https://github.com/dfinity/ICRC/tree/main/ICRCs/ICRC-7";
    let icrc37 = "https://github.com/dfinity/ICRC/tree/main/ICRCs/ICRC-37";
    [
      { block_type = "7mint"; url = icrc7 },
      { block_type = "7xfer"; url = icrc7 },
      { block_type = "37approve"; url = icrc37 },
      { block_type = "37approve_coll"; url = icrc37 },
      { block_type = "37revoke"; url = icrc37 },
      { block_type = "37revoke_coll"; url = icrc37 },
    ];
  };

  // ---------------------------------------------------------------------------
  // Convenience read for the frontend gallery
  // ---------------------------------------------------------------------------

  public query func listRecent(limit : Nat) : async [NftPublic] {
    let actualLimit = if (limit > 200) 200 else limit;
    let out = List.empty<NftPublic>();
    if (counters.nextId == 0) { return [] };
    // Walk newest first.
    var i : Nat = counters.nextId;
    while (i > 0 and out.size() < actualLimit) {
      i -= 1;
      switch (tokens.get(i)) {
        case (?rec) out.add(toPublic(rec));
        case null {};
      };
    };
    out.toArray();
  };

  func toPublic(rec : NftRecord) : NftPublic {
    {
      id = rec.id;
      owner = rec.owner;
      traits = rec.traits;
      createdAt = rec.createdAt;
      paymentId = rec.paymentId;
    };
  };

  func initializeCertification<system>() {
    putHttp(["http_expr", "", "<*>"], httpNotFound());
    putHttp(["http_expr", "", "<*>"], methodNotAllowed());
    certified.setCertifiedData();
  };
};
