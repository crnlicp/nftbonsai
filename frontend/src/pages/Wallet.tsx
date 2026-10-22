import { useCallback, useEffect, useState } from "react";
import { BALANCE_POLL_MS, startPolling } from "../lib/polling";
import QRCode from "qrcode";
import { useAuthContext } from "../components/AuthProvider";
import {
  ICP_FEE, accountId, balanceOf, formatIcp, ledgerMessage, parseDestination, parseIcp, sendIcp, type Destination,
} from "../lib/ledger";

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
  const [balanceError, setBalanceError] = useState<string>();
  const [receive, setReceive] = useState<"account" | "principal">("account");
  const [qr, setQr] = useState<string>();
  const [to, setTo] = useState("");
  const [amount, setAmount] = useState("");
  const [review, setReview] = useState<{ dest: Destination; e8s: bigint } | null>(null);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string>();
  const [sent, setSent] = useState<string>();

  const principal = identity?.getPrincipal();
  const address = principal ? (receive === "account" ? accountId(principal) : principal.toText()) : "";

  const refresh = useCallback(async () => {
    if (!identity) return;
    try {
      setBalance(await balanceOf(identity));
      setBalanceError(undefined);
    } catch (e) {
      setBalanceError(ledgerMessage(e));
    }
  }, [identity]);

  useEffect(() => {
    setBalance(undefined);
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
    if (!dest) return setError("Enter a valid principal or 64-character account ID");
    const e8s = parseIcp(amount);
    if (e8s === null || e8s <= 0n) return setError("Enter an amount (up to 8 decimals)");
    if (balance !== undefined && e8s + ICP_FEE > balance) return setError("Amount plus fee exceeds your balance");
    setReview({ dest, e8s });
  }

  async function confirm() {
    if (!identity || !review) return;
    setSending(true);
    setError(undefined);
    try {
      const block = await sendIcp(identity, review.dest, review.e8s);
      setSent(`Sent ${formatIcp(review.e8s, 8)} ICP · block ${block.toString()}`);
      setReview(null);
      setTo("");
      setAmount("");
      await refresh();
    } catch (e) {
      setError(ledgerMessage(e));
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

  const max = balance !== undefined && balance > ICP_FEE ? balance - ICP_FEE : 0n;

  return (
    <div className="mx-auto grid max-w-4xl gap-6 md:grid-cols-2">
      <section className="glass-strong p-6 md:col-span-2">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <p className="text-sm text-slate-400">ICP balance</p>
            <p className="font-display text-4xl" data-testid="icp-balance">
              {balance === undefined ? "…" : formatIcp(balance, 8)} <span className="text-xl text-slate-400">ICP</span>
            </p>
          </div>
          <button className="btn-ghost" onClick={() => void refresh()}>Refresh</button>
        </div>
        {balanceError && <p role="alert" className="mt-3 text-sm text-red-200">{balanceError}</p>}
      </section>

      <section className="glass space-y-4 p-6">
        <h2 className="font-display text-xl">Receive</h2>
        <div className="flex gap-1" role="tablist">
          {(["account", "principal"] as const).map((k) => (
            <button key={k} role="tab" aria-selected={receive === k}
              className={receive === k ? "nav-link-active" : "nav-link"} onClick={() => setReceive(k)}>
              {k === "account" ? "Account ID" : "Principal"}
            </button>
          ))}
        </div>
        {qr && <img src={qr} alt={`QR code for ${address}`} width={220} height={220} className="mx-auto rounded-lg" />}
        <div className="glass-inset flex items-center gap-2 p-3">
          <code className="flex-1 break-all text-xs" data-testid="receive-address">{address}</code>
          <CopyButton value={address} />
        </div>
        <p className="text-xs text-slate-400">
          {receive === "account" ? "For exchanges and legacy wallets." : "For ICRC wallets (NNS, Plug, Oisy)."}
        </p>
      </section>

      <section className="glass space-y-4 p-6">
        <h2 className="font-display text-xl">Send</h2>
        <label className="block text-sm" htmlFor="send-to">To</label>
        <input id="send-to" value={to} onChange={(e) => { setTo(e.target.value); setReview(null); }}
          placeholder="Principal or account ID" className="glass-inset w-full p-3 font-mono text-sm" />
        <label className="block text-sm" htmlFor="send-amount">Amount</label>
        <div className="flex gap-2">
          <input id="send-amount" inputMode="decimal" value={amount} onChange={(e) => { setAmount(e.target.value); setReview(null); }}
            placeholder="0.00" className="glass-inset w-full p-3 text-lg" />
          <button className="btn-ghost" onClick={() => { setAmount(formatIcp(max, 8)); setReview(null); }}>Max</button>
        </div>
        <p className="text-xs text-slate-400">Network fee {formatIcp(ICP_FEE, 8)} ICP</p>
        {!review ? (
          <button className="btn-primary w-full justify-center" onClick={startReview} disabled={sending}>Review</button>
        ) : (
          <div className="glass-inset space-y-2 p-4 text-sm">
            <p>Send <strong>{formatIcp(review.e8s, 8)} ICP</strong></p>
            <p className="break-all font-mono text-xs">to {to.trim()}</p>
            <p className="text-slate-400">Total {formatIcp(review.e8s + ICP_FEE, 8)} ICP incl. fee</p>
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
  );
}
