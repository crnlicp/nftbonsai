---
paths:
  - "canisters/backend/icrc7/**"
  - "canisters/frontend/app/src/lib/growth.ts"
  - "canisters/frontend/app/src/lib/render.ts"
---

# icrc7 rules

- `src/lib/Art.mo` is the canonical renderer. `app/src/lib/growth.ts` mirrors its `mix`
  and pot/soil layout exactly, and `app/src/lib/render.ts` mirrors `src/lib/Bonsai.mo`.
  Change both sides together, then run `npm run samples:landing`: it checks the browser
  growth code against Art.mo output and rewrites `app/public/previews/growing.json`.
- Minted images are certified. Any change to the SVG bytes for an existing token changes
  its hash, so treat renderer changes as a migration-level decision.
