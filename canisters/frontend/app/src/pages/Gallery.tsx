import { useCallback, useEffect, useState } from "react";
import { icrc7Actor } from "../lib/actors";
import { BonsaiCollection } from "../components/BonsaiCollection";
import { LoadMore } from "../components/LoadMore";
import { useCursorList } from "../hooks/useCursorList";
import type { NftPublic } from "../lib/idl";

export const PAGE_SIZE = 24;

export function Gallery() {
  const [total, setTotal] = useState<bigint | null>(null);
  const fetchPage = useCallback(async (before: bigint | null) => {
    const items = await (await icrc7Actor()).listPage(before, BigInt(PAGE_SIZE));
    return { items, next: items.length === PAGE_SIZE ? items[items.length - 1]!.id : null };
  }, []);
  const { items: nfts, hasMore, loading, error, loadMore, refresh } = useCursorList<NftPublic, bigint>({ key: "gallery", fetchPage });

  useEffect(() => {
    let cancelled = false;
    icrc7Actor().then((ic) => ic.icrc7_total_supply()).then((n) => { if (!cancelled) setTotal(n); }).catch(() => {});
    return () => { cancelled = true; };
  }, []);

  return (
    <div className="space-y-6">
      <header>
        <h2 className="font-display text-3xl font-semibold">The grove</h2>
        <p className="text-sm text-slate-400">
          Explore the collection.{" "}
          {nfts && (total !== null ? `Showing ${nfts.length} of ${total.toString()} bonsai.` : `${nfts.length} loaded.`)}
        </p>
      </header>

      {error && nfts === null && (
        <div role="alert" className="glass rounded-xl border border-red-500/30 bg-red-500/10 p-4 text-sm text-red-200">
          {error} <button className="underline" onClick={refresh}>Try again</button>
        </div>
      )}

      {nfts === null && !error && (
        <div className="glass p-10 text-center text-slate-400">Loading…</div>
      )}

      {nfts && nfts.length === 0 && (
        <div className="glass p-10 text-center text-slate-400">
          The grove is still empty. Be the first to plant one.
        </div>
      )}

      {nfts && nfts.length > 0 && (
        <>
          <BonsaiCollection nfts={nfts} />
          <LoadMore hasMore={hasMore} loading={loading} onLoad={() => void loadMore()} label="Load more bonsai"
            endLabel={nfts.length > PAGE_SIZE ? "You've reached the first bonsai ever planted." : undefined}
            error={error} onRetry={() => void loadMore()} />
        </>
      )}
    </div>
  );
}
