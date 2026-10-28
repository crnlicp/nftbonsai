import Tiers "../src/lib/Tiers";
import Array "mo:core/Array";
import Blob "mo:core/Blob";
import Nat8 "mo:core/Nat8";

assert Tiers.validAnchors(Tiers.EUR) and Tiers.validAnchors(Tiers.ICP) and Tiers.validAnchors(Tiers.TOKEN);
assert not Tiers.validAnchors([1, 2, 3, 4]);
assert not Tiers.validAnchors([0, 2, 3, 4, 5]);
assert not Tiers.validAnchors([1, 2, 2, 4, 5]);
assert not Tiers.validAnchors([1, 2, 3, 4, Tiers.MAX_ANCHOR + 1]);

assert Tiers.tierIn(9, Tiers.ICP) == 0 and Tiers.tierIn(18, Tiers.ICP) == 0;
assert Tiers.tierIn(19, Tiers.ICP) == 1 and Tiers.tierIn(248, Tiers.ICP) == 3 and Tiers.tierIn(249, Tiers.ICP) == 4;
assert Tiers.tierIn(49_000, Tiers.TOKEN) == 2 and Tiers.tierIn(98_999, Tiers.TOKEN) == 2;
assert Tiers.inRange(9, Tiers.ICP) and Tiers.inRange(249, Tiers.ICP);
assert not Tiers.inRange(8, Tiers.ICP) and not Tiers.inRange(250, Tiers.ICP);
assert Tiers.tierOf(49) == 0 and Tiers.tierOf(999) == 4;

func seed(last : Nat) : Blob = Blob.fromArray(Array.tabulate<Nat8>(32, func i = if (i == 31) Nat8.fromNat(last) else 0));
assert Tiers.lucky(seed(7), false) and not Tiers.lucky(seed(8), false);
assert Tiers.lucky(seed(15), true) and not Tiers.lucky(seed(16), true);
assert Tiers.artTier(4, true) == 4 and Tiers.artTier(1, true) == 2 and Tiers.artTier(1, false) == 1;
