/// Named price tiers. Any whole-euro price from MIN_EUR to MAX_EUR is valid;
/// it mints the art of the highest tier whose anchor it reaches (see backend/src/lib/Bonsai.mo).
import Blob "mo:core/Blob";
module {
  public let NAMES : [Text] = ["Sprout", "Grove", "Jade", "Lacquer", "Imperial"];
  public let EUR : [Nat] = [49, 99, 199, 499, 999];
  public let COUNT : Nat = 5;
  public let MIN_EUR : Nat = 49;
  public let MAX_EUR : Nat = 999;
  // ICP quotes are rounded up to 0.0001 ICP.
  public let E8S_STEP : Nat = 10_000;

  public func valid(eur : Nat) : Bool { eur >= MIN_EUR and eur <= MAX_EUR };

  public func tierOf(eur : Nat) : Nat {
    var tier = 0;
    for (i in EUR.keys()) { if (eur >= EUR[i]) tier := i };
    tier;
  };

  public func icpE8s(eur : Nat, e8sPerEur : Nat) : Nat {
    let raw = eur * e8sPerEur;
    (raw + E8S_STEP - 1) / E8S_STEP * E8S_STEP;
  };

  // 8/256 ≈ 3.1% of mints get a lucky bloom: one art tier up for free.
  public func lucky(seed : Blob) : Bool {
    let bytes = seed.toArray();
    bytes.size() == 32 and bytes[31] < 8;
  };
  public func artTier(tier : Nat, isLucky : Bool) : Nat {
    if (isLucky and tier + 1 < COUNT) tier + 1 else tier;
  };
}
