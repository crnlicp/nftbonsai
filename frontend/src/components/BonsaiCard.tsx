import { useEffect, useRef, useState, type ReactNode } from "react";
import type { MintDetails } from "../bindings/backend";
import type { NftPublic } from "../lib/idl";
import { formatIcp } from "../lib/ledger";
import { bonsaiDescription } from "../lib/render";
import { TIERS } from "../lib/tiers";
import { BonsaiSvg } from "./BonsaiSvg";

export interface BonsaiDetails {
  mint: MintDetails | null;
  version: bigint | null;
}

function PrincipalId({ value }: { value: string }) {
  return (
    <details className="text-xs leading-5 text-slate-200">
      <summary className="cursor-pointer rounded-sm font-mono text-moss-100 focus-visible:outline focus-visible:outline-2 focus-visible:outline-moss-300" title={value}>
        {value.length > 16 ? `${value.slice(0, 5)}...${value.slice(-5)}` : value}
      </summary>
      <p className="mt-1 break-all font-mono text-slate-300">{value}</p>
    </details>
  );
}

function mintPrice(price: MintDetails["price"]): string {
  if (!price) return "Not recorded";
  if (price.__kind__ === "eur") return `${price.eur.toLocaleString()} EUR`;
  const amount = price.__kind__ === "icp" ? price.icp : price.token;
  return `${formatIcp(amount, 8)} ${price.__kind__ === "icp" ? "ICP" : "$BONSAI"}`;
}

function BonsaiDialog({ nftId, children, onClose }: {
  nftId: bigint;
  children: ReactNode;
  onClose: () => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const dialog = ref.current;
    const overflow = document.body.style.overflow;
    dialog?.showModal();
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = overflow;
    };
  }, []);

  return (
    <dialog
      ref={ref}
      aria-labelledby={`bonsai-details-${nftId}`}
      onClose={onClose}
      onClick={(event) => {
        if (event.target === event.currentTarget) ref.current?.close();
      }}
      className="m-auto max-h-[90dvh] w-[calc(100%-2rem)] max-w-3xl overflow-y-auto rounded-2xl border border-white/15 bg-[#0b1f24] p-0 text-slate-100 shadow-glass backdrop:bg-slate-950/75 backdrop:backdrop-blur-sm"
    >
      <div>
        <header className="sticky top-0 z-10 flex items-center justify-between gap-3 border-b border-white/10 bg-[#0b1f24] px-5 py-4">
          <h2 id={`bonsai-details-${nftId}`} className="font-display text-xl font-semibold">Bonsai #{nftId.toString()}</h2>
          <button autoFocus className="btn-ghost px-3 py-2 text-sm" onClick={() => ref.current?.close()}>Close details</button>
        </header>
        {children}
      </div>
    </dialog>
  );
}

export function BonsaiCard({ nft, details, failed }: {
  nft: NftPublic;
  details?: BonsaiDetails;
  failed: boolean;
}) {
  const [open, setOpen] = useState(false);
  const mint = details?.mint;
  const tier = mint?.artTier === undefined ? undefined : TIERS[Number(mint.artTier)];
  const created = new Date(Number(nft.createdAt / 1_000_000n));
  const pending = !details && !failed;
  const missing = pending ? "Loading..." : failed && !details ? "Unavailable" : "Not recorded";
  const silhouetteStamp = details?.version !== null && details?.version !== undefined && details.version >= 8n;
  const description = bonsaiDescription(nft.traits);
  const price = mint ? mintPrice(mint.price) : missing;

  return (
    <>
      <article aria-labelledby={`bonsai-${nft.id}`} className="glass flex h-full min-w-0 flex-col overflow-hidden">
        <div className="relative p-3 pb-0">
          <div className="glass-inset overflow-hidden p-2">
            <BonsaiSvg nftId={nft.id} alt={description} onClick={() => setOpen(true)} />
          </div>
          {mint?.lucky && (
            <span className="pointer-events-none absolute left-6 top-6 rounded-full border border-amber-300/40 bg-slate-950/90 px-3 py-1 text-xs font-medium text-amber-200">
              <span aria-hidden="true" className="mr-1">✦</span>Lucky bloom
            </span>
          )}
        </div>
        <div className="flex flex-1 flex-col gap-3 p-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h3 id={`bonsai-${nft.id}`} className="font-display text-xl font-semibold">
              <button aria-haspopup="dialog" className="rounded-sm text-left transition hover:text-moss-200 focus-visible:outline focus-visible:outline-2 focus-visible:outline-moss-300" onClick={() => setOpen(true)}>
                Bonsai #{nft.id.toString()}
              </button>
            </h3>
            {tier && <span className="rounded-full border border-white/10 bg-white/5 px-2.5 py-1 text-xs font-medium" style={{ color: tier.aura }}>{tier.name}</span>}
          </div>
          <p className="text-sm capitalize leading-relaxed text-slate-300">{description}.</p>
          <div className="mt-auto flex flex-wrap items-end justify-between gap-3 border-t border-white/10 pt-3">
            <div className="min-w-0">
              <p className="text-xs text-slate-400">Mint price{mint?.testMint ? " (test)" : ""}</p>
              <p className="mt-1 break-words font-display text-lg font-semibold text-moss-200">{price}</p>
            </div>
            <button aria-haspopup="dialog" className="btn-ghost px-3 py-2 text-xs" onClick={() => setOpen(true)}>View details</button>
          </div>
        </div>
      </article>

      {open && (
        <BonsaiDialog nftId={nft.id} onClose={() => setOpen(false)}>
          <div className="grid gap-5 p-5 md:grid-cols-2 md:items-start md:p-6">
            <div className="glass-inset mx-auto w-full max-w-64 overflow-hidden p-2 md:sticky md:top-24 md:max-w-none">
              <BonsaiSvg nftId={nft.id} alt={description} />
            </div>
            <div className="min-w-0 space-y-4">
              <div className="flex flex-wrap gap-2">
                {tier && <span className="rounded-full border border-white/10 bg-white/5 px-3 py-1 text-xs font-medium" style={{ color: tier.aura }}>{tier.name}</span>}
                {mint?.lucky && <span className="rounded-full border border-amber-300/30 bg-amber-300/10 px-3 py-1 text-xs text-amber-200">Lucky bloom</span>}
              </div>
              <p className="text-sm capitalize leading-relaxed text-slate-300">{description}.</p>
              <dl className="grid min-w-0 grid-cols-2 gap-3 text-sm">
                <div className="col-span-2 rounded-xl border border-moss-300/10 bg-moss-500/5 px-3 py-2.5">
                  <dt className="text-xs text-slate-400">Mint price{mint?.testMint ? " (test mint)" : ""}</dt>
                  <dd className="mt-1 break-words font-display text-lg font-semibold text-moss-200">{price}</dd>
                </div>
                <div className="min-w-0">
                  <dt className="mb-1 text-xs text-slate-400">Creator / minter</dt>
                  <dd>{mint ? <PrincipalId value={mint.creator.toText()} /> : <span className="text-xs text-slate-300">{missing}</span>}</dd>
                </div>
                <div className="min-w-0">
                  <dt className="mb-1 text-xs text-slate-400">Current owner</dt>
                  <dd><PrincipalId value={nft.owner.toText()} /></dd>
                </div>
                <div className="col-span-2">
                  <dt className="mb-1 text-xs text-slate-400">Minted <span className="text-slate-500">/ your local time</span></dt>
                  <dd>
                    <time dateTime={created.toISOString()} className="flex flex-wrap justify-between gap-x-3 gap-y-1 text-xs text-slate-200">
                      <span>{created.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" })}</span>
                      <span>{created.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit", second: "2-digit", timeZoneName: "short" })}</span>
                    </time>
                  </dd>
                </div>
              </dl>

              <div className="flex flex-wrap gap-1.5 text-xs text-slate-300">
                <span className="rounded-md bg-white/5 px-2 py-1">{nft.traits.branchCount} primary branches</span>
                {tier && <span className="rounded-md bg-white/5 px-2 py-1">{tier.potName} pot</span>}
                <span className="rounded-md bg-white/5 px-2 py-1">64 x 64 pixel art</span>
              </div>

              <div className="border-t border-white/10 pt-3">
                <h4 className="text-xs font-medium text-moss-200">{silhouetteStamp ? "The pot's secret signature" : "Behind the pixels"}</h4>
                <p className="mt-1 text-xs leading-relaxed text-slate-400">
                  {silhouetteStamp
                    ? "Look at the pot: its white 7 x 7 stamp is a miniature of this very tree's silhouette."
                    : "Each bonsai is generated on the Internet Computer, with its artwork stored on-chain."}
                </p>
                {mint?.lucky && <p className="mt-2 text-xs leading-relaxed text-amber-200">A lucky roll, decided by on-chain randomness at mint time.</p>}
              </div>
            </div>
          </div>
        </BonsaiDialog>
      )}
    </>
  );
}
