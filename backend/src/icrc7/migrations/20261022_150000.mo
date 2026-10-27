import Map "mo:core/Map";
import Nat "mo:core/Nat";

module {
  type OldActor = {
    mintRecipients : Map.Map<Text, { to : Principal; amount : Nat }>;
  };
  type NewActor = {
    mintRecipients : Map.Map<Text, { to : Principal; tier : Nat }>;
  };

  // Mint receipts now record the art tier (0..4) instead of the EUR amount.
  // Old EUR amounts (10..700) map onto the five bands the previous art used.
  public func migration(old : OldActor) : NewActor {
    {
      mintRecipients = old.mintRecipients.map(
        func(_ : Text, r : { to : Principal; amount : Nat }) : { to : Principal; tier : Nat } {
          let a = if (r.amount < 10) 10 else if (r.amount > 700) 700 else r.amount;
          { to = r.to; tier = Nat.min(4, ((a - 10) * 5) / 691) };
        }
      );
    };
  };
}
