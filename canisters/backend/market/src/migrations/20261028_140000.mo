import Map "mo:core/Map";
import Set "mo:core/Set";

module {
  public func migration(_ : {}) : { likes : { likers : Map.Map<Nat, Set.Set<Principal>> } } {
    { likes = { likers = Map.empty() } };
  };
}
