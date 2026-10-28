import type { Listing } from "../bindings/backend";
import { formatIcp } from "./ledger";

export function marketCurrency(listing: Listing): string {
  return listing.currency === "icp" ? "ICP" : "$BONSAI";
}

export function marketPrice(listing: Listing): string {
  return `${formatIcp(listing.price, 8)} ${marketCurrency(listing)}`;
}

export function isListed(listing: Listing | null | undefined): listing is Listing {
  return listing !== null && listing !== undefined && !["cancelled", "sold"].includes(listing.phase);
}

export function saleStatus(listing: Listing): string {
  const statuses: Record<Listing["phase"], string> = {
    locking: "Preparing listing",
    active: "For sale",
    cancelling: "Cancelling listing",
    cancelled: "Listing cancelled",
    collecting: "Payment pending",
    delivering: "Paid - delivering bonsai",
    paying: "Bonsai delivered - seller payout pending",
    sold: "Sale complete",
    review: "Ledger reconciliation required",
  };
  return statuses[listing.phase];
}
