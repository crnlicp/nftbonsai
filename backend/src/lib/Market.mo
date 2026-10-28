import Types "../MarketTypes";
import Payments "../PaymentTypes";
import Tiers "Tiers";
import Blob "mo:core/Blob";
import Nat "mo:core/Nat";
import Array "mo:core/Array";
import Option "mo:core/Option";

module {
  public func reference(p : Payments.Purchase, icp : [Nat], token : [Nat]) : ?Types.Reference {
    if (p.tier >= 5 or icp.size() != 5 or token.size() != 5) return null;
    let i = p.tier;
    let unit = Tiers.UNIT;
    switch (p.method) {
      case (#paw) ?{ icp = p.amountEur * icp[i] * unit / Tiers.EUR[i]; token = p.amountEur * token[i] * unit / Tiers.EUR[i] };
      case (#icp) {
        let ?amount = p.amountE8s else return null;
        ?{ icp = amount; token = amount * token[i] / icp[i] };
      };
      case (#token) {
        let ?amount = p.amountE8s else return null;
        ?{ icp = amount * icp[i] / token[i]; token = amount };
      };
    };
  };

  public func cap(r : Types.Reference, currency : Types.Currency) : Nat {
    2 * (switch currency { case (#icp) r.icp; case (#token) r.token });
  };

  public func appFee(price : Nat) : Nat { price * 200 / 10_000 };

  public func subaccount(id : Nat) : Blob {
    var n = id;
    let bytes : [Nat8] = Array.tabulate(32, func i {
      if (i == 0) return (77 : Nat8);
      let b = (n % 256).toNat8();
      n /= 256;
      b;
    });
    bytes.toBlob();
  };
}
