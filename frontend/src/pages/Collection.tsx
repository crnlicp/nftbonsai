import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import type { Token } from "../bindings/backend";
import { CopyButton } from "../components/CopyButton";
import { useAuthContext } from "../components/AuthProvider";
import { backendActor, icrc7Actor } from "../lib/actors";
import { canisterEnv, collectionLogoUrl, isLocalNetwork, nftImageUrl } from "../lib/env";

const ICP_LEDGER = "ryjl3-tyaaa-aaaaa-aaaba-cai";

interface CanisterRow {
  name: string;
  id: string;
  role: string;
  highlight?: boolean;
}

function dashboardUrl(id: string) {
  return `https://dashboard.internetcomputer.org/canister/${id}`;
}

function CanisterCard({ row, local }: { row: CanisterRow; local: boolean }) {
  return (
    <li className={`glass-inset min-w-0 space-y-2 p-4 ${row.highlight ? "ring-1 ring-moss-300/50" : ""}`}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="font-medium">{row.name}</p>
        {row.highlight && <span className="rounded-full bg-moss-400/20 px-2 py-0.5 text-[11px] font-medium text-moss-100">Import this in your wallet</span>}
      </div>
      <p className="text-xs text-slate-400">{row.role}</p>
      <div className="flex flex-wrap items-center gap-2">
        <code className="w-full min-w-0 break-all rounded-md bg-black/30 px-2 py-1.5 text-xs sm:w-auto sm:flex-1" data-testid={`canister-${row.name}`}>{row.id}</code>
        <CopyButton value={row.id} label={`Copy ${row.name} canister ID`} className="btn-ghost px-3 py-1.5 text-xs" />
        {!local && (
          <a className="btn-ghost px-3 py-1.5 text-xs" href={dashboardUrl(row.id)} target="_blank" rel="noopener noreferrer">
            Dashboard ↗
          </a>
        )}
      </div>
    </li>
  );
}

export function Collection() {
  const { principal } = useAuthContext();
  const [token, setToken] = useState<Token>();
  const [supply, setSupply] = useState<bigint>();
  const [logoFailed, setLogoFailed] = useState(false);

  let env: ReturnType<typeof canisterEnv> | null = null;
  let configError: string | null = null;
  try { env = canisterEnv(); } catch (e: unknown) { configError = e instanceof Error ? e.message : String(e); }
  const nftId = env?.["PUBLIC_CANISTER_ID:icrc7"] ?? "";
  const local = isLocalNetwork();

  useEffect(() => {
    if (!env) return;
    let cancelled = false;
    backendActor().then((b) => b.marketPolicy()).then((p) => { if (!cancelled) setToken(p.token); }).catch(() => {});
    icrc7Actor().then((ic) => ic.icrc7_total_supply()).then((n) => { if (!cancelled) setSupply(n); }).catch(() => {});
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nftId]);

  if (!env) return <div role="alert" className="glass p-6 text-sm text-red-200">{configError}</div>;

  const rows: CanisterRow[] = [
    { name: "NFT collection", id: nftId, role: "ICRC-7 / ICRC-37 ledger holding every bonsai, its on-chain SVG artwork and the certified ICRC-3 history.", highlight: true },
    { name: "Mint & marketplace", id: env["PUBLIC_CANISTER_ID:backend"]!, role: "Takes payments, mints new bonsai and settles listings in ICP or $BONSAI." },
    ...(env["PUBLIC_CANISTER_ID:frontend"] ? [{ name: "Web app", id: env["PUBLIC_CANISTER_ID:frontend"], role: "This website, served from an asset canister." }] : []),
    { name: "ICP ledger", id: env["PUBLIC_CANISTER_ID:icp_ledger"] ?? ICP_LEDGER, role: "Payments and listings priced in ICP." },
    ...(token ? [{ name: `$${token.symbol} ledger`, id: token.ledger.toText(), role: `Payments and listings priced in $${token.symbol}.` }] : []),
  ];

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <header className="glass flex flex-col items-center gap-5 p-6 text-center sm:flex-row sm:text-left">
        {!logoFailed && (
          <img src={collectionLogoUrl()} alt="ICPBonsai collection logo" width={96} height={96} onError={() => setLogoFailed(true)}
            className="h-24 w-24 shrink-0 rounded-2xl bg-black/20 p-2" />
        )}
        <div className="min-w-0 space-y-2">
          <h1 className="font-display text-3xl font-semibold">On-chain &amp; in your wallet</h1>
          <p className="text-sm text-slate-300">
            Every ICPBonsai lives in an ICRC-7 NFT canister on the Internet Computer: artwork, ownership and trade history
            are all on-chain{supply !== undefined && <> ({supply.toString()} bonsai minted so far)</>}.
          </p>
          <div className="flex flex-wrap justify-center gap-1.5 sm:justify-start">
            {["ICRC-7 NFTs", "ICRC-37 approvals", "ICRC-3 certified history", "On-chain SVG"].map((tag) => (
              <span key={tag} className="rounded-full bg-white/10 px-2.5 py-0.5 text-[11px] text-slate-200">{tag}</span>
            ))}
          </div>
        </div>
      </header>

      <section className="glass space-y-4 p-4 sm:p-6" aria-labelledby="canisters-heading">
        <h2 id="canisters-heading" className="font-display text-xl font-semibold">Canister IDs</h2>
        <ul className="grid gap-3 md:grid-cols-2">
          {rows.map((row) => <CanisterCard key={row.name} row={row} local={local} />)}
        </ul>
      </section>

      <section className="glass space-y-4 p-4 sm:p-6" aria-labelledby="wallets-heading">
        <h2 id="wallets-heading" className="font-display text-xl font-semibold">See your bonsai in OISY or another wallet</h2>
        <div className="rounded-xl border border-amber-300/30 bg-amber-300/10 p-3 text-xs text-amber-100">
          <strong>Good to know:</strong> Internet Identity gives you a different principal for every app. Bonsai minted here belong
          to your ICPBonsai principal{principal && <> (<code className="break-all">{principal}</code>)</>}, which other wallets
          cannot sign for. To hold a bonsai in OISY, send it to your OISY principal first.
        </div>
        <ol className="space-y-3 text-sm text-slate-200">
          <li className="glass-inset p-4">
            <p className="font-medium">1. Copy your wallet principal</p>
            <p className="mt-1 text-xs text-slate-400">In OISY, open <em>Receive</em> and copy your Internet Computer principal (not an account ID).</p>
          </li>
          <li className="glass-inset p-4">
            <p className="font-medium">2. Send the bonsai</p>
            <p className="mt-1 text-xs text-slate-400">
              In <Link className="text-moss-200 underline" to="/my-nfts">My bonsai</Link>, open a bonsai's <em>Details</em> →
              {" "}<em>Send</em> tab and paste that principal. Unlist it first if it is for sale. Once sent it leaves “My bonsai” here
              but stays visible in the <Link className="text-moss-200 underline" to="/gallery">Gallery</Link>.
            </p>
          </li>
          <li className="glass-inset p-4">
            <p className="font-medium">3. Import the collection</p>
            <p className="mt-1 text-xs text-slate-400">
              In OISY, go to the NFT tab and choose to add/import a custom token or collection on the Internet Computer network,
              then paste the <strong>NFT collection</strong> canister ID:
            </p>
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <code className="min-w-0 flex-1 break-all rounded-md bg-black/30 px-2 py-1.5 text-xs">{nftId}</code>
              <CopyButton value={nftId} label="Copy NFT collection canister ID" className="btn-ghost px-3 py-1.5 text-xs" />
            </div>
            <p className="mt-2 text-xs text-slate-500">Menu names can change between wallet versions; look for “import” or “custom token”.</p>
          </li>
        </ol>
        <p className="text-xs text-slate-400">
          <strong className="text-slate-300">Plug and others:</strong> Plug lists NFTs from its own registry and may not show ICRC-7
          collections yet. Any wallet that supports ICRC-7 can import the canister ID above; ownership is always verifiable on the
          {" "}{local ? "ICP dashboard" : <a className="text-moss-200 underline" href={dashboardUrl(nftId)} target="_blank" rel="noopener noreferrer">ICP dashboard ↗</a>}.
        </p>
      </section>

      <section className="glass space-y-3 p-4 sm:p-6" aria-labelledby="images-heading">
        <h2 id="images-heading" className="font-display text-xl font-semibold">Images &amp; metadata</h2>
        <p className="text-sm text-slate-300">
          Artwork is generated and stored on-chain as SVG, served with HTTP certification straight from the NFT canister.
          Wallets read the collection logo from <code>icrc7:logo</code> and each bonsai's picture from <code>icrc7:image</code>.
        </p>
        <dl className="grid gap-2 text-xs sm:grid-cols-[auto_1fr] sm:gap-x-4">
          <dt className="text-slate-400">Collection logo</dt>
          <dd className="break-all"><a className="text-moss-200 underline" href={collectionLogoUrl()} target="_blank" rel="noopener noreferrer">{collectionLogoUrl()}</a></dd>
          <dt className="text-slate-400">Bonsai image</dt>
          <dd className="break-all font-mono">{nftImageUrl(0n).replace(/0\.svg$/, "")}&lt;id&gt;.svg</dd>
        </dl>
      </section>
    </div>
  );
}
