import { useState } from "react";
import { Principal } from "@icp-sdk/core/principal";
import type { Listing, Quote, Reference } from "../bindings/backend";
import { Currency } from "../bindings/backend";
import type { NftPublic } from "../lib/idl";
import { backendActor, icrc7Actor } from "../lib/actors";
import { canisterEnv } from "../lib/env";
import { approveMarket, formatIcp, marketLedgerFee, parseIcp, tokenBalance } from "../lib/ledger";
import { isListed, marketCurrency, marketPrice, saleStatus } from "../lib/marketplace";
import { useAuthContext } from "./AuthProvider";

export type MarketSection = "all" | "trade" | "send" | "none";

export function MarketControls({ nft, listing, reference, tokenEnabled, ready, onChange, section = "all" }: {
  nft: NftPublic; listing: Listing | null; reference: Reference | null;
  tokenEnabled: boolean; ready: boolean; onChange: () => void; section?: MarketSection;
}) {
  const { identity, principal, isAuthenticated, signIn } = useAuthContext();
  const [currency, setCurrency] = useState<"icp" | "token">("icp");
  const [amount, setAmount] = useState("");
  const [recipient, setRecipient] = useState("");
  const [sendTo, setSendTo] = useState<Principal | null>(null);
  const [listingReview, setListingReview] = useState<{ price: bigint; fee: bigint; currency: "icp" | "token" } | null>(null);
  const [quote, setQuote] = useState<Quote | null>(null);
  const [balance, setBalance] = useState<bigint | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const owner = principal === nft.owner.toText();
  const active = isListed(listing);
  const cap = reference ? 2n * reference[currency] : null;
  const label = currency === "icp" ? "ICP" : "$BONSAI";
  const showTrade = section === "all" || section === "trade";
  const showSend = section === "all" || section === "send";
  const buyer = active && listing.buyer?.toText() === principal;
  const insufficient = quote !== null && balance !== null && balance < quote.totalDebit;

  async function action(work: () => Promise<void>) {
    setBusy(true); setError(null); setMessage(null);
    try { await work(); }
    catch (e: unknown) { setError(e instanceof Error ? e.message : String(e)); }
    finally { setBusy(false); }
  }
  function report(result: Listing) {
    setMessage(saleStatus(result));
    if (result.error) setError(result.error);
    setQuote(null);
    setListingReview(null);
    onChange();
  }

  // Keep this component mounted while hidden so in-flight status survives tab switches.
  const status = <>
    {busy && <p role="status" className="text-xs text-moss-200">Processing on-chain. Do not submit a second payment.</p>}
    {message && <p role="status" className="text-xs text-moss-200">{message}</p>}
    {error && <p role="alert" className="break-words text-xs text-red-200">{error}</p>}
  </>;
  if (section === "none") return busy || message || error ? <div className="space-y-1">{status}</div> : null;
  if (ready && isAuthenticated && !owner && !active && !buyer && !busy && !message && !error) return null;
  const heading = section === "trade" ? "List for sale" : section === "send" ? "Send to a friend" : active ? "Marketplace" : "Trade & share";

  return (
    <section aria-label="Trade or send bonsai" className={`space-y-3 text-sm ${section === "all" ? "border-t border-white/10 pt-4" : ""}`}>
      <h3 className="font-display text-lg font-semibold">{heading}</h3>
      {!ready ? <p role="status" className="text-amber-200">Marketplace details unavailable or loading. Refresh before trading or sending.</p> : (
        <>
          {active && <div className="glass-inset space-y-1 p-3">
            <p className="text-xs text-slate-400">{saleStatus(listing)}</p>
            <p className="font-display text-xl font-semibold text-moss-200">{marketPrice(listing)}</p>
            <p className="text-xs text-slate-400">2% seller fee. Buyer pays approval/payment network fees; seller pays payout network fee.</p>
          </div>}
          {!isAuthenticated ? <button className="btn-primary" onClick={signIn}>Sign in to {active ? "buy" : "trade"}</button> : (
            <>
              {owner && active && (
                <div className="space-y-2">
                  <p className="text-xs text-slate-400">Transfers are locked while listed. Cancel before sending or changing the price.</p>
                  {["active", "locking", "cancelling"].includes(listing.phase) && <button className="btn-ghost" disabled={busy} onClick={() => void action(async () => {
                    const result = await (await backendActor(identity)).cancelListing(listing.id);
                    if (result.__kind__ === "err") throw new Error(result.err);
                    report(result.ok);
                  })}>Cancel listing</button>}
                </div>
              )}
              {active && !owner && listing.phase === "active" && !quote && (
                <button className="btn-primary" disabled={busy} onClick={() => void action(async () => {
                  const result = await (await backendActor(identity)).marketQuote(listing.id);
                  if (result.__kind__ === "err") throw new Error(result.err);
                  setBalance(identity ? await tokenBalance(identity, result.ok.listing.ledger).catch(() => null) : null);
                  setQuote(result.ok);
                })}>Review purchase</button>
              )}
              {quote && <div className="glass-inset space-y-2 p-3">
                <p className="font-medium">Confirm purchase</p>
                <dl className="space-y-1 text-xs">
                  <div className="flex flex-wrap justify-between gap-2"><dt>Sale price</dt><dd>{marketPrice(quote.listing)}</dd></div>
                  <div className="flex flex-wrap justify-between gap-2"><dt>Approval network fee</dt><dd>{formatIcp(quote.approvalFee, 8)} {marketCurrency(quote.listing)}</dd></div>
                  <div className="flex flex-wrap justify-between gap-2"><dt>Payment network fee</dt><dd>{formatIcp(quote.paymentFee, 8)} {marketCurrency(quote.listing)}</dd></div>
                  <div className="flex flex-wrap justify-between gap-2 font-semibold"><dt>Total from your wallet</dt><dd>{formatIcp(quote.totalDebit, 8)} {marketCurrency(quote.listing)}</dd></div>
                  <div className="flex flex-wrap justify-between gap-2"><dt>App fee (seller pays)</dt><dd>{formatIcp(quote.listing.appFee, 8)} {marketCurrency(quote.listing)}</dd></div>
                  <div className="flex flex-wrap justify-between gap-2"><dt>Seller receives after payout fee</dt><dd>{formatIcp(quote.sellerReceives, 8)} {marketCurrency(quote.listing)}</dd></div>
                  {balance !== null && <div className="flex flex-wrap justify-between gap-2"><dt>Your balance</dt><dd className={insufficient ? "text-red-200" : undefined}>{formatIcp(balance, 8)} {marketCurrency(quote.listing)}</dd></div>}
                </dl>
                {insufficient && <p role="alert" className="rounded-lg border border-red-300/30 bg-red-500/10 px-3 py-2 text-xs text-red-200">
                  Not enough funds: you need {formatIcp(quote.totalDebit - balance!, 8)} more {marketCurrency(quote.listing)} to buy this bonsai.
                </p>}
                <button disabled={busy || insufficient} className="btn-primary w-full" onClick={() => void action(async () => {
                  if (!identity) throw new Error("Sign in first");
                  await approveMarket(identity, quote.listing.ledger, Principal.fromText(canisterEnv()["PUBLIC_CANISTER_ID:backend"]!), quote.listing.price + quote.paymentFee, quote.approvalFee);
                  const result = await (await backendActor(identity)).buyBonsai(quote.listing.id, quote.listing.revision, quote.paymentFee);
                  if (result.__kind__ === "err") throw new Error(result.err);
                  report(result.ok);
                })}>{busy ? "Processing..." : "Approve & buy bonsai"}</button>
                <button disabled={busy} className="btn-ghost w-full" onClick={() => { setQuote(null); setBalance(null); }}>Back</button>
              </div>}
              {owner && !active && (
                <>
                  {showTrade && <>{!reference ? <p className="text-xs text-amber-200">Original mint receipt unavailable: listing is disabled, but you can still send this bonsai.</p> : (
                    <form className="space-y-2" onSubmit={(event) => {
                      event.preventDefault();
                      void action(async () => {
                        const price = parseIcp(amount);
                        if (!price || cap === null || price > cap) throw new Error("Enter a positive price within the 2x mint-reference cap");
                        if (!identity) throw new Error("Sign in first");
                        const policy = await (await backendActor(identity)).marketPolicy();
                        const ledger = currency === "icp"
                          ? Principal.fromText(canisterEnv()["PUBLIC_CANISTER_ID:icp_ledger"] ?? "ryjl3-tyaaa-aaaaa-aaaba-cai")
                          : policy.token?.ledger;
                        if (!ledger) throw new Error("$BONSAI trading is unavailable");
                        const fee = await marketLedgerFee(identity, ledger);
                        if (price <= price * 200n / 10_000n + fee) throw new Error("Price does not cover app and payout fees");
                        setListingReview({ price, fee, currency });
                      });
                    }}>
                      {section === "all" && <p className="font-medium">List your bonsai</p>}
                      <div className="flex flex-wrap gap-2">
                        <label className="min-w-0 flex-1 text-xs text-slate-400">Currency
                          <select disabled={busy} value={currency} onChange={(e) => { setCurrency(e.target.value === "token" ? "token" : "icp"); setListingReview(null); }} className="mt-1 w-full rounded-lg border border-white/15 bg-slate-900 p-2 text-sm text-slate-100">
                            <option value="icp">ICP</option>{tokenEnabled && <option value="token">$BONSAI</option>}
                          </select>
                        </label>
                        <label className="min-w-0 flex-1 text-xs text-slate-400">Asking price
                          <input disabled={busy} inputMode="decimal" value={amount} onChange={(e) => { setAmount(e.target.value); setListingReview(null); }} className="mt-1 w-full rounded-lg border border-white/15 bg-black/20 p-2 text-sm text-slate-100" placeholder="0.00" />
                        </label>
                      </div>
                      <p className="text-xs leading-relaxed text-slate-400">Maximum {formatIcp(cap ?? 0n, 8)} {label}: 2x the frozen original mint reference. Cross-currency references use tier equivalents, not exchange rates. No listing fee.</p>
                      <button disabled={busy} className="btn-ghost w-full">Review listing</button>
                    </form>
                  )}
                  {listingReview && <div className="glass-inset space-y-2 p-3 text-xs">
                    <p className="font-medium">List for {formatIcp(listingReview.price, 8)} {listingReview.currency === "icp" ? "ICP" : "$BONSAI"}</p>
                    <p>App fee (2%): {formatIcp(listingReview.price * 200n / 10_000n, 8)}</p>
                    <p>Payout network fee: {formatIcp(listingReview.fee, 8)}</p>
                    <p>Net proceeds: {formatIcp(listingReview.price - listingReview.price * 200n / 10_000n - listingReview.fee, 8)}</p>
                    <p>Listing locks transfers until cancelled or sold. Network fees can change.</p>
                    <button disabled={busy} className="btn-primary w-full" onClick={() => void action(async () => {
                      const result = await (await backendActor(identity)).listBonsai(nft.id,
                        listingReview.currency === "icp" ? Currency.icp : Currency.token, listingReview.price);
                      if (result.__kind__ === "err") throw new Error(result.err);
                      report(result.ok);
                    })}>Confirm listing</button>
                  </div>}
                  </>}
                  {showSend && <form className={`space-y-2 ${section === "all" ? "border-t border-white/10 pt-3" : ""}`} onSubmit={(event) => {
                    event.preventDefault();
                    setError(null);
                    try {
                      const target = Principal.fromText(recipient.trim());
                      if (target.isAnonymous() || target.toText() === principal) throw new Error("Choose a non-anonymous principal other than your own");
                      setSendTo(target);
                    } catch (e: unknown) { setError(e instanceof Error ? e.message : "Invalid principal"); }
                  }}>
                    <label className="block text-xs text-slate-400">Send to principal
                      <input disabled={busy} value={recipient} onChange={(e) => { setRecipient(e.target.value); setSendTo(null); }} className="mt-1 w-full rounded-lg border border-white/15 bg-black/20 p-2 font-mono text-xs text-slate-100" placeholder="Recipient principal" />
                    </label>
                    <button disabled={busy} className="btn-ghost w-full">Review transfer</button>
                  </form>}
                  {showSend && sendTo && <div className="glass-inset space-y-2 p-3 text-xs">
                    <p>This transfer is irreversible. Confirm the full recipient:</p>
                    <p className="break-all font-mono text-moss-200">{sendTo.toText()}</p>
                    <button disabled={busy} className="btn-primary w-full" onClick={() => void action(async () => {
                      const [result] = await (await icrc7Actor(identity)).icrc7_transfer([{ token_id: nft.id, to: { owner: sendTo } }]);
                      if (!result || result.__kind__ === "Err") throw new Error(result?.__kind__ === "Err" ? JSON.stringify(result.Err, (_, value) => typeof value === "bigint" ? value.toString() : value) : "No transfer receipt returned");
                      setSendTo(null); setRecipient(""); setMessage("Bonsai sent successfully"); onChange();
                    })}>Confirm send bonsai</button>
                  </div>}
                </>
              )}
              {buyer && listing.phase !== "active" && <button disabled={busy} className="btn-ghost" onClick={() => void action(async () => {
                const result = await (await backendActor(identity)).retryMarket(listing.id);
                if (result.__kind__ === "err") throw new Error(result.err);
                report(result.ok);
              })}>Resume purchase (no new charge)</button>}
            </>
          )}
        </>
      )}
      {status}
    </section>
  );
}
