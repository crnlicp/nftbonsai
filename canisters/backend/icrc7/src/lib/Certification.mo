import Array "mo:core/Array";
import Blob "mo:core/Blob";
import Nat "mo:core/Nat";
import Nat8 "mo:core/Nat8";
import Text "mo:core/Text";
import Char "mo:core/Char";
import List "mo:core/List";

module {
  public func base64(blob : Blob) : Text {
    let alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/".toArray();
    let bytes = blob.toArray();
    var result = "";
    var i = 0;
    while (i < bytes.size()) {
      let a = bytes[i].toNat();
      let b = if (i + 1 < bytes.size()) bytes[i + 1].toNat() else 0;
      let c = if (i + 2 < bytes.size()) bytes[i + 2].toNat() else 0;
      result #= alphabet[a / 4].toText();
      result #= alphabet[(a % 4) * 16 + b / 16].toText();
      result #= if (i + 1 < bytes.size()) alphabet[(b % 16) * 4 + c / 64].toText() else "=";
      result #= if (i + 2 < bytes.size()) alphabet[c % 64].toText() else "=";
      i += 3;
    };
    result;
  };

  public let expression = "default_certification(ValidationArgs{certification:Certification{no_request_certification:Empty{},response_certification:ResponseCertification{certified_response_headers:ResponseHeaderList{headers:[\"content-type\",\"cache-control\",\"allow\"]}}}})";

  // CBOR array of text labels, as required by HTTP certification v2 expr_path.
  public func expressionPath(labels : [Text]) : Blob {
    let out = List.empty<Nat8>();
    func length(major : Nat8, size : Nat) {
      if (size < 24) out.add(major + size.toNat8())
      else {
        var n = size;
        let buffer = List.empty<Nat8>();
        loop {
          buffer.add((n % 256).toNat8());
          n /= 256;
          if (n == 0) break;
        };
        let width = if (buffer.size() == 1) 1 else if (buffer.size() <= 2) 2 else if (buffer.size() <= 4) 4 else 8;
        out.add(major + (if (width == 1) 24 else if (width == 2) 25 else if (width == 4) 26 else 27));
        var i = width;
        while (i > 0) { i -= 1; out.add(if (i < buffer.size()) buffer.at(i) else (0 : Nat8)) };
      };
    };
    length(0x80, labels.size());
    for (entry in labels.values()) {
      let bytes = entry.encodeUtf8();
      length(0x60, bytes.size());
      for (byte in bytes.values()) out.add(byte);
    };
    out.toArray().toBlob();
  };
}
