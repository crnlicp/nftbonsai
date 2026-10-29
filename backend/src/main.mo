import Types "PaymentTypes";
import Payments "mixins/Payments";
import Runtime "mo:core/Runtime";
import Principal "mo:core/Principal";
import MarketTypes "MarketTypes";
import Marketplace "mixins/Marketplace";
import LikeTypes "LikeTypes";
import Likes "mixins/Likes";

persistent actor self {
  let paw : Types.State;
  let market : MarketTypes.State;
  let likes : LikeTypes.State;
  include Marketplace(market, paw, Principal.fromActor(self));
  include Likes(likes);
  include Payments(paw, Runtime.envVar<system>("MOCK_PAYMENTS") == ?"1", Principal.fromActor(self), captureReference);
  // Resume polling after install or upgrade when purchases are still pending.
  ensurePolling<system>();
  ensureMarketPolling<system>();
}
