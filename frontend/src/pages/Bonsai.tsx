import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import type { Principal } from "@icp-sdk/core/principal";
import { useAuthContext } from "../components/AuthProvider";
import { backendActor } from "../lib/actors";
import { formatIcp, tokenBalance } from "../lib/ledger";
import { BALANCE_POLL_MS, startPolling } from "../lib/polling";
import { soonLogoUrl, soonTokenUrl } from "../lib/soon";
import { SOON_SOCIAL, soonFactory, soonMarket, soonSocial, type Candle, type MarketInfo, type MinerStat, type Post, type Trade } from "../lib/soonApi";

type Token = { ledger: Principal; market: Principal; symbol: string };
type ShopStats = { mints: bigint; collectedE8s: bigint; buyers: bigint };
type Market = { info: MarketInfo; trades: Trade[]; candles: Candle[]; miners: MinerStat[]; posts: Post[]; usd?: number; names: Map<string, string> };

const WEEK_NS = 7n * 24n * 3600n * 1_000_000_000n;

const compact = (n: number) => new Intl.NumberFormat("en", { notation: "compact", maximumFractionDigits: 2 }).format(n);
const units = (v: bigint, decimals = 8) => Number(v) / 10 ** decimals;
const shortId = (p: Principal) => { const t = p.toText(); return `${t.slice(0, 5)}…${t.slice(-3)}`; };

function fmtPrice(n: number): string {
  if (n === 0) return "0";
  if (n >= 1) return n.toLocaleString("en", { maximumFractionDigits: 4 });
  return n.toLocaleString("en", { maximumSignificantDigits: 4 });
}

function ago(ns: bigint): string {
  const s = Math.max(0, (Date.now() - Number(ns / 1_000_000n)) / 1000);
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}

function phaseLabel(info: MarketInfo): { text: string; tone: string } {
  if ("Graduated" in info.phase) return { text: "Graduated to ICPSwap", tone: "bg-moss-500/20 text-moss-200" };
  if ("Graduating" in info.phase) return { text: "Graduating", tone: "bg-amber-500/20 text-amber-200" };
  return { text: "Bonding curve", tone: "bg-sky-500/20 text-sky-200" };
}

function Logo({ market, symbol }: { market: string; symbol: string }) {
  const [failed, setFailed] = useState(false);
  if (!failed) return <img src={soonLogoUrl(market)} alt="" className="h-14 w-14 shrink-0 rounded-full bg-white/10 object-cover" onError={() => setFailed(true)} />;
  return <span aria-hidden className="grid h-14 w-14 shrink-0 place-items-center rounded-full bg-gradient-to-br from-moss-400 to-moss-700 text-xl font-bold text-white">{symbol.charAt(0)}</span>;
}

function Stat({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="glass-inset min-w-0 p-4">
      <p className="text-xs uppercase tracking-wide text-slate-400">{label}</p>
      <p className="mt-1 truncate font-display text-xl font-semibold tabular-nums" title={value}>{value}</p>
      {hint && <p className="mt-0.5 truncate text-xs text-slate-400">{hint}</p>}
    </div>
  );
}

function PriceChart({ candles, base }: { candles: Candle[]; base: string }) {
  const W = 600, H = 160;
  if (candles.length < 2) return <p className="py-10 text-center text-sm text-slate-400">Not enough trading history for a chart yet.</p>;
  const closes = candles.map((c) => c.close);
  const lo = Math.min(...candles.map((c) => c.low)), hi = Math.max(...candles.map((c) => c.high));
  const span = hi - lo || hi || 1;
  const pts = closes.map((c, i) => [(i / (closes.length - 1)) * W, H - 8 - ((c - lo) / span) * (H - 16)] as const);
  const line = pts.map(([x, y], i) => `${i ? "L" : "M"}${x.toFixed(1)},${y.toFixed(1)}`).join(" ");
  const up = closes[closes.length - 1] >= closes[0];
  const color = up ? "#86efac" : "#fca5a5";
  const change = closes[0] ? ((closes[closes.length - 1] - closes[0]) / closes[0]) * 100 : 0;
  return (
    <div>
      <div className="mb-2 flex items-baseline justify-between text-xs text-slate-400">
        <span>Hourly close, last 7 days ({base})</span>
        <span className={up ? "text-moss-200" : "text-red-200"}>{change >= 0 ? "+" : ""}{change.toFixed(1)}%</span>
      </div>
      <svg viewBox={`0 0 ${W} ${H}`} className="h-40 w-full" preserveAspectRatio="none" role="img" aria-label="Price chart">
        <defs>
          <linearGradient id="bonsai-area" x1="0" x2="0" y1="0" y2="1">
            <stop offset="0%" stopColor={color} stopOpacity="0.35" />
            <stop offset="100%" stopColor={color} stopOpacity="0" />
          </linearGradient>
        </defs>
        <path d={`${line} L${W},${H} L0,${H} Z`} fill="url(#bonsai-area)" />
        <path d={line} fill="none" stroke={color} strokeWidth="2" vectorEffect="non-scaling-stroke" />
      </svg>
      <div className="mt-1 flex justify-between text-xs tabular-nums text-slate-500">
        <span>Low {fmtPrice(lo)}</span><span>High {fmtPrice(hi)}</span>
      </div>
    </div>
  );
}

export function Bonsai() {
  const { identity, isAuthenticated } = useAuthContext();
  const [token, setToken] = useState<Token | null>();
  const [shop, setShop] = useState<ShopStats>();
  const [market, setMarket] = useState<Market>();
  const [marketError, setMarketError] = useState(false);
  const [balance, setBalance] = useState<bigint>();

  useEffect(() => {
    let cancelled = false;
    void backendActor().then((a) => a.pricing()).then((p) => { if (!cancelled) setToken(p.token ?? null); }).catch(() => { if (!cancelled) setToken(null); });
    return () => { cancelled = true; };
  }, []);

  const marketId = token?.market.toText();

  useEffect(() => {
    if (!marketId) return;
    return startPolling(async () => {
      const m = soonMarket(marketId);
      const [shopStats, info, trades, candles, miners, posts, prices] = await Promise.all([
        backendActor().then((a) => a.tokenStats()).catch(() => undefined),
        m.info().catch(() => undefined),
        m.trades(10).catch(() => [] as Trade[]),
        m.candles(true, BigInt(Date.now()) * 1_000_000n - WEEK_NS).catch(() => [] as Candle[]),
        m.miners().catch(() => [] as MinerStat[]),
        soonSocial().thread(token!.market, [], 30).catch(() => [] as Post[]),
        soonFactory().prices().catch(() => []),
      ]);
      setShop(shopStats);
      if (!info) { setMarketError(true); return BALANCE_POLL_MS; }
      setMarketError(false);
      // Only Soon's automated milestone posts are shown; user discussion stays on Soon, where it is moderated.
      const visible = posts.filter((p) => !p.deleted && !p.hidden && p.author.toText() === SOON_SOCIAL).slice(0, 5);
      const who = [...new Map([...trades.map((t) => t.who), ...miners.map((x) => x.owner)].map((p) => [p.toText(), p])).values()];
      const names = new Map((await soonFactory().names(who).catch(() => [])).map(([p, n]) => [p.toText(), n]));
      const usd = prices.find((p) => p.ledger.toText() === info.base.ledger.toText())?.usd;
      setMarket({ info, trades, candles, miners, posts: visible, usd, names });
      return BALANCE_POLL_MS;
    });
  }, [marketId]);

  useEffect(() => {
    if (!identity || !isAuthenticated || !token) { setBalance(undefined); return; }
    return startPolling(async () => {
      setBalance(await tokenBalance(identity, token.ledger));
      return BALANCE_POLL_MS;
    });
  }, [identity, isAuthenticated, token]);

  const topMiners = useMemo(() => [...(market?.miners ?? [])].sort((a, b) => Number(b.burned - a.burned) || b.rigs - a.rigs).slice(0, 5), [market]);

  if (token === undefined) return <p className="text-center text-slate-400">Loading…</p>;

  if (token === null)
    return (
      <div className="glass mx-auto max-w-xl space-y-4 p-8 text-center">
        <span className="inline-block rounded-full bg-white/10 px-3 py-1 text-xs text-slate-300">Coming soon</span>
        <h1 className="font-display text-3xl font-semibold">$BONSAI</h1>
        <p className="text-slate-300">
          A community token for ICPBonsai, built on Soon. Once it launches you'll be able to mint bonsai with it at a
          friendlier price and follow its market here.
        </p>
        <Link to="/mint" className="btn-primary inline-block">Mint with ICP</Link>
      </div>
    );

  const symbol = market?.info.meta.symbol || token.symbol;
  const info = market?.info;
  const baseSym = info?.base.symbol ?? "ICP";
  const dec = info?.base.decimals ?? 8;
  const phase = info && phaseLabel(info);
  const label = (p: Principal) => market?.names.get(p.toText()) ?? shortId(p);

  return (
    <div className="space-y-6">
      <section className="glass flex flex-col gap-5 p-6 md:flex-row md:items-center md:justify-between">
        <div className="flex min-w-0 items-center gap-4">
          <Logo market={marketId!} symbol={symbol} />
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="font-display text-3xl font-semibold">${symbol}</h1>
              <span className="rounded-full bg-white/10 px-2.5 py-0.5 text-xs text-slate-300">Built on Soon</span>
              {phase && <span className={`rounded-full px-2.5 py-0.5 text-xs ${phase.tone}`}>{phase.text}</span>}
            </div>
            <p className="mt-1 text-sm text-slate-300">
              {info ? <>Price <span className="tabular-nums text-slate-100">{fmtPrice(info.price)} {baseSym}</span>
                {market?.usd !== undefined && <span className="text-slate-400"> · ≈ ${fmtPrice(info.price * market.usd)}</span>}</>
                : "Mint bonsai with $BONSAI for 2× lucky odds."}
            </p>
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          <Link to="/mint" className="btn-primary">Mint with ${symbol}</Link>
          <a href={soonTokenUrl(marketId!)} target="_blank" rel="noreferrer" className="btn-ghost">Trade on Soon ↗</a>
        </div>
      </section>

      <section className="grid gap-3 sm:grid-cols-3">
        <Stat label="Bonsai minted with it" value={shop ? shop.mints.toString() : "–"} />
        <Stat label={`$${symbol} spent on bonsai`} value={shop ? compact(units(shop.collectedE8s)) : "–"} />
        <Stat label="Your balance" value={balance !== undefined ? formatIcp(balance, 2) : isAuthenticated ? "…" : "Sign in"} hint={balance !== undefined ? `$${symbol}` : undefined} />
      </section>

      {marketError && !info && (
        <p role="status" className="glass p-4 text-sm text-slate-300">
          Live market data from Soon is unavailable right now. You can still view it on{" "}
          <a className="underline" href={soonTokenUrl(marketId!)} target="_blank" rel="noreferrer">soonlaunchpad.fun</a>.
        </p>
      )}
      {!marketError && !info && <p className="text-center text-sm text-slate-400">Loading market data from Soon…</p>}

      {info && market && (
        <>
          <section className="glass space-y-4 p-6">
            <div>
              <div className="mb-1 flex justify-between text-sm">
                <span className="text-slate-300">Bonding curve progress</span>
                <span className="tabular-nums">{(info.progress_bps / 100).toFixed(2)}%</span>
              </div>
              <div className="h-2.5 overflow-hidden rounded-full bg-white/10">
                <div className="h-full rounded-full bg-gradient-to-r from-moss-400 to-moss-200" style={{ width: `${Math.min(100, info.progress_bps / 100)}%` }} />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
              <Stat label="Raised" value={`${compact(units(info.raised, dec))} ${baseSym}`} />
              <Stat label="Volume" value={`${compact(units(info.volume_base, dec))} ${baseSym}`} />
              <Stat label="Traders" value={info.traders.toString()} hint={`${info.trades} trades`} />
              <Stat label="Mined" value={`${info.mine_supply ? ((Number(info.mined) / Number(info.mine_supply)) * 100).toFixed(1) : "0"}%`} hint={`${info.active_rigs} active rigs`} />
            </div>
            <PriceChart candles={market.candles} base={baseSym} />
          </section>

          <div className="grid gap-6 lg:grid-cols-2">
            <section className="glass p-6">
              <h2 className="mb-3 font-display text-lg font-semibold">Latest trades</h2>
              {market.trades.length === 0 ? <p className="text-sm text-slate-400">No trades yet.</p> : (
                <ul className="divide-y divide-white/5 text-sm">
                  {market.trades.map((t) => (
                    <li key={t.id.toString()} className="flex items-center justify-between gap-3 py-2">
                      <span className="flex min-w-0 items-center gap-2">
                        <span className={`w-10 shrink-0 rounded px-1.5 py-0.5 text-center text-xs ${t.buy ? "bg-moss-500/20 text-moss-200" : "bg-red-500/20 text-red-200"}`}>{t.buy ? "Buy" : "Sell"}</span>
                        <span className="truncate text-slate-300" title={t.who.toText()}>{label(t.who)}</span>
                      </span>
                      <span className="shrink-0 text-right tabular-nums">
                        {compact(units(t.base, dec))} {baseSym}
                        <span className="block text-xs text-slate-500">{ago(t.at)}</span>
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </section>

            <div className="space-y-6">
              <section className="glass p-6">
                <h2 className="mb-3 font-display text-lg font-semibold">Top miners</h2>
                {topMiners.length === 0 ? <p className="text-sm text-slate-400">No miners yet.</p> : (
                  <ul className="divide-y divide-white/5 text-sm">
                    {topMiners.map((x, i) => (
                      <li key={x.owner.toText()} className="flex items-center justify-between gap-3 py-2">
                        <span className="flex min-w-0 items-center gap-2">
                          <span className="w-5 shrink-0 text-slate-500">{i + 1}</span>
                          <span className="truncate text-slate-300" title={x.owner.toText()}>{label(x.owner)}</span>
                        </span>
                        <span className="shrink-0 tabular-nums text-slate-300">{x.rigs} rig{x.rigs === 1 ? "" : "s"}</span>
                      </li>
                    ))}
                  </ul>
                )}
              </section>

              <section className="glass p-6">
                <div className="mb-3 flex items-baseline justify-between">
                  <h2 className="font-display text-lg font-semibold">Milestones</h2>
                  <a href={soonTokenUrl(marketId!)} target="_blank" rel="noreferrer" className="text-xs text-slate-400 hover:text-slate-200">Join the discussion on Soon ↗</a>
                </div>
                {market.posts.length === 0 ? <p className="text-sm text-slate-400">No milestones yet.</p> : (
                  <ul className="space-y-3 text-sm">
                    {market.posts.map((p) => (
                      <li key={p.id.toString()} className="glass-inset p-3">
                        <p className="flex justify-between gap-3">
                          <span className="line-clamp-2 break-words text-slate-200">{p.text}</span>
                          <span className="shrink-0 text-xs text-slate-400">{ago(p.at)}</span>
                        </p>
                      </li>
                    ))}
                  </ul>
                )}
              </section>
            </div>
          </div>
        </>
      )}

      <p className="text-center text-xs text-slate-500">
        ICPBonsai is built on Soon and is not affiliated with Soon. Market data is read live from Soon's public canisters;
        nothing here is a promise of price or returns.
      </p>
    </div>
  );
}
