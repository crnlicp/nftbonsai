/// Deterministic bonsai trait generation.
///
/// Input is a seed blob (e.g. payment_id ++ caller_principal_blob ++
/// amount_le_bytes); output is a `BonsaiTraits` record. The mapping is pure
/// SHA-256 modulo the trait cardinality, so every replica produces identical
/// traits. V2 geometry is generated separately from the frozen seed.

import Blob "mo:core/Blob";
import Nat8 "mo:core/Nat8";
import Nat "mo:core/Nat";
import Sha256 "mo:sha2/Sha256";

import Types "../types";

module {

  // Cardinalities match Types.BonsaiTraits.
  let TRUNK_STYLE : Nat8 = 5;
  let LEAF_COLOR : Nat8 = 8;
  let POT_STYLE : Nat8 = 6;
  let GROUND : Nat8 = 5;
  let SEASON : Nat8 = 4;
  let SKY : Nat8 = 6;
  let MOON_PHASE : Nat8 = 9;
  let SPECIAL_ELEM : Nat8 = 8;
  let TRUNK_THICK : Nat8 = 3;
  let TRUNK_COLOR : Nat8 = 5;

  // Five named price tiers (Sprout, Grove, Jade, Lacquer, Imperial) map 1:1 to
  // art tiers 0..4. branchCount grows with the tier (fuller canopy), leafDensity
  // thickens, and the pot climbs an ascending "value" palette:
  // terracotta → stone → jade → lacquer blue → antique gold.
  public let TIERS : Nat = 5;
  let DENSITY_BY_TIER : [Nat8] = [0, 0, 1, 1, 2];
  let POT_BY_TIER : [Nat8] = [0, 1, 3, 7, 5];

  // The art tier deterministically drives the value-legible traits (canopy
  // fullness + pot colour); every other trait stays SHA-256-random for rarity.
  public func generateTraits(seed : Blob, artTier : Nat) : Types.BonsaiTraits {
    let hash : [Nat8] = Sha256.fromBlob(#sha256, seed).toArray();
    let tier = if (artTier >= TIERS) TIERS - 1 else artTier;
    {
      trunkStyle  = hash[0] % TRUNK_STYLE;
      branchCount = 3 + tier.toNat8();   // tier → 3..7 branches
      leafColor   = hash[2] % LEAF_COLOR;
      leafDensity = DENSITY_BY_TIER[tier];     // tier → canopy thickness
      potStyle    = hash[4] % POT_STYLE;
      potColor    = POT_BY_TIER[tier];         // tier → pot "value" palette
      ground      = hash[6] % GROUND;
      season      = hash[7] % SEASON;
      sky         = hash[8] % SKY;
      moonPhase   = hash[9] % MOON_PHASE;
      specialElem = hash[10] % SPECIAL_ELEM;
      trunkThick  = hash[11] % TRUNK_THICK;
      trunkColor  = hash[12] % TRUNK_COLOR;
    };
  };

}
