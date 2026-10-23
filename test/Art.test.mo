import Art "../icrc7/lib/Art";
import Array "mo:core/Array";
import Blob "mo:core/Blob";
import Nat "mo:core/Nat";
import Map "mo:core/Map";
import Text "mo:core/Text";
import Nat8 "mo:core/Nat8";

let hashes = Map.empty<Blob, Nat>();
let imageHashes = Map.empty<Blob, Nat>();
var index = 0;
while (index < 25) {
  let seed = Art.hash(Text.encodeUtf8("bonsai-regression-" # index.toText()));
  let tier = index % 5;
  let art = Art.generate(seed, tier, 0);
  assert Art.valid(art);
  assert art.version == 8;
  // Each named tier fixes branch count, canopy density and pot colour.
  assert art.traits.branchCount.toNat() == 3 + tier;
  assert art.traits.leafDensity.toNat() == [0, 0, 1, 1, 2][tier];
  assert art.traits.potColor.toNat() == [0, 1, 3, 7, 5][tier];
  assert not hashes.containsKey(art.silhouetteHash);
  assert not imageHashes.containsKey(art.pixelHash);
  hashes.add(art.silhouetteHash, index);
  imageHashes.add(art.pixelHash, index);
  let occupied = Blob.toArray(art.silhouette).filter(func cell = cell != 0).size();
  assert occupied >= 180 and occupied <= 1800;
  // Semi-cascade sweeps past the pot sideways; Art.valid already rejects downward trunk/branch segments.
  if (art.traits.trunkStyle == 3) assert art.skeleton.any(func s = s.end.x >= 50);
  // The 7x7 white pot mark stays at x 28..34, y 53..59 and rests on the pot's bottom row.
  let pixels = Blob.toArray(art.pixels);
  var markCells = 0;
  var bottomCells = 0;
  var cell = 0;
  while (cell < 4096) {
    if (pixels[cell] == 10) {
      let x = cell % 64;
      let y = cell / 64;
      assert x >= 28 and x <= 34 and y >= 53 and y <= 59;
      markCells += 1;
      if (y == 59) bottomCells += 1;
    };
    cell += 1;
  };
  assert markCells >= 5 and bottomCells > 0;
  // Crowns reach a few pixels below the top edge.
  let top = Blob.toArray(art.silhouette).findIndex(func cell = cell != 0);
  switch (top) {
    case (?first) assert first / 64 >= 2 and first / 64 <= 8;
    case null assert false;
  };
  if (index < 25) {
    assert art == Art.generate(seed, tier, 0);
    assert art.silhouetteHash != Art.generate(seed, tier, 1).silhouetteHash;
  };
  index += 1;
};
// Full style×tier coverage and 10k-scale uniqueness live in tests/canisters.test.mjs (WASI tests cannot GC mid-run).
