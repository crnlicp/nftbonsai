import { useEffect, useRef, useState } from "react";
import type { Stat } from "../bindings/backend";
import { backendActor } from "../lib/actors";
import { useAuthContext } from "./AuthProvider";

export interface LikeState {
  count: bigint;
  liked: boolean;
}

/** Card-level like state with optimistic toggling; server stats resync when no request is in flight. */
export function useLike(nftId: bigint, server: Stat | null | undefined) {
  const { identity, isAuthenticated, signIn } = useAuthContext();
  const [state, setState] = useState<LikeState | null>(server ?? null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inFlight = useRef(false);

  useEffect(() => {
    if (!inFlight.current && server) setState({ count: server.count, liked: server.liked });
  }, [server?.count, server?.liked]); // eslint-disable-line react-hooks/exhaustive-deps

  const toggle = async () => {
    if (!isAuthenticated || !identity) { void signIn(); return; }
    if (inFlight.current || !state) return;
    const previous = state;
    const liked = !previous.liked;
    inFlight.current = true;
    setBusy(true);
    setError(null);
    setState({ liked, count: previous.count + (liked ? 1n : -1n) });
    try {
      const result = await (await backendActor(identity)).setLike(nftId, liked);
      if (result.__kind__ === "err") throw new Error(result.err);
      setState({ count: result.ok.count, liked: result.ok.liked });
    } catch (e: unknown) {
      setState(previous);
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  };

  return { state, busy, error, toggle, signedIn: isAuthenticated };
}

function Heart({ filled }: { filled: boolean }) {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" className={`h-2.5 w-2.5 transition-transform ${filled ? "scale-110" : ""}`}
      fill={filled ? "currentColor" : "none"} stroke="currentColor" strokeWidth={2} strokeLinejoin="round">
      <path d="M12 20.5s-7.5-4.6-9.3-9.2C1.5 8.1 3.6 4.5 7.2 4.5c2 0 3.6 1.1 4.8 2.8 1.2-1.7 2.8-2.8 4.8-2.8 3.6 0 5.7 3.6 4.5 6.8-1.8 4.6-9.3 9.2-9.3 9.2z" />
    </svg>
  );
}

export function LikeButton({ like, className = "" }: { like: ReturnType<typeof useLike>; className?: string }) {
  const { state, busy, error, toggle, signedIn } = like;
  const liked = state?.liked ?? false;
  const count = state ? state.count.toString() : "–";
  const label = !signedIn ? `Sign in to like (${count} likes)` : liked ? `Unlike (${count} likes)` : `Like (${count} likes)`;
  return (
    <button type="button" aria-pressed={signedIn ? liked : undefined} aria-label={label} title={error ?? label}
      disabled={busy || (signedIn && !state)} onClick={() => void toggle()}
      className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-semibold tabular-nums shadow-glass backdrop-blur transition focus-visible:outline focus-visible:outline-2 focus-visible:outline-rose-300 disabled:cursor-wait ${
        liked ? "border-rose-300/60 bg-rose-500/90 text-white hover:bg-rose-400" : "border-white/20 bg-slate-950/80 text-rose-200 hover:border-rose-300/60 hover:text-rose-100"
      } ${error ? "ring-1 ring-red-400" : ""} ${className}`}>
      <Heart filled={liked} />
      <span>{count}</span>
    </button>
  );
}
