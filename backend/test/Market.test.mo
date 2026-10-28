import Market "../src/lib/Market";
import Types "../src/PaymentTypes";
import Tiers "../src/lib/Tiers";
import Principal "mo:core/Principal";

let p : Types.Purchase = {
  id = "test"; tier = 1; method = #icp; sequence = 1; invoiceId = null;
  caller = Principal.fromText("aaaaa-aa"); amountEur = 0; checkoutUrl = null;
  paymentStatus = "paid"; fulfillment = #minted; nftId = ?1; seed = null;
  createdAt = 0; updatedAt = 0; nextCheck = 0; attempts = 0; lastError = null;
  sandbox = false; amountE8s = ?3_000_000_000; ledgerBlock = ?1; payTime = null;
  artTier = ?2; lucky = true;
};
assert Market.reference(p, Tiers.ICP, Tiers.TOKEN) == ?{ icp = 3_000_000_000; token = 3_000_000_000_000 };
assert Market.reference({ p with method = #token; amountE8s = ?19_000_000_000_000 }, Tiers.ICP, Tiers.TOKEN) == ?{ icp = 19_000_000_000; token = 19_000_000_000_000 };
assert Market.reference({ p with method = #paw; amountEur = 150 }, Tiers.ICP, Tiers.TOKEN) == ?{ icp = 2_878_787_878; token = 2_878_787_878_787 };
assert Market.reference({ p with amountE8s = null }, Tiers.ICP, Tiers.TOKEN) == null;
assert Market.reference({ p with tier = 5 }, Tiers.ICP, Tiers.TOKEN) == null;
assert Market.reference(p, [], []) == null;
assert Market.cap({ icp = 123; token = 456 }, #icp) == 246;
assert Market.cap({ icp = 123; token = 456 }, #token) == 912;
assert Market.appFee(10_001) == 200;
assert Market.appFee(49) == 0;
assert Market.subaccount(1) != Market.subaccount(2);
assert Market.subaccount(1) != Market.subaccount(257);
assert Market.subaccount(1).size() == 32;
