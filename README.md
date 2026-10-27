# NFT Bonsai

Generative **64 x 64 pixel-art bonsai NFTs** on the Internet Computer, purchased
by card through [PawPayments](https://docs.pawpayments.com/overview) or with
**ICP** from the app's built-in self-custody wallet. This version starts a fresh enhanced-migration chain and requires a
**reinstall of pre-chain deployments**. Reinstall deletes all prior purchases,
NFTs, approvals and history; it is not an upgrade from the old Guardarian app.

## Purchase and mint flow

1. Sign in with Internet Identity, choose any whole-euro price from EUR 49 to 999
   (it maps to one of five [named tiers](#tiers-and-pricing)) and pay by card (steps 2-4) or [with ICP](#icp-checkout-and-wallet).
2. The backend saves a purchase intent before creating a non-permanent,
   EUR-denominated **STATIC USDC invoice**, using a non-replicated HTTPS POST.
3. Open the returned Paw checkout link. Paw advertises **Pay by card** for
   eligible US/EU customers on non-permanent USDC invoices; Stripe handles the
   card-to-USDC step. Card/network fees are additional. Availability depends on
   merchant onboarding, asset/network and payer eligibility.
4. Replicated GETs verify invoice ID, opaque purchase reference, EUR currency,
   original `initial_fiat_amount`, STATIC billing and environment before minting.
   Only `success` and `paid_over` authorize a mint. Partial payment is not enough.
5. Cryptographic randomness is frozen once. A persistent mint key makes retries
   idempotent, even if a mint reply is lost or the NFT is subsequently transferred.
   **Paid** and **minted** are separate states; a mint failure never asks the
   customer to pay again.

Purchases belong to the authenticated principal and reload from the canister,
not browser storage. While intents are pending, a 30-second recurring timer
checks up to ten per tick, with round-robin scheduling, backoff and visible
errors. The timer stops when nothing is pending (so an idle backend pays no
execution fees) and restarts on new purchases and after upgrades. Anonymous callers
cannot purchase. Creation has a 60-second principal cooldown, three-pending and
1,000-total per-principal limits, and a 200-pending global limit. These are
capacity limits, not complete Sybil resistance.

Settlement credits the **Paw merchant balance**, not an ICP treasury canister.
Withdrawals, refunds, chargebacks and post-mint reversals are manual operations;
refunding does not automatically burn or claw back an NFT.

## Generation, realism and uniqueness

The original generator selected a small trait tuple; identical silhouettes were
possible and the browser and on-chain SVG renderers disagreed. New NFTs use a
single frozen on-chain SVG, which the app displays directly.

[Art.mo](backend/src/icrc7/lib/Art.mo) generates version-8 artwork entirely in Motoko
(tokens minted earlier keep their stored artwork):

- Seed-derived trunks following one continuous sine centreline (gentle for
  formal upright, deep S-bends for informal and gnarled), sampled four times per
  row with a smooth taper, a soft base flare planted at the soil line, flared
  surface roots (nebari), curved primary branches and twigs, and
  cloud-like foliage pads with scalloped tops drawn back to front.
- Pixel-art shading lit from the upper left: outlined bark with light, mid and
  shadow tones plus groove texture, and leaf pads with highlight, light, mid,
  shadow and dark-underside tones broken up by deterministic dithering. All
  ramps are integer blends of the trait colours towards a shared warm highlight
  and cool shadow.
- A tall shaded pot with soil and moss, a wide rounded lip with a glint and an
  under-lip shadow, a deep body with cylindrical shading and glaze streaks whose
  bottom steps in to a foot, and a ground shadow. [growth.ts](frontend/src/lib/growth.ts) mirrors the same layout to
  rebuild the scene behind the growing tree.
- Formal upright, informal upright, gnarled, semi-cascade and unequal
  multi-trunk families. Trunk and branch segments never fold downward (only
  surface roots descend); `Art.valid` rejects any candidate that does.
- Tall trunks: crowns end a few pixels below the top edge. The moon and stars are
  painted behind the tree, so canopies pass in front of them.
- A pot mark: the tree's own silhouette, reduced to a 7×7 white stamp
  (integer area pooling of its bounding box), sits on the pot's bottom edge at
  x 28-34, y 53-59. Every pot carries a miniature of its unique tree.
- Deterministic integer rasterization, palette shading, seasonal accents and
  a canonical SVG serialized from the saved pixel buffer.
- The NFT stores the seed, generator version, accepted attempt, skeleton, pads,
  pixels, exact SVG, tree-silhouette hash and **actual RGB pixel hash**.
- Minting atomically rejects a previously registered tree silhouette or RGB
  image. It tries up to 32 seed-derived candidates; exhaustion leaves the paid
  purchase recoverable instead of accepting a duplicate. Hash matches are
  conservatively rejected. This is collection-enforced uniqueness, not a
  mathematical claim that arbitrary random seeds can never collide, nor a
  claim of uniqueness against legacy or other collections.

### Tiers and pricing

Tiers are cosmetic and do not affect ownership rights. Every tier is unlimited;
each tree is still unique.

Buyers choose any whole-euro price from EUR 49 to 999 with the Mint page's
price slider, tier ticks or exact-amount field. A price maps to the **highest
tier anchor it reaches**. For example, EUR 150 is Grove and EUR 250 is Jade.

| Tier | From (EUR) | ICP at EUR 2.44/ICP | Primary branches | Canopy | Pot |
|---|---:|---:|---:|---|---|
| Sprout | 49 | 20.08 | 3 | airy | terracotta |
| Grove | 99 | 40.57 | 4 | airy | stone |
| Jade | 199 | 81.56 | 5 | lush | jade |
| Lacquer | 499 | 204.51 | 6 | lush | blue lacquer |
| Imperial | 999 | 409.43 | 7 | dense | gold |

Anchors and range are fixed in [Tiers.mo](backend/src/lib/Tiers.mo). The ICP price
is `price x e8sPerEur`, rounded **up** to 0.0001 ICP. `e8sPerEur` is a
controller-set rate (`setIcpRate`, default `40_983_606`, which is
`1e8 / 2.44`), so quoting costs no cycles or outcalls. `pricing()` returns
anchors, range, rate and rounding step; the frontend mirrors the backend
rounding exactly. **Lucky bloom:** about 1 in 32 mints
(`seed[31] < 8`, decided by the frozen on-chain randomness) receive the art of
the next tier up at no extra cost; Imperial is already the top art tier. The
Mint page previews the chosen tier in the Mystery Pot (pot colour, branch count,
canopy) before purchase.

This remains stylized pixel art, not photorealism or a botanical simulation.
The regression suite checks 1,000 seeds on every run (10,000 with
`npm run test:art:full`, which should be run after any change to the art
generator) for distinct silhouettes and RGB
hashes, bounded occupancy, connected tree pixels, valid attached/tapered trunk
geometry and all 25 style/tier combinations. It also compares RGB hashes with
colors reconstructed from the canonical SVG.

## ICP checkout and wallet

The **Wallet** page (`/wallet`) shows the signed-in principal's ICP balance on
the ICP ledger, a receive address (legacy account ID or ICRC principal, with a
QR code) and a send form with a review step. Sending to a 64-hex account ID uses
the legacy `transfer`; sending to a principal uses `icrc1_transfer`. Keys stay
with Internet Identity; the backend never holds user funds outside a purchase.

Paying with ICP on the Mint page:

1. The browser calls `icrc2_approve` for the quoted price plus one ledger fee,
   with a 10-minute expiry, naming the backend as spender.
2. `buyWithIcp(eur, maxE8s)` refuses to start if the rate changed and the
   current quote exceeds `maxE8s` (the quote the buyer saw). Otherwise it records
   the purchase, then pulls the price with
   `icrc2_transfer_from` into the backend's default account. The ledger dedupes
   the pull by memo/created-at time, so retries cannot double-charge.
3. Once collected, the purchase follows the same seeded, idempotent mint path as
   card purchases. A ledger outage is retried with backoff; an insufficient
   allowance or balance closes the purchase without charging.

The customer pays the price plus two ledger fees (approve + pull). The ICP
ledger ID comes from the backend env var `ICP_LEDGER_ID` (default: mainnet
`ryjl3-tyaaa-aaaaa-aaaba-cai`, which the local network also provides).

Balances are read with `icrc1_balance_of` **queries** sent straight from the
browser to the ICP ledger. These calls cost this app's canisters no cycles. The
Wallet and Mint pages refresh the balance every 30 s, right after a send or ICP
purchase, and when the tab becomes visible again. Polling pauses while the tab
is hidden. Mint polls purchases every 4 s only while one is in progress
(otherwise every 30 s) and reads `paymentInfo` once.

Controller operations:

```bash
# ICP rate in e8s per EUR = round(1e8 / EUR-per-ICP); e.g. ICP at EUR 3.00 -> 33_333_333
npm exec -- icp canister call backend setIcpRate '(33_333_333 : nat)' -e ic
# Withdraw collected ICP (amount in e8s; the ledger fee is deducted from the backend's balance)
npm exec -- icp canister call backend withdrawIcp '(record { owner = principal "<treasury>"; subaccount = null }, 100_000_000)' -e ic
```

## Canonical images and certification

`GET /nft/<id>.svg` serves the frozen artwork from the NFT canister. Frontend
cards, reveals and metadata use this same image; there is no second browser
renderer. Gallery uses cursor pagination; owned tokens are retrieved through
`icrc7_tokens_of`, not a latest-200 collection window.

The landing page randomly selects three distinct pixel-art samples produced by
the actual Motoko NFT renderer, not a separate browser generation algorithm.
All three grow together in 20 steps of 500 ms (10 seconds), pixel by pixel
along the tree from the trunk base, over the same sky, ground and pot. Each ends
as the exact canonical SVG shown for minted NFTs, then remains complete for one
second before a new random set starts. After a successful payment, the Mint page
grows the new bonsai once, the same way, from its stored artwork (`getArtwork`)
and finishes on the certified `/nft/<id>.svg` image. Purchases seen before
minting are remembered per principal in `localStorage`, so this also happens
when Paw redirects the buyer back to `/mint`. The Mint page opens on a fresh mint
preview (or an unfinished purchase, to resume it), never on the last bonsai;
previously minted bonsai picked from the purchase list show the static image. Growth timing and ordering live
in [growth.ts](frontend/src/lib/growth.ts). Reduced-motion preferences show complete trees
without animation or automatic regeneration. Samples are illustrations, not
minted tokens. Regenerate the checked-in sample pool after changing the renderer:

```bash
npm run build
npm run samples:landing
```

Mainnet image URLs are `https://<icrc7-id>.icp.net/nft/<id>.svg` (not `raw`).
HTTP certification v2 binds the body, status and selected headers, including
certified 404 fallbacks and 405 responses. Its Merkle tree also certifies the
ICRC-3 `last_block_index` (LEB128) and `last_block_hash`. Tests exercise a
**verifying** PocketIC gateway and validate the ICRC-3 certificate and witness.
Plain Candid artwork queries are convenience data, not independently verified
provenance; use the certified image or verify the proof yourself.

## Development and verification

### Repository layout

```text
backend/
  src/                    Payment canister sources (main.mo, types, lib, mixins, migrations)
    icrc7/                NFT canister sources and canister.yaml
  backend.did             Curated payment interface
  icrc7.did               Curated NFT interface
  canister.yaml           Payment canister recipe
  mops.toml, mops.lock     Shared Motoko configuration and dependencies
  package.json            Shared development tools and test commands
  deployed/               Stable-signature baselines
  test/, tests/, tools/    Tests and test canisters; tools/canister.yaml defines art-lab
  scripts/                Development environment and sample-generation helpers
frontend/
  src/, public/           Browser application and static assets
  canister.yaml           Static-site recipe
  scripts/                Frontend sync helpers
  package.json            Frontend dependencies and build commands
icp.yaml                  Project-wide canisters, networks, and environments
.icp/data/                Persistent deployment mappings
```

Run the shared tooling commands below from `backend/`; frontend commands use
`npm --prefix ../frontend`. The ICP CLI discovers the project-wide `icp.yaml`
in the parent directory. Canister recipes run in their own YAML file's directory.
The three Motoko recipes share `backend/mops.toml` and its dependency cache.

Prerequisites: Node 22+, `ic-wasm`. Use the **project-local ICP CLI and mops**
versions, not older global installations. The pinned ICP CLI selects a local
Internet Identity build compatible with auth 11's session-delegation protocol.

```bash
cd backend
npm ci
npm --prefix ../frontend ci
npm exec mops install
npm exec mops toolchain use moc 1.16.1
npm exec mops toolchain use wasmtime 50.0.0
npm run check
npm run build
npm test
npm --prefix ../frontend run build
```

The Motoko JSON library contains async helpers that WASI cannot compile, so the
Paw parser unit test uses the Motoko interpreter; geometry tests use pinned
Wasmtime; that WASI test renders only 25 trees because a single WASI message never
garbage-collects. The seeded-tree stress test runs bounded PocketIC queries to avoid
exhausting a single WASI invocation's memory. It checks 1,000 trees by default;
set `ART_SAMPLES` (a multiple of 20, at least 200) or run `npm run test:art:full`
for the 10,000-tree sweep, which takes several minutes.
`art-tests` in the mops manifest is a **test-only** canister and is not deployed
by [icp.yaml](icp.yaml). `art-lab` ([ArtLab.mo](backend/tools/ArtLab.mo)) is deployed
only by the `local` environment: the frontend then shows an **Art lab** page
(`/art-lab`) whose button renders 50 throwaway random trees from the art
algorithm per press. Nothing is minted, and mainnet never deploys it. PocketIC exercises fresh-chain installation and populated
same-chain upgrades, including pending purchases, artwork, approvals and history.

For deployment commands, follow [Deployment: local and mainnet](#deployment-local-and-mainnet)
below. Reinstall is an optional destructive operation, not the normal startup path.

Vite reads runtime canister IDs and the local root key from `icp-cli`, sets the
development `ic_env` cookie and proxies `/api`. Production uses the runtime
cookie and generated `@icp-sdk/bindgen` actors, not build-time canister IDs or
`fetchRootKey()`. The local network enables Internet Identity and configures
`http://uqzsh-gqaaa-aaaaq-qaada-cai.localhost:8765/authorize`; mainnet uses the
SDK's default `id.ai`. The explicit local frontend principal avoids depending
on the optional `id.ai.localhost` gateway alias. Local login uses a full-page
SDK redirect through `/auth`; mainnet keeps the default popup flow. The
certified, CORS-enabled `/.well-known/ii-auth-callbacks` allow-list is generated
at frontend sync time from the current local canister ID and gateway port,
so it remains correct after recreating local canisters. Vite development uses
`http://localhost:5173/auth`; update the development callback if changing that origin.
An already-running network started before `ii: true` was added must be restarted
by its operator to provision local II. Browser passkey creation requires a
human authenticator and must also be tested on the intended production origin.
The frontend uses `@dfinity/static-site`, with security/CSP/cache rules in
[_headers](frontend/public/_headers), SPA routing in
[_redirects](frontend/public/_redirects), and real 404 responses for missing
bundles and previews. Internet Identity can read the CORS-enabled
[app metadata](frontend/public/.well-known/ii-app-metadata). Local image URLs resolve the NFT canister from runtime
configuration and preserve the current gateway port.

The launcher's dummy-auth **Enter seed index** browser prompt blocks the II
page's JavaScript. With popup transport, leaving it open for more than the
SDK's heartbeat timeout reproduces **"Channel was closed before a response was
received"**. Local login therefore uses redirect transport: no live popup
channel is needed while the prompt is open. No heartbeat timeout or
certificate-verification settings are weakened.

For older deployments with the same error, check the network launcher as well
as npm dependencies. The June
2026 launcher serves the old `icrc34_delegation` flow, whereas auth 11 requests
`ii_session_delegation`. `icp network update` downloads a launcher but an older
global CLI can still select an older compatible release. Use `npm exec icp`
(the project pins CLI 1.7.0), update, then stop/start the local network.
Close stale login popups and reload the app to refresh the runtime root-key
cookie. Treat launcher changes as a potential local reset; export anything
important before restarting and redeploy if the local instance was recreated.

The local browser regression verifies redirect registration and consent while
deliberately leaving the seed prompt open for eight seconds:

```bash
npm exec -- playwright install chromium  # once, if Chromium is not installed
npm run test:auth:local                 # requires the deployed local network
npm run test:browser:local              # landing and post-mint growth; local mock payments
```

The launcher enables **dummy authentication**, not real biometric passkeys. On a
fresh network, choose **Create → Create with passkey**, give the identity a name,
then answer **Enter seed index** with a non-negative integer and approve
**Continue**. Remember that integer for later local sign-ins. It is a development
selector, not a secure password or wallet seed; never use these identities for
funds.

**`Cannot read properties of undefined (reading 'anchor_number')`** is a bug in
the local II dummy-auth sign-in path: it assumes the entered seed index already
has a registered identity. This happens when signing in before registration,
entering a different index, or reusing an identity from a reset local network.
Return to the current app, close stale popups, and create an identity on the
current network first. Do not reset the network or clear mainnet identity data
to address this. Local seed-index prompts are unrelated to real `https://id.ai`
passkeys.

The browser regression creates a fresh local test identity, approves consent,
checks the authenticated purchase page, reloads to verify session restoration,
and signs out/in again. A second, fresh browser context signs into that existing
identity with another eight-second prompt delay, checks the principal is unchanged,
and verifies the app returns to the original route. Both the named gateway alias
and canister-principal origin are covered. To run against an already-started Vite
server instead, use `AUTH_TEST_ORIGIN=http://localhost:5173 npm run test:auth:local`.
It needs no real passkey and does not test biometric approval.

For a corporate TLS proxy, install its trusted CA into the system trust store,
then optionally `source scripts/dev-env.sh`. That helper uses OpenSSL trust
without disabling certificate verification. Do not set
`NODE_TLS_REJECT_UNAUTHORIZED=0`.

Export an optional contact sheet from the actual Motoko renderer:

```bash
ART_OUTPUT_DIR=/absolute/output/directory \
  node --test --test-name-pattern='seeded trees' tests/canisters.test.mjs
```

This writes a 25-cell SVG contact sheet. Run `npm run build` and frontend
`bindings` first if the test Wasm/bindings do not exist. To regenerate the
landing page's checked-in animated sample pool, use `npm run samples:landing`.

### Repository hygiene

Commit source, package lockfiles, curated Candid interfaces, the migration chains,
the stable-signature baselines in `backend/deployed/reinstall/`, and the mainnet canister
mapping in `.icp/data/mappings/ic.ids.json`. The baseline directory's name is
historical; these signatures also protect normal, state-preserving upgrades.
Keep the pinned ICP skills and `skills-lock.json` together.

The root `.gitignore` excludes dependencies, caches, generated bindings, build
output, browser-test reports, local environment files and private-key files.
Do not commit wallet seeds, Paw keys or identity-password files. Runtime canister
configuration comes from `ic_env`; legacy `VITE_*` environment files are not used.
Before committing, run `npm run check`, `npm test` and
`npm --prefix ../frontend run build`, then review `git status --short` and the
staged diff. Do not remove applied migrations or the mainnet mapping as cleanup.

## Deployment: local and mainnet

Run commands from `backend/` in Bash (start with `cd backend` from the repository
root). Mainnet commands spend real ICP
and cycles; none of the commands below are run automatically by this README.

### 1. Install prerequisites and verify the build

Install Node.js 22+ and `ic-wasm`, then install the locked project dependencies.
The project pins ICP CLI 1.7.0 and mops 3.5.1; use `npm exec --` rather than an
older global CLI. Keep the pinned Motoko compiler: newer incompatible compilers
must not be substituted during deployment.

```bash
npm install -g @icp-sdk/ic-wasm
npm ci
npm --prefix ../frontend ci
npm exec -- mops install
npm exec -- mops toolchain use moc 1.16.1
npm exec -- mops toolchain use wasmtime 50.0.0
npm run check
npm run build
npm test
npm --prefix ../frontend run build
```

`npm test` checks 1,000 seeded trees. Run `npm run test:art:full` (several
minutes) for the 10,000-tree sweep after changing the art generator.
These tests use local test infrastructure, not payable Paw checkout.
If a corporate TLS proxy is required, install its trusted CA; see the TLS notes
above. Never disable TLS or certificate verification.

### 2. Local deployment (mock payments, no charges)

The checked-in local environment enables local Internet Identity and
`MOCK_PAYMENTS: "1"`. No Paw key is required or used for mock purchases.

```bash
# On initial setup, download the current compatible network launcher.
npm exec -- icp network update
npm exec -- icp network start -d
npm exec -- icp network status -e local --json

# First deployment installs; subsequent deployments upgrade existing canisters.
npm exec -- icp deploy -e local
npm exec -- icp canister status backend -e local
npm exec -- icp canister status icrc7 -e local
npm exec -- icp canister status frontend -e local
npm exec -- icp canister call backend paymentInfo '()' -e local --query
```

Expect `mock = true`. `configured = false` is normal for local mock mode.
Open **http://frontend.local.localhost:8765/mint**, create/sign into a local
identity as described above, and create a purchase. Mock mode automatically
simulates payment and mints; no Paw payment link is generated.

To run the browser regression:

```bash
npm exec -- playwright install chromium
npm run test:auth:local
```

For frontend development, leave the network running and use a second terminal:

```bash
npm --prefix ../frontend run dev
# Open http://localhost:5173
```

Local redirect callbacks are generated at sync time for the current gateway
and canister ID. Vite uses the declared `localhost:5173` callback. Different
app origins have different Internet Identity principals; use one origin
consistently. Do not stop/restart someone else's running network. Updating a
launcher does not replace the build in an already-running network, and a
launcher change/restart can recreate local state.

When finished with a network you started:

```bash
npm exec -- icp network stop
```

**Optional local reset only:** the following deletes all application purchases,
NFTs, approvals, history, artwork, and stored Paw configuration. It does not
mean a normal upgrade, nor does it itself reset the separate II canister.

```bash
npm exec -- icp deploy -e local --mode reinstall
```

Do not turn an existing mock collection into a live collection. For Paw sandbox
integration, use a separate deployment with `MOCK_PAYMENTS: "0"` at installation
and the sandbox configuration described below. Merely setting an API key does
not override mock mode. Mock mode is read when the backend actor initializes;
changing a running canister setting alone does not switch the active actor.

### 3. Mainnet identity and funding

Before proceeding, finish Paw merchant/domain approval and obtain a live key.
Confirm a card-eligible USDC asset and its EUR limits with Paw; `usdc_eth` is
only an example, not a verified merchant setting.

Use a dedicated production identity and securely back up its recovery material.
Never use the anonymous identity or plaintext key storage for production.

```bash
npm exec -- icp identity list
# Run only if this identity does not already exist. Securely retain its seed.
npm exec -- icp identity new bonsai-production --storage password
npm exec -- icp identity default bonsai-production
npm exec -- icp identity principal
npm exec -- icp identity account-id
npm exec -- icp token balance -n ic --identity bonsai-production
npm exec -- icp cycles balance -n ic --identity bonsai-production
```

Fund the printed account with ICP if necessary, then convert enough to cycles.
Three new canisters at the default 2T allocation require approximately
`3 * (2T + 100M) = 6.0003T` in the deployer's cycles-ledger balance. A 7T balance
provides an initial margin, not a long-term operating budget. Existing
deployments may need fewer creations; inspect `.icp/data/mappings/ic.ids.json`
before budgeting. Only run the conversion below if the balance is insufficient;
it spends ICP and adds 7T rather than setting the total balance to 7T.

```bash
npm exec -- icp cycles mint --cycles 7t -n ic --identity bonsai-production
npm exec -- icp cycles balance -n ic --identity bonsai-production
```

**Smaller budgets.** Creating a canister on a 13-node subnet burns a fixed 500B
fee out of its initial cycles. Each canister also locks its freezing threshold
(30 days for every canister; raise it in `icp.yaml` once well funded) of idle burn. To fund
canisters individually instead of 2T each, create them first with explicit
amounts (at least ~830B each: 500B creation fee plus ~330B that `install_code` requires up front for its 300B-instruction limit; the unused part stays in the canister), then deploy:

```bash
npm exec -- icp canister create icrc7 -e ic --cycles <amount> --identity bonsai-production
npm exec -- icp canister create backend -e ic --cycles <amount> --identity bonsai-production
npm exec -- icp canister create frontend -e ic --cycles <amount> --identity bonsai-production
npm exec -- icp deploy -e ic --identity bonsai-production
```

Top up later with `icp canister top-up <name> --amount <cycles> -e ic`.
Ongoing costs are dominated by sales: each Paw HTTPS outcall costs about 0.7B
cycles (64 KB response cap) and each mint runs art generation on `icrc7`.

### 4. Deploy all three canisters to mainnet

Confirm the `ic` environment in [icp.yaml](icp.yaml) has
`MOCK_PAYMENTS: "0"` and no local II URL override. Use fresh production
canisters, never mock-payment canisters or a local ID mapping.

```bash
npm exec -- icp deploy -e ic --identity bonsai-production
npm exec -- icp canister status backend -e ic --identity bonsai-production
npm exec -- icp canister status icrc7 -e ic --identity bonsai-production
npm exec -- icp canister status frontend -e ic --identity bonsai-production
npm exec -- icp canister status frontend -e ic --id-only
npm exec -- icp canister call backend paymentInfo '()' -e ic --query
```

Deploying the full environment injects sibling canister IDs automatically.
Record and version-control `.icp/data/mappings/ic.ids.json`; do not delete it.
Open `https://<frontend-id>.icp.net` using the printed frontend ID. Mainnet
uses `https://id.ai` authentication. Before configuring Paw, expect
`mock = false` and `configured = false`; purchase creation must report that
Paw is not configured, rather than minting for free.

### 5. Configure the Paw key after deployment

The API key is **not** a frontend environment variable, build argument, or
committed configuration value. A current backend controller calls
`configurePaw(key, asset, redirectOrigin, sandbox)`. The original deployer is
a controller unless controllers have subsequently changed.

The following Bash subshell uses Python 3's hidden prompt and a temporary
owner-only file. The key is not placed in command-line arguments or shell
history. Run on a trusted operator machine without session recording or debug
logging. Replace the prompted asset and origin with approved merchant values;
the origin must be HTTPS without a trailing slash.

```bash
(
  set -eu
  umask 077
  args_file="$(mktemp)"
  trap 'rm -f -- "$args_file"' EXIT
  python3 - "$args_file" <<'PY'
import getpass
import sys

def candid_text(value):
    return '"' + ''.join('\\%02x' % b for b in value.encode('utf-8')) + '"'

key = getpass.getpass("Paw LIVE API key: ")
asset = input("Approved USDC asset (for example usdc_eth): ").strip()
origin = input("Approved HTTPS frontend origin (no trailing slash): ").strip()
if not key or key.startswith("sk_sandbox_"):
    raise SystemExit("A nonempty live key is required.")
with open(sys.argv[1], "w", encoding="ascii") as output:
    output.write("(" + ", ".join(map(candid_text, [key, asset, origin])) + ", false)")
PY
  npm exec -- icp canister call backend configurePaw \
    --args-file "$args_file" --args-format candid \
    -e ic --identity bonsai-production
)
npm exec -- icp canister call backend paymentInfo '()' -e ic --query
```

Require `variant { ok }` from `configurePaw`; an `err` result is not success,
even if the CLI process exits normally. Then verify `mock = false`,
`configured = true`, `sandbox = false`, and the expected asset.
The key is stored in persistent backend state and sent only in Paw HTTPS
outcalls. It survives normal upgrades but is erased by reinstall. Subnet
operators can access canister state: this is not confidential secret storage.
Temporary file deletion is not a guarantee of secure erasure from disk/backups.

For a **separate sandbox deployment**, use its own environment/controller in
the call, a `sk_sandbox_…` key, and `true` as the fourth argument. Do not run the
live-key snippet unchanged for sandbox. Paw sandbox hosted checkout cannot be
paid; use Paw's documented simulation flow instead.

### Custom domain (icpbonsai.app)

The frontend already serves `/.well-known/ic-domains` (listing `icpbonsai.app`
and `www.icpbonsai.app`) and `/.well-known/ii-alternative-origins`. On those
domains, sign-in uses `derivationOrigin = https://<frontend-id>.icp.net`, read
from the `ic_env` cookie, so each user keeps one principal on every URL. The
derivation origin must never change once users exist. After deploying, in the
registrar's DNS panel (Namecheap: Advanced DNS) remove the parking `A`/`CNAME`
records and any URL-redirect records, then add:

| Type | Host | Value |
|---|---|---|
| ALIAS | `@` | `icpbonsai.app.icp1.io` |
| TXT | `_canister-id` | `<frontend-id>` |
| CNAME | `_acme-challenge` | `_acme-challenge.icpbonsai.app.icp2.io` |
| CNAME | `www` | `www.icpbonsai.app.icp1.io` |
| TXT | `_canister-id.www` | `<frontend-id>` |
| CNAME | `_acme-challenge.www` | `_acme-challenge.www.icpbonsai.app.icp2.io` |

Keep exactly one `_canister-id` TXT record per name, and do not enable any
registrar SSL/TLS product. Then validate and register each domain:

```bash
for d in icpbonsai.app www.icpbonsai.app; do
  curl -sL "https://icp.net/custom-domains/v1/$d/validate"
  curl -sL -X POST "https://icp.net/custom-domains/v1/$d"
done
curl -sL "https://icp.net/custom-domains/v1/icpbonsai.app"   # wait for "registered"
```

Use `https://icpbonsai.app` as the Paw redirect origin in `configurePaw` and in
the Paw merchant domain approval.

### 6. Verify production and maintain deployments

1. Sign in on the production origin and check the gallery and collection pages.
2. With explicit authorization for a real-money test, create a purchase and
   click **Open / reopen secure checkout**. The link is not auto-opened.
3. Complete the approved live payment. Merely opening or returning from checkout
   must not mint; the backend must verify Paw settlement first.
4. Check status until the NFT is minted, verify its canonical image, reload, and
   confirm it remains in the owner's collection. Never create/pay a second
   invoice solely to retry fulfillment.
5. Monitor each canister's cycles and top up before its freezing threshold;
   refunds and Paw withdrawals remain manual operator responsibilities.

For later state-preserving releases, rerun the verification in step 1, review
the migration chain and compatibility before deployment, then use:

```bash
npm exec -- icp deploy -e ic --identity bonsai-production
npm exec -- icp canister call backend paymentInfo '()' -e ic --query
```

Do **not** add `--mode reinstall` on mainnet: it wipes purchases, NFT ownership,
artwork, history, and the Paw key. For frontend-only changes, preserve all
backend state and regenerate the deployment-specific callbacks with:

```bash
npm --prefix ../frontend run build
npm exec -- icp sync frontend -e ic --identity bonsai-production
# For the local frontend instead:
# npm exec -- icp sync frontend -e local
```

## Paw configuration and environments

- **Local mock:** `MOCK_PAYMENTS=1` at initial installation. No provider request,
  checkout or real charge. Recurring polling survives upgrades and mints test NFTs.
- **Paw sandbox:** install a separate non-mock test backend and configure a
  `sk_sandbox_...` key with `sandbox=true`. Use Paw's documented simulate endpoint
  to change invoice status. Sandbox does **not** support payable hosted checkout,
  real cards, balances or payouts.
- **Live:** separate production canisters, `MOCK_PAYMENTS=0`, a live key and
  `sandbox=false`. Never repurpose mock NFT collections as production.

Paw routes the environment by API-key prefix. A supplied invoice `sandbox`
marker must agree; Paw only guarantees that marker on webhooks, so an absent
GET marker is not assumed to mean live. Environment changes are blocked while
purchases remain pending.

After merchant/domain approval, select a card-eligible USDC asset from Paw's
catalog and confirm its EUR minimum/maximum against this app's price range (EUR 49-999).
`usdc_eth` is an example/default, **not a verified merchant configuration**.
Configure with a current backend controller identity. Controller changes take
effect immediately; authorization does not depend on the original installer:

Use the hidden-prompt procedure in [deployment step 5](#5-configure-the-paw-key-after-deployment)
or your secure operator tooling to supply the actual key. No automated
production deployment or real-money card test is part of the test suite.

### Recovery / operations

- Customer: reopen the saved checkout or use **Check status / retry fulfillment**.
  Do not create/pay a second invoice just to retry minting.
- Operator: `reconciliationQueue()` lists saved failures and unknown creations.
- A lost creation response is **never automatically POSTed again**: Paw has no
  documented invoice-create idempotency key. A bounded date-window listing
  matches the opaque `extra`; a replicated invoice GET still authorizes payment.
- Read endpoints do not return the checkout's external credential. A recovered
  invoice may need operator help to regain a checkout link; the app does not
  manufacture one from an order ID.
- `attachPawInvoice(purchaseId, orderId)` attaches a dashboard-verified invoice
  to a creation with no known ID; normal replicated checks must still pass.
- `closeUnknownPurchase(purchaseId, reason)` releases a permanently unknown
  creation **only after checking Paw for any invoice/payment**. It cannot close
  known invoices or paid/seeded purchases. Record the reconciliation evidence.
  A late-discovered payment after manual closure requires manual remediation.
- Expired/cancelled partial payments, merchant credits, refunds, chargebacks
  and treasury withdrawals require dashboard reconciliation and accounting.
- Monitor cycles, pending capacity, errors and the provider's catalog/limits.
  Polling uses paid HTTPS outcalls; backoff and caps do not remove that cost.

## ICP skill alignment and explicit exceptions

Current DFINITY skills were fetched from
[skills.internetcomputer.org/llms.txt](https://skills.internetcomputer.org/llms.txt)
and twelve relevant skills are pinned in [skills-lock.json](skills-lock.json).
[AGENTS.md](AGENTS.md) offers updates at the start of future sessions rather
than silently changing the guidance/toolchain.

Applied: project-local mops and pinned compiler/core/linter, generated Candid and
SDK bindings, runtime environment/auth, typed public payment errors and JSON,
replicated settlement checks, bounded idempotent inter-canister fulfillment,
observable polling, certified images/history and upgrade regression tests.
Backend and NFT actors are composition roots with explicit state declarations;
initial values live in self-contained timestamped migration chains, while types,
rendering, hashing and service endpoints are separate modules. NFT/backend
wiring is resolved from runtime environment variables when minting, without
post-deployment principal setters. The static frontend uses the current recipe.

**Deliberate exceptions / launch gates:**

1. **API-key custody:** the user-approved canister-only design stores the Paw
   key in canister state and sends it through HTTPS outcalls. Standard subnet
   node operators can inspect it. Encryption unlocked by the same canister does
   not fix this. Use least-privilege keys, rotation and balance limits; an
   external credential-holding bridge would be needed to change this boundary.
2. **Compiler compatibility:** Motoko 1.16.1 is pinned. Motoko 2.0.0 fails to
   compile the published certification/JSON dependency graph because legacy
   `base` modules reference removed stable-memory primitives. Dependencies are
   not patched locally; revisit the pin once compatible releases are available.
3. **Operational validation:** confirm actual Paw invoice/asset responses,
   EUR limits, card eligibility, fees, refund access and merchant approval, then
   perform an explicitly authorized small live payment. Sandbox cannot verify
   card checkout. Browser Internet Identity login/account continuity also needs
   acceptance testing on the intended deployed origin.

The authorized reset targets **local only**, not mainnet. After this fresh-chain
release, use ordinary upgrades to preserve its data, keep enhanced
orthogonal-persistence Wasm memory, and append migrations for state changes.
Do not rewrite already-deployed migration files. The PocketIC tests use
`wasm_memory_persistence = keep`; [mops.toml](backend/mops.toml) records the new deployed
stable baselines separately from the pre-reinstall baselines. Back up and
rehearse before any future mainnet action; never reinstall real purchases/NFTs
without a separate, explicit decision to destroy them.

The historical [Sweden launch research](docs/sweden-launch-research.md) is
Guardarian-specific, not legal/tax approval for the Paw/Stripe/USDC model.
