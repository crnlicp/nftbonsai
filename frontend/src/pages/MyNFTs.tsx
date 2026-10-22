import { useEffect, useState } from "react";
import { useAuthContext } from "../components/AuthProvider";
import { icrc7Actor } from "../lib/actors";
import { BonsaiSvg } from "../components/BonsaiSvg";
import { bonsaiDescription } from "../lib/render";
import type { NftPublic } from "../lib/idl";
import { Principal } from "@icp-sdk/core/principal";

export function MyNFTs() {
  const { isAuthenticated, identity, signIn, principal } = useAuthContext();
  const [nfts, setNfts] = useState<NftPublic[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setNfts(null);
    setError(null);
    if (!identity || !principal) return;
    let cancelled = false;
    (async () => {
      try {
        const ic = await icrc7Actor(identity);
        const mine: NftPublic[] = [];
        let previous: bigint | null = null;
        do {
          const ids = await ic.icrc7_tokens_of({ owner: Principal.fromText(principal) }, previous, 100n);
          const tokens = await Promise.all(ids.map((id) => ic.getNft(id)));
          if (cancelled) return;
          mine.push(...tokens.filter((n): n is NftPublic => n !== null));
          previous = ids.length === 100 ? ids[ids.length - 1]! : null;
        } while (previous !== null);
        setNfts(mine);
      } catch (e: unknown) {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [identity, principal]);

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
      <header className="flex items-end justify-between">
        <div>
          <h2 className="font-display text-3xl font-semibold">My bonsai</h2>
          <p className="text-sm text-slate-400">
            {nfts === null ? "Loading…" : `${nfts.length} bonsai in your grove`}
          </p>
        </div>
      </header>

      {error && (
        <div className="glass rounded-xl border border-red-500/30 bg-red-500/10 p-4 text-sm text-red-200">
          {error}
        </div>
      )}

      {nfts && nfts.length === 0 && (
        <div className="glass p-10 text-center">
          <p className="mb-4 text-slate-300">You haven't minted a bonsai yet.</p>
          <a href="/mint" className="btn-primary mx-auto">Grow your first one</a>
        </div>
      )}

      {nfts && nfts.length > 0 && (
        <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {nfts.map((n) => (
            <li key={n.id.toString()} className="glass-strong overflow-hidden p-4">
              <div className="glass-inset p-2">
                <BonsaiSvg nftId={n.id} alt={bonsaiDescription(n.traits)} />
              </div>
              <div className="mt-3 flex items-center justify-between">
                <span className="font-mono text-sm text-slate-300">#{n.id.toString()}</span>
                <span className="text-xs text-slate-400">
                  {new Date(Number(n.createdAt / 1_000_000n)).toLocaleDateString()}
                </span>
              </div>
              <p className="mt-2 text-xs leading-relaxed text-slate-400">
                {bonsaiDescription(n.traits)}
              </p>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
