import { useCallback, useEffect, useRef, useState } from "react";
import { startPolling } from "../lib/polling";

export interface Page<T, C> {
  items: T[];
  next: C | null;
}

/**
 * Cursor-paginated list for infinite scrolling. Changing `key` resets the list. With `pollMs`,
 * every page loaded so far is periodically re-read (same page count) so statuses stay fresh.
 */
export function useCursorList<T, C>({ key, enabled = true, fetchPage, pollMs }: {
  key: unknown;
  enabled?: boolean;
  fetchPage: (cursor: C | null) => Promise<Page<T, C>>;
  pollMs?: number;
}) {
  const [items, setItems] = useState<T[] | null>(null);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [reload, setReload] = useState(0);
  const fetchRef = useRef(fetchPage);
  fetchRef.current = fetchPage;
  const generation = useRef(0);
  const pages = useRef(0);
  const next = useRef<C | null>(null);
  const busy = useRef(false);
  const pendingMore = useRef(false);

  const fail = (gen: number, e: unknown) => {
    if (gen === generation.current) setError(e instanceof Error ? e.message : String(e));
  };

  // Re-reads the first `count` pages; ignores the result if a newer generation took over.
  const readPages = useCallback(async (count: number, gen: number) => {
    const all: T[] = [];
    let cursor: C | null = null;
    let read = 0;
    do {
      const page: Page<T, C> = await fetchRef.current(cursor);
      if (gen !== generation.current) return;
      all.push(...page.items);
      cursor = page.next;
      read++;
    } while (read < count && cursor !== null);
    pages.current = read;
    next.current = cursor;
    setItems(all); setHasMore(cursor !== null); setError(null);
  }, []);

  const loadMore = useCallback(async () => {
    if (busy.current) { pendingMore.current = true; return; }
    if (next.current === null) return;
    const gen = generation.current;
    busy.current = true;
    pendingMore.current = false;
    setLoading(true);
    try {
      const page = await fetchRef.current(next.current);
      if (gen !== generation.current) return;
      pages.current += 1;
      next.current = page.next;
      setItems((previous) => [...previous ?? [], ...page.items]);
      setHasMore(page.next !== null);
      setError(null);
    } catch (e: unknown) {
      fail(gen, e);
    } finally {
      if (gen === generation.current) { busy.current = false; setLoading(false); }
    }
  }, []);

  // Runs a read of the loaded pages under the busy lock, then resumes any deferred load-more.
  const sync = useCallback(async (gen: number, initial: boolean) => {
    if (busy.current) return;
    busy.current = true;
    if (initial) setLoading(true);
    try {
      await readPages(Math.max(pages.current, 1), gen);
    } catch (e: unknown) {
      fail(gen, e);
    } finally {
      if (gen === generation.current) {
        busy.current = false;
        setLoading(false);
        if (pendingMore.current) void loadMore();
      }
    }
  }, [readPages, loadMore]);

  useEffect(() => {
    const gen = ++generation.current;
    pages.current = 0;
    next.current = null;
    busy.current = false;
    pendingMore.current = false;
    setItems(null); setHasMore(false); setError(null); setLoading(false);
    if (!enabled) return;
    if (pollMs === undefined) {
      void sync(gen, true);
      return () => { generation.current++; };
    }
    let initial = true;
    const stop = startPolling(async () => {
      await sync(gen, initial);
      initial = false;
      return pollMs;
    });
    return () => { generation.current++; stop(); };
  }, [key, enabled, pollMs, reload, sync]);

  // Refreshes loaded pages in place (keeps scroll position); restarts if nothing loaded yet.
  const refresh = useCallback(() => {
    if (pages.current === 0) setReload((n) => n + 1);
    else void sync(generation.current, false);
  }, [sync]);

  return { items, hasMore, loading, error, loadMore, refresh };
}
