import Map "mo:core/Map";

module {
  type OldActor = {};
  type NewActor = {
    saleLocks : Map.Map<Nat, { listingId : Nat; seller : Principal }>;
    saleDeliveries : Map.Map<Nat, { listingId : Nat; tokenId : Nat; seller : Principal; buyer : Principal; block : Nat }>;
  };
  public func migration(_old : OldActor) : NewActor {
    { saleLocks = Map.empty(); saleDeliveries = Map.empty() };
  };
}
