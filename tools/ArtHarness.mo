import Art "../icrc7/lib/Art";
import Array "mo:core/Array";
import Blob "mo:core/Blob";
import Nat "mo:core/Nat";
import Nat8 "mo:core/Nat8";
import Text "mo:core/Text";
import Runtime "mo:core/Runtime";

persistent actor {
  public query func batch(start : Nat, count : Nat) : async [{
    shape : Blob; pixels : Blob; valid : Bool; style : Nat; tier : Nat; svg : Text;
    sky : Nat; moonPhase : Nat; season : Nat; specialElem : Nat;
  }] {
    if (count > 20) Runtime.trap("At most 20 samples per batch");
    Array.tabulate(count, func offset {
      let index = start + offset;
      let seed = Art.hash(Text.encodeUtf8("bonsai-regression-" # index.toText()));
      let tier = index % 5;
      let art = Art.generate(seed, tier, 0);
      {
        shape = art.silhouette; pixels = art.pixelHash; valid = Art.valid(art);
        style = art.traits.trunkStyle.toNat(); tier;
        svg = if (index < 200) art.svg else "";
        sky = art.traits.sky.toNat(); moonPhase = art.traits.moonPhase.toNat();
        season = art.traits.season.toNat(); specialElem = art.traits.specialElem.toNat();
      };
    });
  };
}
