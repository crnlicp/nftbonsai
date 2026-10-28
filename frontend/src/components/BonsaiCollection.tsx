import { useEffect, useState } from "react";
import { backendActor, icrc7Actor } from "../lib/actors";
import type { NftPublic } from "../lib/idl";
import { BonsaiCard, type BonsaiDetails } from "./BonsaiCard";
import { BALANCE_POLL_MS, startPolling } from "../lib/polling";
import { useAuthContext } from "./AuthProvider";

export function BonsaiCollection({ nfts, onChange }: { nfts: NftPublic[]; onChange?: () => void }) {
  const { principal } = useAuthContext();
  const [updated, setUpdated] = useState<Map<bigint, NftPublic>>(new Map());
  const [details, setDetails] = useState<Map<bigint, BonsaiDetails>>(new Map());
  const [error, setError] = useState<string | null>(null);
  const [retry, setRetry] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setError(null);
    const stop = startPolling(async () => {
      try {
        const [backend, collection] = await Promise.all([backendActor(), icrc7Actor()]);
        const policy = await backend.marketPolicy();
        for (let start = 0; start < nfts.length; start += 100) {
          const batch = nfts.slice(start, start + 100);
          const [receipts, metadata, listings, references, fresh] = await Promise.all([
            backend.getMintDetails(batch.map((nft) => nft.paymentId)),
            collection.icrc7_token_metadata(batch.map((nft) => nft.id)),
            backend.marketListings(batch.map((nft) => nft.id)),
            backend.mintReferences(batch.map((nft) => nft.paymentId)),
            collection.icrc7_owner_of(batch.map((nft) => nft.id)),
          ]);
          if (cancelled) return BALANCE_POLL_MS;
          const loaded = batch.map((nft, index): [bigint, BonsaiDetails] => {
            const receipt = receipts[index];
            const version = metadata[index]?.find(([key]) => key === "bonsai:generation_version")?.[1];
            return [nft.id, {
              mint: receipt?.nftId === nft.id ? receipt : null,
              version: version?.__kind__ === "Nat" ? version.Nat : null,
              listing: listings[index] ?? null,
              reference: references[index] ?? null,
              tokenEnabled: policy.token !== undefined,
            }];
          });
          setDetails((previous) => new Map([...previous, ...loaded]));
          setUpdated((previous) => new Map([...previous, ...batch.map((nft, index): [bigint, NftPublic] =>
            [nft.id, fresh[index] ? { ...nft, owner: fresh[index]!.owner } : nft])]));
        }
      } catch (e: unknown) {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e));
      }
      return BALANCE_POLL_MS;
    });
    return () => { cancelled = true; stop(); };
  }, [nfts, retry, principal]);

  return (
    <div className="space-y-4">
      {error && (
        <div role="alert" className="glass flex flex-wrap items-center justify-between gap-3 border-red-500/30 bg-red-500/10 p-4 text-sm text-red-200">
          <p className="min-w-0 break-words">Could not load mint details: {error}</p>
          <button className="btn-ghost shrink-0 px-3 py-1.5 text-sm" onClick={() => setRetry((value) => value + 1)}>Retry details</button>
        </div>
      )}
      <ul className="grid items-stretch gap-5 sm:grid-cols-2 lg:grid-cols-3">
        {nfts.map((nft) => (
          <li key={nft.id.toString()} className="min-w-0">
            <BonsaiCard nft={updated.get(nft.id) ?? nft} details={details.get(nft.id)} failed={error !== null} onChange={() => {
              setRetry((value) => value + 1);
              onChange?.();
            }} />
          </li>
        ))}
      </ul>
    </div>
  );
}
