import { useCallback, useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import type { Listing } from "../bindings/backend";
import { backendActor } from "../lib/actors";
import { marketPrice, saleStatus } from "../lib/marketplace";
import { formatIcp } from "../lib/ledger";
import { BALANCE_POLL_MS } from "../lib/polling";
import { useCursorList } from "../hooks/useCursorList";
import { LoadMore } from "./LoadMore";

const ACTIVITY_PAGE = 50;
import { useAuthContext } from "./AuthProvider";

export function MarketActivity({ refreshKey = 0 }: { refreshKey?: number }) {
  const { identity, principal } = useAuthContext();
  const [actionError, setActionError] = useState<string | null>(null);
  const [busy, setBusy] = useState<bigint | null>(null);
  const fetchPage = useCallback(async (before: bigint | null) => {
    const rows = await (await backendActor(identity!)).myMarketActivity(before);
    return { items: rows, next: rows.length === ACTIVITY_PAGE ? rows[rows.length - 1]!.id : null };
  }, [identity]);
  const { items, hasMore, loading, error: listError, loadMore, refresh } = useCursorList<Listing, bigint>({
    key: principal, enabled: !!identity, fetchPage, pollMs: BALANCE_POLL_MS,
  });
  const activity = items ?? [];
  const error = actionError ?? (items === null ? listError : null);
  const first = useRef(true);
  useEffect(() => {
    if (first.current) { first.current = false; return; }
    refresh();
  }, [refreshKey, refresh]);
  if (!identity) return null;
  return (
    <section className="glass space-y-3 p-4 sm:p-6" aria-label="Marketplace activity">
      <h2 className="font-display text-xl font-semibold">Marketplace activity</h2>
      <p className="text-xs text-slate-400">Purchases and seller proceeds persist here after a bonsai leaves your collection. Pending sales resume without another payment.</p>
      {error && <p role="alert" className="break-words text-sm text-red-200">{error} <button className="underline" onClick={() => { setActionError(null); refresh(); }}>Retry activity</button></p>}
      {items !== null && activity.length === 0 && !error && <p className="text-sm text-slate-400">No listings or trades yet. <Link className="text-moss-200 underline" to="/gallery">Explore the grove</Link></p>}
      <ul className="space-y-2">
        {activity.map((sale) => (
          <li key={sale.id.toString()} className="glass-inset flex flex-wrap items-center justify-between gap-3 p-3 text-xs">
            <div className="min-w-0 space-y-1">
              <p className="font-medium">Bonsai #{sale.nftId.toString()} · {marketPrice(sale)}</p>
              <p className="text-slate-400">{saleStatus(sale)}</p>
              {sale.buyer && sale.seller.toText() === principal && <p className="text-moss-200">Seller proceeds: {formatIcp(sale.proceeds, 8)} {sale.currency === "icp" ? "ICP" : "$BONSAI"}</p>}
              {sale.error && <p className="break-words text-amber-200">{sale.error}</p>}
            </div>
            {!["active", "sold", "cancelled"].includes(sale.phase) && <button className="btn-ghost px-3 py-2 text-xs" disabled={busy !== null} onClick={async () => {
              setBusy(sale.id); setActionError(null);
              try {
                const result = await (await backendActor(identity)).retryMarket(sale.id);
                if (result.__kind__ === "err") throw new Error(result.err);
                refresh();
              } catch (e: unknown) { setActionError(e instanceof Error ? e.message : String(e)); }
              finally { setBusy(null); }
            }}>{busy === sale.id ? "Resuming..." : "Resume / retry"}</button>}
          </li>
        ))}
      </ul>
      {activity.length > 0 && <LoadMore hasMore={hasMore} loading={loading} onLoad={() => void loadMore()} label="Older activity"
        error={items === null ? null : listError} onRetry={() => void loadMore()} />}
    </section>
  );
}
