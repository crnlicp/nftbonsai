@~/.claude/icp/RULES.md

# ICPBonsai

Generative pixel-bonsai NFT collection on ICP: buy with card (Paw), ICP or $BONSAI,
mint a certified on-chain SVG, then list, buy, send and like bonsai. Live at
icpbonsai.app. Operations, deployment and design detail: [README.md](README.md).

## Layout: grouped (3 Motoko backends, 1 frontend)

| canister | folder | role |
|---|---|---|
| `market` | canisters/backend/market | payments (Paw/ICP/$BONSAI), minting, marketplace, likes |
| `icrc7` | canisters/backend/icrc7 | ICRC-7 NFT collection, art renderer, certified images |
| `art_lab` | canisters/backend/art_lab | local-only art preview behind `/art-lab`; never on mainnet |
| `app` | canisters/frontend/app | React + Vite SPA (plain Vite, so source stays in `src/`) |

- `canisters/backend/` is the mops root: one `mops.toml` with `[canisters.*]` for all
  canisters plus test-only `art_tests` and `mock_ledger` (sources in `fixtures/`).
  `shared/` holds Motoko types used by both `market` and `icrc7`.
- `canisters/frontend/` is the pnpm workspace root (pnpm pinned via `packageManager`;
  run it as `corepack pnpm`, the `pnpm` on PATH is a Windows shim). Browser tests in
  `tests/e2e/`.
- The pinned `icp` CLI lives in `canisters/backend/node_modules/.bin/icp`; vite and
  the e2e wallet test use it from there.

## Commands (repo root)

- `npm run check`: `mops check` (types, lint, stable compatibility)
- `npm run build`: mops build + app build (bindings, `tsc -b`, vite)
- `npm test`: mops unit tests + PocketIC integration tests
- `npm run deploy:local`: local deploy as `anonymous` (or `$ICP_IDENTITY`)
- `npm run dev`: Vite dev server on :5173 against the local network
- `npm run samples:landing`: regenerate `app/public/previews/growing.json`
- E2E: `cd canisters/frontend && corepack pnpm run test:browser:local`

## Boundaries

- Mainnet IDs are in `.icp/data/mappings/ic.ids.json` (keyed by canister name). The
  names `backend` → `market` and `frontend` → `app` were renamed in place: the IDs did not change.
- `icrc7` only lets `PUBLIC_CANISTER_ID:market` mint; `market` reads
  `PUBLIC_CANISTER_ID:icrc7`. Deploy both together when either name or wiring changes.
- `MOCK_PAYMENTS` is set per environment in `icp.yaml` (`1` local, `0` ic).
- After every mainnet deploy, refresh the stable baselines in
  `canisters/backend/deployed/reinstall/` and commit them.
- moc is pinned to 1.16.1: moc 2 can't compile the certification/JSON dependencies yet.
- The Paw API key lives only in `market` state (set with `configurePaw`), never in
  files, env vars or the frontend.
