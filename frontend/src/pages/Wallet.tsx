import { useCallback, useEffect, useState } from "react";
import { BALANCE_POLL_MS, startPolling } from "../lib/polling";
import QRCode from "qrcode";
import { Principal } from "@icp-sdk/core/principal";
import { useAuthContext } from "../components/AuthProvider";
import {
  ICP_FEE, TOKEN_FEE, accountId, balanceOf, formatIcp, ledgerMessage, parseDestination, parseIcp, sendIcp, sendToken,
  tokenBalance, tokenMessage, type Destination,
} from "../lib/ledger";
import { backendActor } from "../lib/actors";
import type { Token } from "../bindings/backend";
import { soonLogoUrl, soonTokenUrl } from "../lib/soon";

type Asset = "icp" | "token";

function CoinBadge({ asset, symbol, market, size }: { asset: Asset; symbol: string; market?: string; size: "sm" | "lg" }) {
  const [failed, setFailed] = useState(false);
  const box = size === "lg" ? "h-10 w-10 text-base" : "h-6 w-6 text-[11px]";
  if (asset === "token" && market && !failed)
    return <img src={soonLogoUrl(market)} alt="" className={`${box} shrink-0 rounded-full bg-white/10 object-cover`} onError={() => setFailed(true)} />;
  if (asset === "icp")
    return (
      <span aria-hidden className={`${box} grid shrink-0 place-items-center rounded-full bg-white shadow-sm`}>
        <img src="/icp-logo.svg" alt="" className="w-[68%]" />
      </span>
    );
  return (
    <span aria-hidden className={`${box} grid shrink-0 place-items-center rounded-full bg-gradient-to-br from-moss-400 to-moss-700 font-bold text-white`}>
      {symbol.charAt(0)}
    </span>
  );
}

function CopyButton({ value }: { value: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      className="btn-ghost px-3 py-1.5 text-sm"
      onClick={() => {
        void navigator.clipboard.writeText(value).then(() => {
          setCopied(true);
          setTimeout(() => setCopied(false), 1500);
        });
      }}
    >
      {copied ? "Copied" : "Copy"}
    </button>
  );
}

export function Wallet() {
  const { isAuthenticated, isLoading, signIn, identity } = useAuthContext();
  const [balance, setBalance] = useState<bigint>();
  const [token, setToken] = useState<Token>();
  const [tokenBal, setTokenBal] = useState<bigint>();
  const [asset, setAsset] = useState<Asset>("icp");
  const [balanceError, setBalanceError] = useState<string>();
  const [receive, setReceive] = useState<"account" | "principal">("principal");
  const [qr, setQr] = useState<string>();
  const [to, setTo] = useState("");
  const [amount, setAmount] = useState("");
  const [review, setReview] = useState<{ dest: Destination; e8s: bigint } | null>(null);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string>();
  const [sent, setSent] = useState<string>();

  const principal = identity?.getPrincipal();
  const symbol = token?.symbol ?? "BONSAI";
  const isToken = asset === "token" && !!token;
  const unit = isToken ? symbol : "ICP";
  const fee = isToken ? TOKEN_FEE : ICP_FEE;
  const available = isToken ? tokenBal : balance;
  // ICRC tokens are addressed by principal only; legacy account IDs are ICP-specific.
  const receiveKind = isToken ? "principal" : receive;
  const address = principal ? (receiveKind === "account" ? accountId(principal) : principal.toText()) : "";
  const tokenLedger = token?.ledger.toText();

  useEffect(() => {
    let cancelled = false;
    void backendActor(identity).then((a) => a.pricing()).then((p) => { if (!cancelled) setToken(p.token); }).catch(() => {});
    return () => { cancelled = true; };
  }, [identity]);

  const refresh = useCallback(async () => {
    if (!identity) return;
    try {
      const [icp, tok] = await Promise.all([
        balanceOf(identity),
        tokenLedger ? tokenBalance(identity, Principal.fromText(tokenLedger)) : Promise.resolve(undefined),
      ]);
      setBalance(icp);
      setTokenBal(tok);
      setBalanceError(undefined);
    } catch (e) {
      setBalanceError(ledgerMessage(e));
    }
  }, [identity, tokenLedger]);

  useEffect(() => {
    setBalance(undefined);
    setTokenBal(undefined);
    if (!identity) return;
    return startPolling(async () => { await refresh(); return BALANCE_POLL_MS; });
  }, [identity, refresh]);

  useEffect(() => {
    if (!address) return;
    void QRCode.toDataURL(address, { margin: 1, width: 220, color: { dark: "#0b1220", light: "#e2e8f0" } }).then(setQr);
  }, [address]);

  function startReview() {
    setError(undefined);
    setSent(undefined);
    const dest = parseDestination(to);
    if (!dest) return setError(isToken ? "Enter a valid principal" : "Enter a valid principal or 64-character account ID");
    if (isToken && dest.kind !== "principal") return setError(`${symbol} is sent to a principal; account IDs are for ICP only`);
    const e8s = parseIcp(amount);
    if (e8s === null || e8s <= 0n) return setError("Enter an amount (up to 8 decimals)");
    if (available !== undefined && e8s + fee > available) return setError("Amount plus fee exceeds your balance");
    setReview({ dest, e8s });
  }

  async function confirm() {
    if (!identity || !review) return;
    setSending(true);
    setError(undefined);
    try {
      const block = isToken && review.dest.kind === "principal"
        ? await sendToken(identity, Principal.fromText(tokenLedger!), review.dest.principal, review.e8s)
        : await sendIcp(identity, review.dest, review.e8s);
      setSent(`Sent ${formatIcp(review.e8s, 8)} ${unit} · block ${block.toString()}`);
      setReview(null);
      setTo("");
      setAmount("");
      await refresh();
    } catch (e) {
      setError(isToken ? tokenMessage(e, symbol) : ledgerMessage(e));
    } finally {
      setSending(false);
    }
  }

  if (!isAuthenticated) return (
    <div className="glass mx-auto max-w-md p-8 text-center">
      <h2 className="mb-3 font-display text-2xl">Sign in to open your wallet</h2>
      <button onClick={signIn} disabled={isLoading} className="btn-primary mx-auto">Sign in with Internet Identity</button>
    </div>
  );

  const max = available !== undefined && available > fee ? available - fee : 0n;
  const market = token?.market.toText();
  const current: Asset = isToken ? "token" : "icp";
  const assets = [
    { id: "icp" as const, name: "ICP", sub: "Internet Computer", value: balance, testId: "icp-balance" },
    { id: "token" as const, name: symbol, sub: token ? "Built on Soon · 2× luck" : "Built on Soon", value: tokenBal, testId: "token-balance" },
  ];
  const badge = (id: Asset, size: "sm" | "lg" = "lg") => <CoinBadge asset={id} symbol={symbol} market={market} size={size} />;

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <div className="flex items-center justify-between gap-4">
        <h1 className="font-display text-2xl">Wallet</h1>
        <button className="btn-ghost px-3 py-1.5 text-sm" onClick={() => void refresh()}>Refresh</button>
      </div>

      <section role="radiogroup" aria-label="Asset" className="grid gap-3 sm:grid-cols-2">
        {assets.map((a) => {
          const selected = current === a.id;
          const disabled = a.id === "token" && !token;
          return (
            <button key={a.id} type="button" role="radio" aria-checked={selected} data-testid={`asset-${a.id}`} disabled={disabled}
              onClick={() => { if (!selected) { setAsset(a.id); setReview(null); setError(undefined); setSent(undefined); } }}
              className={`glass flex w-full min-w-0 items-center gap-3 p-4 text-left transition sm:gap-4 sm:p-5 disabled:cursor-not-allowed disabled:opacity-50 ${selected
                ? "!border-moss-400/70 !bg-white/[0.12] ring-1 ring-moss-400/50" : "opacity-80 hover:opacity-100 hover:!bg-white/[0.09] disabled:hover:!bg-white/[0.06]"}`}>
              {badge(a.id)}
              <span className="min-w-0 flex-1">
                <span className="block font-semibold">{a.id === "token" ? `$${a.name}` : a.name}</span>
                <span className="block truncate text-xs text-slate-400">{a.sub}</span>
              </span>
              {disabled
                ? <span className="rounded-full border border-amber-200/40 px-2.5 py-0.5 text-xs font-medium text-amber-200">Coming soon</span>
                : <span className="text-right">
                  <span className="block font-display text-2xl tabular-nums leading-tight" data-testid={a.testId}
                    title={a.value === undefined ? undefined : `${formatIcp(a.value, 8)} ${a.name}`}>
                    {a.value === undefined ? "…" : formatIcp(a.value, 4)}
                  </span>
                  <span className="block text-xs text-slate-400">{a.name}</span>
                </span>}
              {!disabled && <span aria-hidden className={`grid h-5 w-5 shrink-0 place-items-center rounded-full border text-[11px] ${selected
                ? "border-moss-400 bg-moss-400 text-slate-950" : "border-white/30"}`}>{selected ? "✓" : ""}</span>}
            </button>
          );
        })}
      </section>
      <p className="-mt-3 text-xs text-slate-400">
        {token ? "Tap a balance to receive or send that asset." : `$${symbol} payments are coming soon; ICP is ready to use.`}
      </p>
      {balanceError && <p role="alert" className="text-sm text-red-200">{balanceError}</p>}

      <div className="grid gap-6 md:grid-cols-2">
      <section className="glass space-y-4 p-6">
        <h2 className="flex items-center gap-2 font-display text-xl">{badge(current, "sm")}Receive {isToken ? `$${unit}` : unit}</h2>
        {!isToken && <div className="grid grid-cols-2 gap-1 rounded-xl bg-white/5 p-1" role="tablist">
          {(["principal", "account"] as const).map((k) => (
            <button key={k} role="tab" aria-selected={receive === k}
              className={`rounded-lg py-1.5 text-sm transition ${receive === k ? "bg-white/15 font-medium text-white ring-1 ring-white/20" : "text-slate-300 hover:bg-white/10"}`}
              onClick={() => setReceive(k)}>
              {k === "account" ? "Account ID" : "Principal"}
            </button>
          ))}
        </div>}
        {qr && <img src={qr} alt={`QR code for ${address}`} width={200} height={200} className="mx-auto rounded-lg" />}
        <div className="glass-inset flex items-center gap-2 p-3">
          <code className="flex-1 break-all text-xs" data-testid="receive-address">{address}</code>
          <CopyButton value={address} />
        </div>
        <p className="text-xs text-slate-400">
          {isToken ? <>Send {symbol} to this principal from Soon, Plug, Oisy or any ICRC wallet.{market && <> <a href={soonTokenUrl(market)}
            target="_blank" rel="noopener noreferrer" className="text-moss-300 underline">Get ${symbol} on Soon ↗</a></>}</>
            : receive === "account" ? "For exchanges and legacy wallets." : "For ICRC wallets (NNS, Plug, Oisy)."}
        </p>
      </section>

      <section className="glass space-y-4 p-6">
        <h2 className="flex items-center gap-2 font-display text-xl">{badge(current, "sm")}Send {isToken ? `$${unit}` : unit}</h2>
        <label className="block text-sm" htmlFor="send-to">To</label>
        <input id="send-to" value={to} onChange={(e) => { setTo(e.target.value); setReview(null); }}
          placeholder={isToken ? "Principal" : "Principal or account ID"} className="glass-inset w-full p-3 font-mono text-sm" />
        <label className="block text-sm" htmlFor="send-amount">Amount</label>
        <div className="flex gap-2">
          <input id="send-amount" inputMode="decimal" value={amount} onChange={(e) => { setAmount(e.target.value); setReview(null); }}
            placeholder="0.00" className="glass-inset w-full p-3 text-lg" />
          <button className="btn-ghost" onClick={() => { setAmount(formatIcp(max, 8)); setReview(null); }}>Max</button>
        </div>
        <p className="flex flex-wrap justify-between gap-x-4 gap-y-1 text-xs text-slate-400">
          <span>Available {available === undefined ? "…" : formatIcp(available, 8)} {unit}</span>
          <span>Network fee {formatIcp(fee, 8)} {unit}</span>
        </p>
        {!review ? (
          <button className="btn-primary w-full justify-center" onClick={startReview} disabled={sending}>Review</button>
        ) : (
          <div className="glass-inset space-y-2 p-4 text-sm">
            <p>Send <strong>{formatIcp(review.e8s, 8)} {unit}</strong></p>
            <p className="break-all font-mono text-xs">to {to.trim()}</p>
            <p className="text-slate-400">Total {formatIcp(review.e8s + fee, 8)} {unit} incl. fee</p>
            <div className="flex gap-2 pt-2">
              <button className="btn-primary flex-1 justify-center" onClick={() => void confirm()} disabled={sending}>
                {sending ? "Sending…" : "Confirm send"}
              </button>
              <button className="btn-ghost" onClick={() => setReview(null)} disabled={sending}>Cancel</button>
            </div>
          </div>
        )}
        {error && <p role="alert" className="text-sm text-red-200">{error}</p>}
        {sent && <p role="status" className="text-sm text-emerald-300">{sent}</p>}
      </section>
      </div>
    </div>
  );
}
