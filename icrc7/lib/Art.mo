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

  func clamp(n : Int, lo : Int, hi : Int) : Int { Int.max(lo, Int.min(n, hi)) };
  func point(x : Int, y : Int) : Point { { x; y } };
  public func hash(bytes : Blob) : Blob { Sha256.fromBlob(#sha256, bytes) };

  public func generate(seed : Blob, tier : Nat, attempt : Nat) : Artwork {
    let entropy = hash((seed.toArray().concat(Text.encodeUtf8("bonsai-art-v7:" # attempt.toText()).toArray())).toBlob());
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
    var skeleton : [Segment] = [];
    var pads : [Pad] = [];
    func connect(a : Point, b : Point, width : Int) {
      skeleton := skeleton.concat([{ start = a; end = b; width }]);
    };
    func foliage(p : Point, extra : Int) {
      let rx = 4 + pick(3) + extra;
      let ry = 2 + pick(2);
      pads := pads.concat([{ center = p; rx; ry }]);
    };
    let style = traits.trunkStyle;
    let base = point(29 + pick(6), 47);
    // Tops (including the crown pad) end 3-7 px below the image edge.
    let height = 38 + pick(4);
    let lean = pick(9) - 4;
    let bend = 3 + pick(5);
    let direction : Int = if (pick(2) == 0) -1 else 1;
    var nodes : [Point] = [base];
    var last = base;
    var i : Int = 1;
    while (i <= 8) {
      let y = 47 - height * i / 8;
      let wave = if (i <= 4) i else 8 - i;
      let offset = if (style == 0) lean * i / 8
        else if (style == 2) direction * (if (i % 3 == 0) -bend else bend) * i / 10
        else direction * bend * wave / 4 + lean * i / 8;
      let next = point(clamp(base.x + offset, 22, 40), y);
      connect(last, next, Int.max(1, 3 + traits.trunkThick.toNat() / 2 - i / 3));
      nodes := nodes.concat([next]);
      last := next;
      i += 1;
    };
    // Unequal surface roots grow from the same planted trunk.
    for (side in [-1, 1].values()) {
      connect(base, point(base.x + side * (5 + pick(4)), 48), 2);
      connect(point(base.x, 45), point(base.x + side * (3 + pick(3)), 47), 1);
    };
    foliage(last, 0);
    let count = traits.branchCount.toNat();
    var b = 0;
    while (b < count) {
      let index = 2 + b * 5 / count;
      let at = nodes[index];
      let side : Int = if (b % 2 == 0) -1 else 1;
      let reach = 7 + pick(7) - (index : Int) / 3;
      let tip = point(clamp(at.x + side * reach, 10, 53), at.y - 2 - pick(5));
      let elbow = point((at.x + tip.x) / 2, at.y - pick(2));
      connect(at, elbow, 2);
      connect(elbow, tip, 1);
      let twig = point(tip.x - side * 2, tip.y - 2);
      connect(tip, twig, 1);
      foliage(twig, if (traits.leafDensity == 2) 1 else 0);
      b += 1;
    };
    if (style == 3) {
      // Semi-cascade: a long side sweep that reaches past the pot without drooping.
      let shoulder = nodes[4];
      let elbow = point(46 + pick(3), shoulder.y - pick(2));
      let outer = point(50 + pick(3), elbow.y - 1 - pick(2));
      connect(shoulder, elbow, 2);
      connect(elbow, outer, 1);
      foliage(point(elbow.x, elbow.y - 2), 0);
      foliage(point(outer.x + 1, outer.y - 1), 0);
    };
    if (style == 4) {
      let secondary = point(clamp(base.x - 9 - pick(4), 15, 25), last.y + 7 + pick(4));
      let fork = point(base.x - 5, 35);
      connect(base, fork, 2);
      connect(fork, secondary, 1);
      foliage(secondary, 0);
      let tip = point(secondary.x - 4, fork.y - 2 - pick(3));
      connect(fork, tip, 1);
      foliage(tip, 0);
    };

    let pixels = Array.repeat<Nat8>(0, 4096).toVarArray();
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
    func stroke(s : Segment, radius : Int, color : Nat8) {
      let steps = Int.max(Int.abs(s.end.x - s.start.x), Int.abs(s.end.y - s.start.y)) + 1;
      var j : Int = 0;
      while (j <= steps) {
        disc(point(s.start.x + (s.end.x - s.start.x) * j / steps, s.start.y + (s.end.y - s.start.y) * j / steps), radius, color, true);
        j += 1;
      };
    };
    var y : Int = 47;
    while (y < 64) {
      var x : Int = 0;
      while (x < 64) { cell(x, y, 1, false); x += 1 };
      y += 1;
    };
    y := 49;
    while (y <= 57) {
      let inset = (y - 49) / 3;
      var x = 17 + inset;
      while (x <= 45 - inset) {
        cell(x, y, if (y == 49 or x == 17 + inset) 3 else 2, false);
        x += 1;
      };
      y += 1;
    };
    // Atmosphere is painted behind the tree and stays outside the tree-only uniqueness proof.
    if (traits.sky >= 3) {
      disc(point(51, 8), 3, 9, false);
      if (traits.moonPhase != 4) disc(point(49 + traits.moonPhase.toNat() / 2, 8), 3, 0, false);
    };
    for (p in [point(5, 10), point(58, 20), point(7, 31)].values()) {
      cell(p.x + traits.season.toNat(), p.y, if (traits.season == 3) 9 else 8, false);
    };
    if (traits.specialElem > 0) {
      cell(8 + traits.specialElem.toNat(), 43, 9, false);
      cell(9 + traits.specialElem.toNat(), 42, 9, false);
    };
    for (s in skeleton.values()) stroke(s, s.width, 4);
    for (s in skeleton.values()) stroke(s, Int.max(0, s.width - 1), 5);
    for (pad in pads.values()) {
      var py = -pad.ry;
      while (py <= pad.ry) {
        var px = -pad.rx;
        while (px <= pad.rx) {
          let ellipse = px * px * pad.ry * pad.ry + py * py * pad.rx * pad.rx;
          let bound = pad.rx * pad.rx * pad.ry * pad.ry;
          // Skip the single-pixel nubs at the top and bottom of the ellipse.
          if (ellipse <= bound and Int.abs(py) < pad.ry) {
            let color : Nat8 = if (ellipse > bound * 3 / 4) 6 else if (py < 0 and px > -2) 8 else 7;
            cell(pad.center.x + px, pad.center.y + py, color, true);
          };
          px += 1;
        };
        py += 1;
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
          let target = (51 + gy) * 64 + 28 + gx;
          if (4 * count > total and silhouette[target] == 0) pixels[target] := 10;
          gx += 1;
        };
        gy += 1;
      };
    };
    let palette : [Text] = [
      SKY[traits.sky.toNat()], ["#6b5745", "#66815a", "#d6c4a0", "#e7e9e5", "#4d6741"][traits.ground.toNat()],
      POT[traits.potColor.toNat()], "#d4b48c", "#29241f", BARK[traits.trunkColor.toNat()],
      "#203629", LEAF[traits.leafColor.toNat()], "#b1c786", "#f4dfab", "#c2410c",
    ];
    var svg = "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 64 64\" shape-rendering=\"crispEdges\">";
    var row = 0;
    while (row < 64) {
      var col = 0;
      while (col < 64) {
        let color = pixels[row * 64 + col];
        let start = col;
        while (col < 64 and pixels[row * 64 + col] == color) { col += 1 };
        svg #= "<rect x=\"" # start.toText() # "\" y=\"" # row.toText() # "\" width=\"" # (col - start).toText() # "\" height=\"1\" fill=\"" # palette[color.toNat()] # "\"/>";
      };
      row += 1;
    };
    svg #= "</svg>";
    let raster = pixels.toArray().toBlob();
    let shape = silhouette.toArray().toBlob();
    func nibble(c : Char) : Nat {
      let value = c.toNat32().toNat();
      if (value >= 97) value - 87 else value - 48;
    };
    let rgb = Array.tabulate(4096 * 3, func index {
      let color = palette[pixels[index / 3].toNat()].toArray();
      let channel = index % 3 * 2 + 1;
      Nat.toNat8(nibble(color[channel]) * 16 + nibble(color[channel + 1]));
    }).toBlob();
    let pixelHash = hash(rgb);
    { version = 7; seed; attempt; traits; skeleton; pads; pixels = raster; silhouette = shape; pixelHash; silhouetteHash = hash(shape); svg };
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
