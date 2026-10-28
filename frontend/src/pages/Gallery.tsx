import { useEffect, useState } from "react";
import { icrc7Actor } from "../lib/actors";
import { BonsaiCollection } from "../components/BonsaiCollection";
import type { NftPublic } from "../lib/idl";

export function Gallery() {
  const [nfts, setNfts] = useState<NftPublic[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const ic = await icrc7Actor();
        const list = await ic.listPage(null, 60n);
        if (!cancelled) { setNfts(list); setHasMore(list.length === 60); }
      } catch (e: unknown) {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <div className="space-y-6">
      <header>
        <h2 className="font-display text-3xl font-semibold">The grove</h2>
        <p className="text-sm text-slate-400">
          Explore the collection. {nfts && `${nfts.length} loaded.`}
        </p>
      </header>

      {error && (
        <div className="glass rounded-xl border border-red-500/30 bg-red-500/10 p-4 text-sm text-red-200">
          {error}
        </div>
      )}

      {nfts === null && (
        <div className="glass p-10 text-center text-slate-400">Loading…</div>
      )}

      {nfts && nfts.length === 0 && (
        <div className="glass p-10 text-center text-slate-400">
          The grove is still empty. Be the first to plant one.
        </div>
      )}

      {nfts && nfts.length > 0 && (
        <BonsaiCollection nfts={nfts} />
      )}
      {hasMore && <button disabled={loadingMore} className="btn-ghost" onClick={async () => {
        setLoadingMore(true);
        try {
          const last = nfts?.[nfts.length - 1];
          if (!last) return;
          const next = await (await icrc7Actor()).listPage(last.id, 60n);
          setNfts((previous) => [...previous ?? [], ...next]);
          setHasMore(next.length === 60);
        } catch (e) { setError(e instanceof Error ? e.message : String(e)); }
        finally { setLoadingMore(false); }
      }}>Load more bonsai</button>}
    </div>
  );
}
