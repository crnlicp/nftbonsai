import Types "PaymentTypes";
import Payments "mixins/Payments";
import Runtime "mo:core/Runtime";
import Principal "mo:core/Principal";

persistent actor self {
  let paw : Types.State;
  include Payments(paw, Runtime.envVar<system>("MOCK_PAYMENTS") == ?"1", Principal.fromActor(self));
  // Resume polling after install or upgrade when purchases are still pending.
  ensurePolling<system>();
}
