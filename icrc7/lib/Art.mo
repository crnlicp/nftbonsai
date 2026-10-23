import Array "mo:core/Array";
import Blob "mo:core/Blob";
import Char "mo:core/Char";
import Nat32 "mo:core/Nat32";
import Int "mo:core/Int";
import Nat "mo:core/Nat";
import Nat8 "mo:core/Nat8";
import Text "mo:core/Text";
import VarArray "mo:core/VarArray";
import Sha256 "mo:sha2/Sha256";
import Traits "../../backend/types";
import Bonsai "../../backend/lib/Bonsai";

module {
  public type Point = { x : Int; y : Int };
  public type Segment = { start : Point; end : Point; width : Int };
  public type Pad = { center : Point; rx : Int; ry : Int };
  public type Artwork = {
    version : Nat;
    seed : Blob;
    attempt : Nat;
    traits : Traits.BonsaiTraits;
    skeleton : [Segment];
    pads : [Pad];
    pixels : Blob;
    silhouette : Blob;
    pixelHash : Blob;
    silhouetteHash : Blob;
    svg : Text;
  };
  let BARK = ["#92400e", "#78350f", "#78716c", "#7c2d12", "#27272a"];
  let LEAF = ["#4d7c35", "#23543a", "#86a84b", "#b44736", "#c77732", "#c6a144", "#de9dad", "#9866b9"];
  let SKY = ["#fee5bd", "#c4deed", "#e6b8bf", "#202c43", "#9caeaf", "#415365"];
  let POT = ["#a0522d", "#9ca3af", "#334155", "#15803d", "#18181b", "#a16207", "#7c2d12", "#0369a1"];
  let GROUND = ["#6b5745", "#66815a", "#d6c4a0", "#e7e9e5", "#4d6741"];
  // Shading ramps mix each base colour towards a cool purple shadow or a warm highlight.
  // frontend/src/lib/growth.ts mirrors `mix` and the pot/soil layout exactly.
  let SHADOW = [24, 16, 40];
  let GLOW = [255, 244, 190];
  let HEX = ["0", "1", "2", "3", "4", "5", "6", "7", "8", "9", "a", "b", "c", "d", "e", "f"];
  // sin(k / 64 turn) * 1000
  let SINE : [Int] = [0, 98, 195, 290, 383, 471, 556, 634, 707, 773, 831, 882, 924, 957, 981, 995, 1000, 995, 981, 957, 924, 882, 831, 773, 707, 634, 556, 471, 383, 290, 195, 98, 0, -98, -195, -290, -383, -471, -556, -634, -707, -773, -831, -882, -924, -957, -981, -995, -1000, -995, -981, -957, -924, -882, -831, -773, -707, -634, -556, -471, -383, -290, -195, -98];

  // Palette slots.
  let SKY_C : Nat8 = 0;
  let GROUND_C : Nat8 = 1;
  let POT_C : Nat8 = 2;
  let POT_LIP : Nat8 = 3;
  let BARK_OUTLINE : Nat8 = 4;
  let BARK_C : Nat8 = 5;
  let LEAF_OUTLINE : Nat8 = 6;
  let LEAF_C : Nat8 = 7;
  let ACCENT : Nat8 = 8;
  let LIGHT : Nat8 = 9;
  let MARK : Nat8 = 10;
  let POT_LIGHT : Nat8 = 11;
  let POT_SHADE : Nat8 = 12;
  let POT_DARK : Nat8 = 13;
  let SOIL : Nat8 = 14;
  let MOSS : Nat8 = 15;
  let MOSS_LIGHT : Nat8 = 16;
  let GROUND_SHADOW : Nat8 = 17;
  let BARK_SHADOW : Nat8 = 18;
  let BARK_LIGHT : Nat8 = 19;
  let LEAF_SHADOW : Nat8 = 20;
  let LEAF_LIGHT : Nat8 = 21;
  let LEAF_HIGHLIGHT : Nat8 = 22;
  let BARK_HIGHLIGHT : Nat8 = 23;
  let LIGHT_RIM : Nat8 = 24;

  func clamp(n : Int, lo : Int, hi : Int) : Int { Int.max(lo, Int.min(n, hi)) };
  func point(x : Int, y : Int) : Point { { x; y } };
  public func hash(bytes : Blob) : Blob { Sha256.fromBlob(#sha256, bytes) };

  func nibble(c : Char) : Nat {
    let value = c.toNat32().toNat();
    if (value >= 97) value - 87 else value - 48;
  };

  /// Blends `#rrggbb` towards `target` by `percent`/100 with integer floor rounding.
  public func mix(color : Text, target : [Nat], percent : Nat) : Text {
    let chars = color.toArray();
    var out = "#";
    let weight = Nat.min(percent, 100);
    let keep = Int.abs(100 - weight);
    var channel = 0;
    while (channel < 3) {
      let value = nibble(chars[channel * 2 + 1]) * 16 + nibble(chars[channel * 2 + 2]);
      let blended = (value * keep + target[channel] * weight) / 100;
      out #= HEX[blended / 16] # HEX[blended % 16];
      channel += 1;
    };
    out;
  };

  /// Linearly interpolated sine of `angle` (1/64000 turns), scaled to ±1000.
  func sine(angle : Int) : Int {
    let a = Int.abs(angle) % 64000;
    let index = Int.abs(a / 1000);
    let frac = a % 1000;
    let value = (SINE[index] * (1000 - frac) + SINE[(index + 1) % 64] * frac) / 1000;
    if (angle < 0) -value else value;
  };

  func isqrt(n : Int) : Int {
    if (n <= 0) return 0;
    var r : Int = 0;
    while ((r + 1) * (r + 1) <= n) r += 1;
    r;
  };

  // Pot profile rows y 48..61 as (left, right): a wide lip over a deep body whose bottom steps in to a foot.
  let POT_ROWS : [(Int, Int)] = [(16, 46), (14, 48), (14, 48), (16, 46), (16, 46), (16, 46), (16, 46), (16, 46), (16, 46), (17, 45), (17, 45), (18, 44), (19, 43), (21, 41)];

  /// Cylindrical shading across a pot row: rim edge, lit left, a warm highlight band, then shade and dark.
  func potTone(rel : Int) : Nat8 {
    if (rel <= 3) POT_SHADE
    else if (rel <= 16) POT_LIGHT
    else if (rel <= 26) POT_C
    else if (rel <= 34) POT_LIP
    else if (rel <= 64) POT_C
    else if (rel <= 84) POT_SHADE
    else POT_DARK;
  };

  /// Pot, soil and moss slot for a scene cell, or null outside the pot. Mirrored by growth.ts `potSlot`.
  public func potSlot(x : Int, y : Int) : ?Nat8 {
    if (y == 47) {
      return if (x == 20 or x == 21 or x == 25 or x == 38 or x == 41 or x == 42) ?MOSS_LIGHT else null;
    };
    if (y == 62) return if (x >= 18 and x <= 44) ?GROUND_SHADOW else null;
    if (y < 48 or y > 61) return null;
    let (left, right) = POT_ROWS[Int.abs(y - 48)];
    if (x < left or x > right) {
      return if (y == 61 and x >= 17 and x <= 45) ?GROUND_SHADOW else null;
    };
    let rel = (x - left) * 100 / (right - left);
    // Back rim around the soil surface.
    if (y == 48) {
      if (x == left) return ?POT_SHADE;
      if (x == right) return ?POT_DARK;
      let m = (x * 3 + 1) % 7;
      return ?(if (m == 0) MOSS_LIGHT else if (m < 3) MOSS else SOIL);
    };
    // Lip: a bright top edge, then its front face, rounded at both ends.
    if (y == 49) {
      if (x == left or x == right) return ?POT_SHADE;
      return ?(if (rel >= 86) POT_C else if (rel >= 30 and rel <= 40) LIGHT_RIM else POT_LIP);
    };
    if (y == 50) {
      if (x == left) return ?POT_SHADE;
      if (x == right) return ?POT_DARK;
      return ?potTone(rel);
    };
    // Shadow cast by the lip onto the body.
    if (y == 51) return ?(if (rel >= 85) POT_DARK else POT_SHADE);
    if (y == 61) return ?POT_DARK;
    if (y == 60) return ?(if (rel <= 8 or rel >= 70) POT_DARK else POT_SHADE);
    // Short glaze streaks across the lit body.
    if ((y == 53 or y == 56) and rel >= 18 and rel <= 60 and (x * 5 + y) % 9 == 0) return ?LIGHT_RIM;
    ?potTone(rel);
  };

  public func generate(seed : Blob, tier : Nat, attempt : Nat) : Artwork {
    let entropy = hash((seed.toArray().concat(Text.encodeUtf8("bonsai-art-v8:" # attempt.toText()).toArray())).toBlob());
    let traits = Bonsai.generateTraits(entropy, tier);
    let random = entropy.toArray();
    var cursor = 0;
    var block = random;
    func pick(n : Nat) : Int {
      if (cursor % 16 == 0) block := hash((random.concat(cursor.toText().encodeUtf8().toArray())).toBlob()).toArray();
      let offset = cursor % 16 * 2;
      cursor += 1;
      (block[offset].toNat() * 256 + block[offset + 1].toNat()) % n;
    };
    let salt = random[31].toNat();
    var skeleton : [Segment] = [];
    var pads : [Pad] = [];
    // Rendered bark: discs (centre, radius, trunk texture) stamped along every limb.
    var stamps : [(Int, Int, Int, Bool)] = [];
    func stamp(x : Int, y : Int, r : Int, trunk : Bool) {
      if (stamps.size() > 0) {
        let (px, py, pr, _) = stamps[stamps.size() - 1];
        if (px == x and py == y and pr == r) return;
      };
      stamps := stamps.concat([(x, y, r, trunk)]);
    };
    func connect(a : Point, b : Point, width : Int) {
      skeleton := skeleton.concat([{ start = a; end = b; width }]);
    };
    // Quadratic Bézier from `a` to `b` pulled towards `c`, tapering from radius r0 to r1.
    func curve(a : Point, c : Point, b : Point, r0 : Int, r1 : Int, trunk : Bool) {
      let span = Int.max(Int.max(Int.abs(b.x - a.x), Int.abs(b.y - a.y)), Int.max(Int.abs(c.x - a.x), Int.abs(c.y - a.y))) * 3 + 2;
      let n2 = span * span;
      var j : Int = 0;
      while (j <= span) {
        let u = span - j;
        stamp(
          (2 * (a.x * u * u + 2 * c.x * u * j + b.x * j * j) + n2) / (2 * n2),
          (2 * (a.y * u * u + 2 * c.y * u * j + b.y * j * j) + n2) / (2 * n2),
          (2 * (r0 * u + r1 * j) + span) / (2 * span),
          trunk,
        );
        j += 1;
      };
    };
    let density = traits.leafDensity.toNat();
    func foliage(p : Point, rx : Int, ry : Int) {
      let fx = Int.max(2, Int.min(rx, Int.min(p.x - 1, 62 - p.x)));
      let fy = Int.max(2, Int.min(ry, Int.min(p.y - 1, 62 - p.y)));
      pads := pads.concat([{ center = p; rx = fx; ry = fy }]);
    };
    func branchPad(p : Point) {
      foliage(p, 5 + pick(3) + density, 3 + pick(2));
    };
    let style = traits.trunkStyle;
    let thick = traits.trunkThick.toNat();
    let base = point(29 + pick(6), 47);
    let crownRx = 7 + pick(3) + density;
    let crownRy = 4 + pick(2);
    // The crown pad's top edge lands 3-6 px below the image edge.
    let height = 47 - (3 + pick(4) + crownRy);
    let lean = pick(9) - 4;
    let direction : Int = if (pick(2) == 0) -1 else 1;
    let baseRadius : Int = 2 + thick;
    // One continuous centreline: a seeded sine sweep (amplitude in px, turns in 1/64000 per height)
    // whose movement fades towards the apex, so every style bends smoothly instead of zig-zagging.
    let (amp, turns) : (Int, Int) = switch (style) {
      case 0 (1 + pick(2), 14 + pick(10));
      case 1 (5 + pick(4), 44 + pick(20));
      case 2 (3 + pick(3), 80 + pick(30));
      case 3 (4 + pick(3), 30 + pick(14));
      case _ (3 + pick(3), 36 + pick(16));
    };
    let phase = pick(64) * 1000;
    func centerX(t : Int) : Int {
      let decay = 1000 - t * 2 / 5;
      let wave = direction * amp * (sine(phase + t * turns) - sine(phase)) * decay / 1000;
      clamp(base.x + (wave + lean * t + (if (wave + lean * t >= 0) 500 else -500)) / 1000, 18, 46);
    };
    var nodes : [Point] = [base];
    var last = base;
    var i = 1;
    while (i <= 8) {
      let next = point(centerX(i * 125), 47 - height * i / 8);
      connect(last, next, Int.max(1, 2 + thick - i * (1 + thick) / 8));
      nodes := nodes.concat([next]);
      last := next;
      i += 1;
    };
    // Sample the centreline four times per row with a smooth taper and a flared base.
    var sample : Int = 0;
    let samples = height * 4;
    while (sample <= samples) {
      let t = sample * 1000 / samples;
      let y = 47 - (sample + 2) / 4;
      let above = 47 - y;
      let flare : Int = if (above < 4) (4 - above) / 2 else 0;
      let radius = (baseRadius * 1000 - (baseRadius - 1) * t + 500) / 1000 + flare;
      stamp(centerX(t), y, radius, true);
      sample += 1;
    };
    // Nebari: unequal surface roots flare from the planted trunk.
    for (side in [-1, 1].values()) {
      let spread = 5 + pick(4);
      let outer = point(base.x + side * spread, 48);
      connect(base, outer, 2);
      curve(point(base.x, 45), point(base.x + side * 2, 48), outer, baseRadius, 1, true);
      let inner = point(base.x + side * (3 + pick(3)), 47);
      connect(point(base.x, 45), inner, 1);
      curve(point(base.x, 44), point(base.x + side, 47), inner, 1, 1, true);
    };
    let count = traits.branchCount.toNat();
    let flip = pick(2);
    var branchPads : [Point] = [];
    var b = 0;
    while (b < count) {
      let index = 2 + b * 5 / count;
      let at = nodes[index];
      let side : Int = if ((b + flip) % 2 == 0) -1 else 1;
      let reach = 7 + pick(7) - (index : Int) / 3;
      let tip = point(clamp(at.x + side * reach, 10, 53), at.y - 2 - pick(5));
      let elbow = point((at.x + tip.x * 2) / 3, at.y - pick(2));
      let thickness : Int = if (index <= 3 and thick > 0) 2 else 1;
      connect(at, elbow, 2);
      connect(elbow, tip, 1);
      let twig = point(tip.x - side * 2, tip.y - 2);
      connect(tip, twig, 1);
      curve(at, elbow, tip, thickness, 1, false);
      curve(tip, point(tip.x - side, tip.y), twig, 1, 1, false);
      branchPads := branchPads.concat([twig]);
      b += 1;
    };
    for (p in branchPads.values()) branchPad(p);
    foliage(last, crownRx, crownRy);
    if (style == 3) {
      // Semi-cascade: a long side sweep that reaches past the pot without drooping.
      let shoulder = nodes[4];
      let elbow = point(46 + pick(3), shoulder.y - pick(2));
      let outer = point(50 + pick(3), elbow.y - 1 - pick(2));
      connect(shoulder, elbow, 2);
      connect(elbow, outer, 1);
      curve(shoulder, point((shoulder.x + elbow.x) / 2, shoulder.y + 1), elbow, 2, 1, false);
      curve(elbow, point(elbow.x + 2, elbow.y), outer, 1, 1, false);
      foliage(point(elbow.x, elbow.y - 2), 5 + pick(2), 3);
      foliage(point(outer.x + 1, outer.y - 1), 5 + pick(2), 2 + pick(2));
    };
    if (style == 4) {
      let secondary = point(clamp(base.x - 9 - pick(4), 15, 25), last.y + 7 + pick(4));
      let fork = point(base.x - 5, 35);
      connect(base, fork, 2);
      connect(fork, secondary, 1);
      curve(point(base.x, 44), point(base.x - 4, 41), fork, 2, 2, true);
      curve(fork, point(fork.x - 1, (fork.y + secondary.y) / 2), secondary, 2, 1, true);
      foliage(secondary, 5 + pick(2) + density, 3);
      let tip = point(secondary.x - 4, fork.y - 2 - pick(3));
      connect(fork, tip, 1);
      curve(fork, point(fork.x - 3, fork.y), tip, 1, 1, false);
      foliage(tip, 4 + pick(2), 2 + pick(2));
    };

    let pixels = Array.repeat(SKY_C, 4096).toVarArray();
    let silhouette = Array.repeat<Nat8>(0, 4096).toVarArray();
    func cell(x : Int, y : Int, color : Nat8, tree : Bool) {
      if (x < 0 or x >= 64 or y < 0 or y >= 64) return;
      let idx = Int.abs(y * 64 + x);
      pixels[idx] := color;
      if (tree) silhouette[idx] := 1;
    };
    func disc(p : Point, r : Int, color : Nat8, tree : Bool) {
      var y = -r;
      while (y <= r) {
        var x = -r;
        while (x <= r) {
          if (x * x + y * y <= r * r) cell(p.x + x, p.y + y, color, tree);
          x += 1;
        };
        y += 1;
      };
    };
    // Cheap deterministic per-pixel noise in -30..30 for dithering.
    func noise(x : Int, y : Int) : Int { (Int.abs(x * 73 + y * 151 + x * y * 7) + salt) % 61 - 30 };
    var y : Int = 47;
    while (y < 64) {
      var x : Int = 0;
      while (x < 64) {
        cell(x, y, potSlot(x, y) ?? GROUND_C, false);
        x += 1;
      };
      y += 1;
    };
    // Atmosphere is painted behind the tree and stays outside the tree-only uniqueness proof.
    if (traits.sky >= 3) {
      disc(point(51, 8), 3, LIGHT, false);
      if (traits.moonPhase != 4) disc(point(49 + traits.moonPhase.toNat() / 2, 8), 3, SKY_C, false);
    };
    for (p in [point(5, 10), point(58, 20), point(7, 31)].values()) {
      cell(p.x + traits.season.toNat(), p.y, if (traits.season == 3) LIGHT else ACCENT, false);
    };
    if (traits.specialElem > 0) {
      cell(8 + traits.specialElem.toNat(), 43, LIGHT, false);
      cell(9 + traits.specialElem.toNat(), 42, LIGHT, false);
    };
    // Bark: an outline pass, then a rounded interior lit from the left with twisting highlight bands.
    // The trunk is planted: bark never paints below the soil row.
    for ((cx, cy, r, _) in stamps.values()) {
      var dy = -r;
      while (dy <= r and cy + dy <= 48) {
        var dx = -r;
        while (dx <= r) {
          if (dx * dx + dy * dy <= r * r) cell(cx + dx, cy + dy, BARK_OUTLINE, true);
          dx += 1;
        };
        dy += 1;
      };
    };
    for ((cx, cy, r, trunk) in stamps.values()) {
      let q = r - 1;
      var dy = -q;
      while (dy <= q and cy + dy <= 48) {
        var dx = -q;
        while (dx <= q) {
          if (dx * dx + dy * dy <= q * q) {
            let px = cx + dx;
            let py = cy + dy;
            let rel = if (q == 0) 0 else dx * 100 / q;
            var tone = if (q == 0) BARK_C else if (rel < -70) BARK_C else if (rel < -5) BARK_LIGHT else if (rel < 45) BARK_C else BARK_SHADOW;
            if (trunk and q >= 2) {
              let band = Int.abs(py * 3 + px * 2 + salt) % 11;
              if (band == 0 and tone == BARK_C) tone := BARK_SHADOW;
              if (band == 0 and tone == BARK_LIGHT) tone := BARK_HIGHLIGHT;
              if (band == 6 and tone == BARK_LIGHT and noise(px, py) > 0) tone := BARK_C;
            };
            cell(px, py, tone, true);
          };
          dx += 1;
        };
        dy += 1;
      };
    };
    // Cloud pads: scalloped tops, flatter undersides, lit from the upper left, drawn back to front.
    let ordered = pads.sort(func(p, q) = Int.compare(q.center.y, p.center.y));
    for (pad in ordered.values()) {
      let lobe = 3 + (Int.abs(pad.center.x + pad.center.y) % 2);
      let shift = Int.abs(pad.center.x * 3 + salt) % lobe;
      var dx = -pad.rx;
      while (dx <= pad.rx) {
        let half = isqrt(pad.ry * pad.ry * (pad.rx * pad.rx - dx * dx) * 4 / (pad.rx * pad.rx));
        let h = (half + 1) / 2;
        let notch : Int = if (h >= 2 and (dx + pad.rx + shift) % lobe == 0) 1 else 0;
        let top = -(h - notch);
        let full = (h * 2 + 2) / 3;
        let jag : Int = if (full >= 2 and Int.abs(dx) * 2 > pad.rx and noise(pad.center.x + dx, pad.center.y) > 0) 1 else 0;
        let bottom = full - jag;
        var dy = top;
        while (dy <= bottom) {
          let px = pad.center.x + dx;
          let py = pad.center.y + dy;
          let score = -dy * 200 / pad.ry - dx * 100 / pad.rx + noise(px, py) * 2;
          let tone = if (dy == bottom) LEAF_OUTLINE
            else if (dy == bottom - 1 and bottom - top >= 3) LEAF_SHADOW
            else if (dy == top and score > 90) LEAF_HIGHLIGHT
            else if (score > 120) LEAF_HIGHLIGHT
            else if (score > 40 or (dy == top and score > -20)) LEAF_LIGHT
            else if (score > -70) LEAF_C
            else LEAF_SHADOW;
          cell(px, py, tone, true);
          dy += 1;
        };
        dx += 1;
      };
    };
    // Pot mark: the tree's own silhouette pooled to 7x7, stamped on the bottom of the pot.
    var minX = 64;
    var maxX = 0;
    var minY = 64;
    var maxY = 0;
    var index = 0;
    while (index < 4096) {
      if (silhouette[index] == 1) {
        minX := Nat.min(minX, index % 64);
        maxX := Nat.max(maxX, index % 64);
        minY := Nat.min(minY, index / 64);
        maxY := Nat.max(maxY, index / 64);
      };
      index += 1;
    };
    if (minX <= maxX and minY <= maxY) {
      let w = maxX - minX + 1;
      let h = maxY - minY + 1;
      var gy = 0;
      while (gy < 7) {
        let y1 = minY + gy * h / 7;
        let y2 = Nat.max(minY + (gy + 1) * h / 7, y1 + 1);
        var gx = 0;
        while (gx < 7) {
          let x1 = minX + gx * w / 7;
          let x2 = Nat.max(minX + (gx + 1) * w / 7, x1 + 1);
          var count = 0;
          var total = 0;
          var sy = y1;
          while (sy < y2) {
            var sx = x1;
            while (sx < x2) { count += silhouette[sy * 64 + sx].toNat(); total += 1; sx += 1 };
            sy += 1;
          };
          let target = (53 + gy) * 64 + 28 + gx;
          if (4 * count > total and silhouette[target] == 0) pixels[target] := MARK;
          gx += 1;
        };
        gy += 1;
      };
    };
    let bark = BARK[traits.trunkColor.toNat()];
    let leaf = LEAF[traits.leafColor.toNat()];
    let pot = POT[traits.potColor.toNat()];
    let ground = GROUND[traits.ground.toNat()];
    let palette : [Text] = [
      SKY[traits.sky.toNat()], ground, pot, mix(pot, GLOW, 45), mix(bark, SHADOW, 70), bark,
      mix(leaf, SHADOW, 72), leaf, "#b1c786", "#f4dfab", "#ffffff",
      mix(pot, GLOW, 22), mix(pot, SHADOW, 30), mix(pot, SHADOW, 60), "#3b2a22", "#5a7d2f", "#8fb04a",
      mix(ground, SHADOW, 30), mix(bark, SHADOW, 38), mix(bark, GLOW, 32),
      mix(leaf, SHADOW, 42), mix(leaf, GLOW, 28), mix(leaf, GLOW, 55), mix(bark, GLOW, 55), mix(pot, GLOW, 65),
    ];
    var svg = "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 64 64\" shape-rendering=\"crispEdges\">";
    var row = 0;
    while (row < 64) {
      var col = 0;
      while (col < 64) {
        let color = palette[pixels[row * 64 + col].toNat()];
        let start = col;
        while (col < 64 and palette[pixels[row * 64 + col].toNat()] == color) { col += 1 };
        svg #= "<rect x=\"" # start.toText() # "\" y=\"" # row.toText() # "\" width=\"" # (col - start).toText() # "\" height=\"1\" fill=\"" # color # "\"/>";
      };
      row += 1;
    };
    svg #= "</svg>";
    let raster = pixels.toArray().toBlob();
    let shape = silhouette.toArray().toBlob();
    let rgb = Array.tabulate(4096 * 3, func index {
      let color = palette[pixels[index / 3].toNat()].toArray();
      let channel = index % 3 * 2 + 1;
      Nat.toNat8(nibble(color[channel]) * 16 + nibble(color[channel + 1]));
    }).toBlob();
    let pixelHash = hash(rgb);
    { version = 8; seed; attempt; traits; skeleton; pads; pixels = raster; silhouette = shape; pixelHash; silhouetteHash = hash(shape); svg };
  };

  public func valid(a : Artwork) : Bool {
    if (a.seed.size() != 32 or a.pixels.size() != 4096 or a.silhouette.size() != 4096) return false;
    if (a.skeleton.size() < 8) return false;
    var i = 1;
    while (i < 8) {
      if (a.skeleton[i].start != a.skeleton[i - 1].end or a.skeleton[i].width > a.skeleton[i - 1].width) return false;
      i += 1;
    };
    for (s in a.skeleton.values()) {
      if (s.width < 1 or s.width > 6) return false;
      for (p in [s.start, s.end].values()) {
        if (p.x < 4 or p.x > 59 or p.y < 4 or p.y > 59) return false;
      };
    };
    // Skeleton indices 8..11 are surface roots; every trunk and branch segment must rise or stay level.
    var segment = 0;
    while (segment < a.skeleton.size()) {
      let s = a.skeleton[segment];
      if ((segment < 8 or segment >= 12) and s.end.y > s.start.y) return false;
      segment += 1;
    };
    for (p in a.pads.values()) {
      if (p.center.x - p.rx < 0 or p.center.x + p.rx >= 64 or p.center.y - p.ry < 0 or p.center.y + p.ry >= 64) return false;
    };
    true;
  };
}
