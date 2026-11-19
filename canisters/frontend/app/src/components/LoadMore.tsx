import { useEffect, useRef } from "react";

/**
 * Infinite-scroll trigger: loads the next page when it nears the viewport, with a visible
 * fallback button (keyboard, reduced motion, or when IntersectionObserver is unavailable).
 */
export function LoadMore({ hasMore, loading, onLoad, label, endLabel, error, onRetry }: {
  hasMore: boolean;
  loading: boolean;
  onLoad: () => void;
  label: string;
  endLabel?: string;
  error?: string | null;
  onRetry?: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const node = ref.current;
    if (!node || !hasMore || loading || error || typeof IntersectionObserver === "undefined") return;
    // A fresh observer reports the current intersection immediately, so a short page keeps filling.
    const observer = new IntersectionObserver((entries) => {
      if (entries.some((entry) => entry.isIntersecting)) onLoad();
    }, { rootMargin: "600px 0px" });
    observer.observe(node);
    return () => observer.disconnect();
  }, [hasMore, loading, error, onLoad]);

  return (
    <div ref={ref} className="flex min-h-12 flex-col items-center justify-center gap-2 py-2 text-sm text-slate-400">
      <p role="status" aria-live="polite" className="sr-only">{loading ? `Loading more` : ""}</p>
      {error ? (
        <p role="alert" className="flex flex-wrap items-center justify-center gap-2 text-red-200">
          <span className="break-words">{error}</span>
          {onRetry && <button className="btn-ghost px-3 py-1.5 text-xs" onClick={onRetry}>Try again</button>}
        </p>
      ) : hasMore ? (
        <button className="btn-ghost px-4 py-2 text-sm" disabled={loading} onClick={onLoad}>
          {loading ? "Loading…" : label}
        </button>
      ) : endLabel ? <p>{endLabel}</p> : null}
    </div>
  );
}
