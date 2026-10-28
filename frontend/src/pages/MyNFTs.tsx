import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { useAuthContext } from "../components/AuthProvider";
import { icrc7Actor } from "../lib/actors";
import { BonsaiCollection } from "../components/BonsaiCollection";
import { MarketActivity } from "../components/MarketActivity";
import { LoadMore } from "../components/LoadMore";
import { useCursorList } from "../hooks/useCursorList";
import type { NftPublic } from "../lib/idl";
import { Principal } from "@icp-sdk/core/principal";
import { BALANCE_POLL_MS } from "../lib/polling";
import { PAGE_SIZE } from "./Gallery";

export function MyNFTs() {
  const { isAuthenticated, identity, signIn, principal } = useAuthContext();
  const [refresh, setRefresh] = useState(0);
  const [count, setCount] = useState<bigint | null>(null);

  const fetchPage = useCallback(async (previous: bigint | null) => {
    const ic = await icrc7Actor(identity ?? undefined);
    const ids = await ic.icrc7_tokens_of({ owner: Principal.fromText(principal!) }, previous, BigInt(PAGE_SIZE));
    const tokens = await Promise.all(ids.map((id) => ic.getNft(id)));
    return {
      items: tokens.filter((n): n is NftPublic => n !== null),
      next: ids.length === PAGE_SIZE ? ids[ids.length - 1]! : null,
    };
  }, [identity, principal]);
  const list = useCursorList<NftPublic, bigint>({
    key: `${principal}`, enabled: !!identity && !!principal, fetchPage, pollMs: BALANCE_POLL_MS,
  });
  const { items: nfts, hasMore, loading, error, loadMore, refresh: refreshList } = list;

  useEffect(() => {
    setCount(null);
    if (!principal) return;
    let cancelled = false;
    icrc7Actor().then((ic) => ic.icrc7_balance_of([{ owner: Principal.fromText(principal) }]))
      .then(([n]) => { if (!cancelled) setCount(n ?? null); }).catch(() => {});
    return () => { cancelled = true; };
  }, [principal, refresh, nfts?.length]);

  if (!isAuthenticated) {
    return (
      <div className="glass mx-auto max-w-md p-8 text-center">
        <h2 className="mb-3 font-display text-2xl font-semibold">Your collection</h2>
        <p className="mb-6 text-slate-300">Sign in to see your bonsai.</p>
        <button onClick={signIn} className="btn-primary mx-auto">Sign in</button>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="font-display text-3xl font-semibold">My bonsai</h2>
          <p className="text-sm text-slate-400">
            {nfts === null ? "Loading…" : `${(count ?? BigInt(nfts.length)).toString()} bonsai in your grove`}
          </p>
        </div>
        <Link to="/collection" className="text-sm text-moss-200 underline-offset-4 hover:underline">
          See them in OISY &amp; other wallets →
        </Link>
      </header>

      {error && nfts === null && (
        <div role="alert" className="glass rounded-xl border border-red-500/30 bg-red-500/10 p-4 text-sm text-red-200">
          {error} <button className="underline" onClick={refreshList}>Try again</button>
        </div>
      )}

      {nfts && nfts.length === 0 && (
        <div className="glass p-10 text-center">
          <p className="mb-4 text-slate-300">You haven't minted a bonsai yet.</p>
          <a href="/mint" className="btn-primary mx-auto">Grow your first one</a>
        </div>
      )}

      {nfts && nfts.length > 0 && (
        <>
          <BonsaiCollection nfts={nfts} onChange={() => { refreshList(); setRefresh((n) => n + 1); }} />
          <LoadMore hasMore={hasMore} loading={loading} onLoad={() => void loadMore()} label="Load more of my bonsai"
            error={error} onRetry={() => void loadMore()} />
        </>
      )}
      <MarketActivity refreshKey={refresh} />
    </div>
  );
}
