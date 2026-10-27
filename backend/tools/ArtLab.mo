import Art "../src/icrc7/lib/Art";
import Array "mo:core/Array";
import Blob "mo:core/Blob";
import Nat "mo:core/Nat";
import Nat8 "mo:core/Nat8";
import Runtime "mo:core/Runtime";

// Local-only preview canister (icp.yaml `local` environment): renders throwaway trees from caller-supplied randomness.
persistent actor {
  public query func preview(nonce : Blob, count : Nat) : async [{
    svg : Text; tier : Nat; style : Nat; leafColor : Nat; branchCount : Nat; valid : Bool;
  }] {
    if (count > 20) Runtime.trap("At most 20 previews per call");
    if (nonce.size() != 32) Runtime.trap("Nonce must be 32 bytes");
    let bytes = nonce.toArray();
    Array.tabulate(count, func index {
      let seed = Art.hash(bytes.concat([index.toNat8()]).toBlob());
      let tier = seed.toArray()[0].toNat() % 5;
      let art = Art.generate(seed, tier, 0);
      {
        svg = art.svg; tier; style = art.traits.trunkStyle.toNat(); leafColor = art.traits.leafColor.toNat();
        branchCount = art.traits.branchCount.toNat(); valid = Art.valid(art);
      };
    });
  };
}
