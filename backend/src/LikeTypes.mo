import Map "mo:core/Map";
import Set "mo:core/Set";

module {
  /// Likers per NFT id. An entry exists only once the NFT was verified to exist.
  public type State = { likers : Map.Map<Nat, Set.Set<Principal>> };
  public type Stat = { count : Nat; liked : Bool };
}
