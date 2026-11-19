---
paths:
  - "canisters/backend/market/**"
  - "canisters/backend/shared/**"
---

# market rules

- Payment amounts and tier anchors come from `pricing()`. `app/src/lib/tiers.ts` holds
  display metadata only; never copy prices into the frontend.
- `shared/PaymentTypes.mo` is part of both the `market` and `icrc7` interfaces: after
  changing it, run `mops check` for both and regenerate both `.did` files.
- Mint fulfillment to `icrc7` must stay bounded and idempotent (retries are expected).
