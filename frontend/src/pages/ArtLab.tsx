import { useCallback, useEffect, useState } from "react";
import { artLabActor, artLabId, type ArtLabPreview } from "../lib/actors";
import { svgDataUrl } from "../lib/growth";
import { TIERS } from "../lib/tiers";

const TOTAL = 50;
const BATCH = 20;
const STYLES = ["Formal upright", "Informal upright", "Gnarled", "Semi-cascade", "Multi-trunk"];

/** Local-only playground: renders throwaway trees from the on-chain art algorithm. Nothing is minted. */
export function ArtLab() {
  const [trees, setTrees] = useState<ArtLabPreview[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const available = artLabId() !== undefined;

  const generate = useCallback(async () => {
    setBusy(true);
    setError(null);
    try {
      const actor = artLabActor();
      const batches: Promise<ArtLabPreview[]>[] = [];
      for (let start = 0; start < TOTAL; start += BATCH) {
        batches.push(actor.preview(crypto.getRandomValues(new Uint8Array(32)), BigInt(Math.min(BATCH, TOTAL - start))));
      }
      setTrees((await Promise.all(batches)).flat());
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }, []);

  useEffect(() => {
    if (available) void generate();
  }, [available, generate]);

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h2 className="font-display text-3xl font-semibold">Art lab</h2>
          <p className="text-sm text-slate-400">
            {TOTAL} random trees straight from the on-chain art algorithm. Local development only; nothing is minted.
          </p>
        </div>
        <button onClick={generate} className="btn-primary px-5 py-2" disabled={busy || !available}>
          {busy ? "Growing…" : `Generate ${TOTAL}`}
        </button>
      </header>

      {!available && (
        <div className="glass p-6 text-sm text-slate-300">
          The art-lab canister is not deployed in this environment. Run <code>icp deploy -e local</code> to use this page.
        </div>
      )}

      {error && (
        <div role="alert" className="glass rounded-xl border border-red-500/30 bg-red-500/10 p-4 text-sm text-red-200">{error}</div>
      )}

      <p role="status" className={busy ? "flex items-center gap-2 text-sm text-slate-300" : "sr-only"}>
        {busy ? (
          <>
            <span aria-hidden="true" className="h-4 w-4 rounded-full border-2 border-slate-600 border-t-emerald-300 motion-safe:animate-spin" />
            Growing {TOTAL} bonsais. Generating shapes, shading and previews…
          </>
        ) : trees.length > 0 ? `${trees.length} bonsai previews ready.` : ""}
      </p>

      <section aria-label="Bonsai previews" aria-busy={busy}>
      {busy ? (
        <ul aria-hidden="true" className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-5 lg:grid-cols-10">
          {Array.from({ length: TOTAL }, (_, index) => (
            <li key={index} className="glass overflow-hidden p-1.5 motion-safe:animate-pulse">
              <div className="aspect-square w-full rounded bg-slate-700/50" />
              <div className="mt-1 flex h-4 items-center">
                <div className="h-2 w-4/5 rounded bg-slate-700/50" />
              </div>
            </li>
          ))}
        </ul>
      ) : trees.length > 0 && (
        <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-5 lg:grid-cols-10">
          {trees.map((tree, index) => (
            <li key={index} className="glass overflow-hidden p-1.5">
              <img
                src={svgDataUrl(tree.svg)}
                alt={`${STYLES[Number(tree.style)] ?? "Bonsai"} preview`}
                className="aspect-square w-full rounded [image-rendering:pixelated]"
              />
              <p className="mt-1 truncate text-[11px] text-slate-400" title={STYLES[Number(tree.style)]}>
                {TIERS[Number(tree.tier)]?.name ?? `Tier ${tree.tier}`} · {STYLES[Number(tree.style)] ?? `Style ${tree.style}`}
                {!tree.valid && <span className="text-red-300"> · invalid</span>}
              </p>
            </li>
          ))}
        </ul>
      )}
      </section>
    </div>
  );
}
