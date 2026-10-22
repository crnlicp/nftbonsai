import { type Value } "../types";
import Array "mo:core/Array";
import Blob "mo:core/Blob";
import Int "mo:core/Int";
import List "mo:core/List";
import Nat "mo:core/Nat";
import Nat8 "mo:core/Nat8";
import Order "mo:core/Order";
import Text "mo:core/Text";
import Sha256 "mo:sha2/Sha256";

module {
  public func leb128(n0 : Nat) : [Nat8] {
    var n = n0;
    let buf = List.empty<Nat8>();
    loop {
      let byte = (n % 128).toNat8();
      n /= 128;
      if (n == 0) { buf.add(byte); return buf.toArray() };
      buf.add(byte | 0x80);
    };
  };

  public func sha(b : Blob) : Blob { Sha256.fromBlob(#sha256, b) };

  func cmpBytes(a : [Nat8], b : [Nat8]) : Order.Order {
    let n = Nat.min(a.size(), b.size());
    var i = 0;
    while (i < n) {
      if (a[i] < b[i]) return #less;
      if (a[i] > b[i]) return #greater;
      i += 1;
    };
    Nat.compare(a.size(), b.size());
  };

  public func repHash(v : Value) : Blob {
    switch (v) {
      case (#Nat n) sha(leb128(n).toBlob());
      case (#Int i) sha(leb128(Int.abs(i)).toBlob());
      case (#Text t) sha(t.encodeUtf8());
      case (#Blob b) sha(b);
      case (#Array arr) {
        let buf = List.empty<Nat8>();
        for (e in arr.values()) {
          for (byte in repHash(e).toArray().values()) buf.add(byte);
        };
        sha(buf.toArray().toBlob());
      };
      case (#Map m) {
        let pairs = List.empty<[Nat8]>();
        for ((k, val) in m.values()) {
          pairs.add(sha(k.encodeUtf8()).toArray().concat(repHash(val).toArray()));
        };
        let buf = List.empty<Nat8>();
        for (pair in pairs.toArray().sort(cmpBytes).values()) {
          for (byte in pair.values()) buf.add(byte);
        };
        sha(buf.toArray().toBlob());
      };
    };
  };
}
