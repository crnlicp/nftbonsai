import Map "mo:core/Map";
import Nat "mo:core/Nat";
import Array "mo:core/Array";
import Set "mo:core/Set";
import Principal "mo:core/Principal";
import Runtime "mo:core/Runtime";
import Types "../LikeTypes";

mixin (likes : Types.State) {
  type LikeNft = actor { getNft : shared query Nat -> async ?{ id : Nat } };

  func likeStat(nftId : Nat, who : Principal) : Types.Stat {
    switch (likes.likers.get(nftId)) {
      case (?set) ({ count = set.size(); liked = set.contains(who) });
      case null ({ count = 0; liked = false });
    };
  };

  /// Like counts for up to 100 bonsai, plus whether the caller liked each.
  public shared query ({ caller }) func likeStats(ids : [Nat]) : async [Types.Stat] {
    if (ids.size() > 100) Runtime.trap("At most 100 ids");
    ids.map(func(id : Nat) : Types.Stat = likeStat(id, caller));
  };

  /// Idempotently likes (`liked = true`) or unlikes a bonsai for the signed-in caller.
  public shared ({ caller }) func setLike(nftId : Nat, liked : Bool) : async { #ok : Types.Stat; #err : Text } {
    if (caller.isAnonymous()) return #err("Sign in to like bonsai");
    if (liked and not likes.likers.containsKey(nftId)) {
      // Verify the token once; later likes for this id skip the inter-canister call.
      let nft : LikeNft = actor (Runtime.envVar<system>("PUBLIC_CANISTER_ID:icrc7") ?? Runtime.trap("Missing NFT canister ID"));
      let found = try { await nft.getNft(nftId) } catch (_) { return #err("Could not reach the NFT collection, try again") };
      if (found == null) return #err("Unknown bonsai");
      if (not likes.likers.containsKey(nftId)) likes.likers.add(nftId, Set.empty<Principal>());
    };
    switch (likes.likers.get(nftId)) {
      case (?set) {
        if (liked) set.add(caller) else set.remove(caller);
      };
      case null {};
    };
    #ok(likeStat(nftId, caller));
  };
}
