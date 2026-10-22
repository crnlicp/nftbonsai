// Runs `task` now and again after the delay (ms) it returns, only while the tab is visible.
// A hidden tab pauses polling; returning to it refreshes immediately. Returns a stop function.
export function startPolling(task: () => Promise<number>): () => void {
  let stopped = false;
  let running = false;
  let timer: number | undefined;
  const run = async () => {
    if (stopped || running || document.visibilityState === "hidden") return;
    running = true;
    window.clearTimeout(timer);
    let delay = 30_000;
    try { delay = await task(); } catch { /* task reports its own errors */ } finally { running = false; }
    if (!stopped) timer = window.setTimeout(() => void run(), delay);
  };
  const onVisible = () => { if (document.visibilityState === "visible") void run(); };
  document.addEventListener("visibilitychange", onVisible);
  void run();
  return () => {
    stopped = true;
    window.clearTimeout(timer);
    document.removeEventListener("visibilitychange", onVisible);
  };
}

export const BALANCE_POLL_MS = 30_000;
