/// Named price tiers. Each payment method has five ascending anchors (euro for card, whole ICP, whole tokens);
/// any whole amount from the first to the last anchor is valid and mints the art of the highest tier
/// whose anchor it reaches (see backend/src/lib/Bonsai.mo).
import Blob "mo:core/Blob";
module {
  public let NAMES : [Text] = ["Sprout", "Grove", "Jade", "Lacquer", "Imperial"];
  public let EUR : [Nat] = [49, 99, 199, 499, 999];
  public let ICP : [Nat] = [9, 19, 49, 99, 249];
  public let TOKEN : [Nat] = [9_000, 19_000, 49_000, 99_000, 249_000];
  public let COUNT : Nat = 5;
  public let MIN_EUR : Nat = 49;
  public let MAX_EUR : Nat = 999;
  // ICP and the token both use 8 decimals.
  public let UNIT : Nat = 100_000_000;
  // Bounds reject unit mistakes (e8s instead of whole units) in controller updates.
  public let MAX_ANCHOR : Nat = 1_000_000_000;

  public func valid(eur : Nat) : Bool { eur >= MIN_EUR and eur <= MAX_EUR };

  public func inRange(amount : Nat, anchors : [Nat]) : Bool {
    anchors.size() == COUNT and amount >= anchors[0] and amount <= anchors[COUNT - 1];
  };

  public func validAnchors(anchors : [Nat]) : Bool {
    if (anchors.size() != COUNT or anchors[0] == 0 or anchors[COUNT - 1] > MAX_ANCHOR) return false;
    var i = 1;
    while (i < COUNT) { if (anchors[i] <= anchors[i - 1]) return false; i += 1 };
    true;
  };

  public func tierIn(amount : Nat, anchors : [Nat]) : Nat {
    var tier = 0;
    for (i in anchors.keys()) { if (amount >= anchors[i]) tier := i };
    tier;
  };

  public func tierOf(eur : Nat) : Nat { tierIn(eur, EUR) };

  // 8/256 ≈ 3.1% of mints get a lucky bloom: one art tier up for free. Token payments get double odds (16/256).
  public func lucky(seed : Blob, doubled : Bool) : Bool {
    let bytes = seed.toArray();
    bytes.size() == 32 and bytes[31] < (if doubled 16 else 8);
  };
  public func artTier(tier : Nat, isLucky : Bool) : Nat {
    if (isLucky and tier + 1 < COUNT) tier + 1 else tier;
  };
}
