import { useEffect, useState } from "react";
import { useAuthContext } from "../components/AuthProvider";
import { backendActor, icrc7Actor } from "../lib/actors";
import { MysteryPot } from "../components/MysteryPot";
import { BonsaiSvg } from "../components/BonsaiSvg";
import { GrowingPixelBonsai } from "../components/GrowingBonsai";
import { growth, parseCanonicalSvg, type Growth } from "../lib/growth";
import { nftImageUrl } from "../lib/env";
import { bonsaiDescription } from "../lib/render";
import type { NftPublic, Purchase } from "../lib/idl";
import { Method, type PaymentError } from "../bindings/backend";
import { canisterEnv } from "../lib/env";
import { ICP_FEE, approveIcp, balanceOf, formatIcp, ledgerMessage } from "../lib/ledger";
import { LUCKY_ODDS, quoteE8s, tierName, tierOf } from "../lib/tiers";
import { PricePicker } from "../components/PricePicker";
import { BALANCE_POLL_MS, startPolling } from "../lib/polling";
import { Principal } from "@icp-sdk/core/principal";

type Pricing = { tiers: { name: string; eur: bigint }[]; minEur: bigint; maxEur: bigint; e8sPerEur: bigint; e8sStep: bigint };
type PayWith = "card" | "icp";

function paymentMessage(error: PaymentError): string {
  switch (error.__kind__) {
    case "unauthorized": return "Sign in with Internet Identity";
    case "forbidden": return "Controller access required";
    case "rejected": return error.rejected;
  }
}
function message(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}
function label(p: Purchase): string {
  if (p.fulfillment === "minted") return p.lucky ? "Minted · lucky bloom" : "Minted";
  if (p.method === Method.icp && p.fulfillment === "closed") return "ICP payment failed";
  if (p.method === Method.icp && p.fulfillment === "awaiting") return "Collecting ICP payment";
  if (p.fulfillment === "minting") return "Payment received - minting";
  if (p.fulfillment === "paid") return "Payment received - NFT pending";
  if (p.fulfillment === "review") return "Reconciliation required";
  if (p.paymentStatus === "partially_paid") return "Partially paid - complete payment";
  if (p.paymentStatus === "high_risk") return "Provider review required";
  if (p.fulfillment === "closed") return `Payment ${p.paymentStatus}`;
  if (p.paymentStatus === "confirming") return "Confirming payment";
  return p.fulfillment === "creating" ? "Creating checkout" : "Awaiting payment";
}

// Purchases seen before minting, per principal; each grows once when it first appears minted (also after Paw's return redirect).
const awaitingKey = (principal: string) => `bonsai:awaiting-growth:${principal}`;
function readAwaiting(principal: string): Set<string> {
  try { return new Set(JSON.parse(localStorage.getItem(awaitingKey(principal)) ?? "[]") as string[]); }
  catch { return new Set(); }
}
function writeAwaiting(principal: string, ids: Set<string>) {
  try { localStorage.setItem(awaitingKey(principal), JSON.stringify([...ids])); } catch { /* storage unavailable: no growth replay */ }
}
const inProgress = (p: Purchase) => p.nftId === undefined && p.fulfillment !== "closed";

export function Mint() {
  const { isAuthenticated, isLoading, signIn, identity, error: authError } = useAuthContext();
  const [eur, setEur] = useState(99);
  const [payWith, setPayWith] = useState<PayWith>("card");
  const [pricing, setPricing] = useState<Pricing>();
  const [balanceTick, setBalanceTick] = useState(0);
  const [cardReady, setCardReady] = useState(true);
  const [icpBalance, setIcpBalance] = useState<bigint>();
  const [stage, setStage] = useState<string>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const [purchases, setPurchases] = useState<Purchase[]>([]);
  const [selected, setSelected] = useState<string | null>();
  const [minted, setMinted] = useState<NftPublic | null>(null);
  const [mintedGrowth, setMintedGrowth] = useState<Growth | null>(null);
  const [growingId, setGrowingId] = useState<string | null>(null);
  const [lookupAttempt, setLookupAttempt] = useState(0);
  const [mode, setMode] = useState("Loading checkout configuration");
  const record = purchases.find((p) => p.id === selected);

  useEffect(() => {
    setPurchases([]);
    setSelected(undefined);
    setMinted(null);
    setGrowingId(null);
    if (!identity) return;
    const principal = identity.getPrincipal().toText();
    let cancelled = false;
    let infoLoaded = false;
    // Poll fast only while a purchase is in flight; otherwise every 30 s, and never in a hidden tab.
    const tick = async (): Promise<number> => {
      try {
        const actor = await backendActor(identity);
        const [list, info] = await Promise.all([actor.getMyPurchases(), infoLoaded ? null : actor.paymentInfo()]);
        if (cancelled) return 30_000;
        setPurchases(list);
        const awaiting = readAwaiting(principal);
        const ready = list.filter((p) => p.nftId !== undefined && awaiting.has(p.id));
        const known = new Set(list.map((p) => p.id));
        writeAwaiting(principal, new Set([
          ...[...awaiting].filter((id) => known.has(id) && !ready.some((p) => p.id === id)),
          ...list.filter(inProgress).map((p) => p.id),
        ]));
        if (ready.length) {
          setSelected(ready[0].id);
          setGrowingId(ready[0].id);
        } else {
          // Open on a fresh mint, or on an unfinished purchase so it can be resumed; past bonsai stay in the list.
          setSelected((current) => current === undefined ? (list.find(inProgress)?.id ?? null) : current);
        }
        if (info) {
          infoLoaded = true;
          setMode(info.mock ? "Local mock - card payments are simulated" : info.sandbox ? "Sandbox - hosted checkout is not payable" : "Live checkout");
          setCardReady(info.mock || info.configured);
        }
        return list.some(inProgress) ? 4000 : 30_000;
      } catch (e) {
        if (!cancelled) setError(`Could not refresh purchases: ${message(e)}`);
        return 15_000;
      }
    };
    const stop = startPolling(tick);
    return () => { cancelled = true; stop(); };
  }, [identity]);

  useEffect(() => {
    let cancelled = false;
    void backendActor(identity).then((a) => a.pricing()).then((p) => { if (!cancelled) setPricing(p); })
      .catch((e: unknown) => { if (!cancelled) setError(`Could not load prices: ${message(e)}`); });
    return () => { cancelled = true; };
  }, [identity]);

  useEffect(() => { if (!cardReady) setPayWith("icp"); }, [cardReady]);

  useEffect(() => {
    setIcpBalance(undefined);
    if (!identity || payWith !== "icp") return;
    let cancelled = false;
    const stop = startPolling(async () => {
      const b = await balanceOf(identity);
      if (!cancelled) setIcpBalance(b);
      return BALANCE_POLL_MS;
    });
    return () => { cancelled = true; stop(); };
  }, [identity, payWith, balanceTick]);

  useEffect(() => {
    setMinted(null);
    setMintedGrowth(null);
    const id = record?.nftId;
    if (id === undefined) return;
    const grow = record?.id === growingId;
    let cancelled = false;
    void icrc7Actor(identity).then((actor) => Promise.all([actor.getNft(id), grow ? actor.getArtwork(id).catch(() => null) : null])).then(([nft, art]) => {
      if (cancelled) return;
      if (!nft) throw new Error("Minted token is not available");
      try {
        // Growth layers come from the stored artwork; the certified image is the final frame.
        if (art) setMintedGrowth(growth(parseCanonicalSvg(art.svg), art.silhouette, art.traits));
      } catch {
        setMintedGrowth(null);
      }
      setMinted(nft);
    }).catch((e: unknown) => { if (!cancelled) setError(`NFT lookup failed: ${message(e)}`); });
    return () => { cancelled = true; };
  }, [record?.nftId, record?.id, growingId, identity, lookupAttempt]);

  const anchors = pricing?.tiers.map((t) => Number(t.eur)) ?? [];
  const tier = pricing ? tierOf(eur, anchors) : 1;
  const quote = pricing ? quoteE8s(eur, pricing.e8sPerEur, pricing.e8sStep) : undefined;
  const icpNeeded = quote !== undefined ? quote + 2n * ICP_FEE : undefined;
  const lowBalance = payWith === "icp" && icpBalance !== undefined && icpNeeded !== undefined && icpBalance < icpNeeded;

  async function create() {
    if (!identity || quote === undefined) return;
    setBusy(true);
    setError(undefined);
    try {
      const actor = await backendActor(identity);
      if (payWith === "icp") {
        setStage("Approving ICP…");
        try {
          await approveIcp(identity, Principal.fromText(canisterEnv()["PUBLIC_CANISTER_ID:backend"]!), quote + ICP_FEE);
        } catch (e) { throw new Error(ledgerMessage(e)); }
        setStage("Paying and planting…");
      }
      const result = payWith === "icp" ? await actor.buyWithIcp(BigInt(eur), quote) : await actor.createPurchase(BigInt(eur));
      if (result.__kind__ === "err") {
        const saved = await actor.getMyPurchases();
        setPurchases(saved);
        setSelected(saved[0]?.id ?? null);
        throw new Error(paymentMessage(result.err));
      }
      const principal = identity.getPrincipal().toText();
      const awaiting = readAwaiting(principal);
      if (result.ok.nftId === undefined) awaiting.add(result.ok.id);
      else awaiting.delete(result.ok.id);
      writeAwaiting(principal, awaiting);
      setPurchases((list) => [result.ok, ...list.filter((p) => p.id !== result.ok.id)]);
      setSelected(result.ok.id);
      setGrowingId(result.ok.nftId === undefined ? null : result.ok.id);
    } catch (e) { setError(message(e)); }
    finally {
      setBusy(false);
      setStage(undefined);
      if (payWith === "icp") setBalanceTick((n) => n + 1);
    }
  }

  async function refresh() {
    if (!record || !identity) return;
    setBusy(true);
    setError(undefined);
    try {
      const result = await (await backendActor(identity)).refreshPurchase(record.id);
      if (result.__kind__ === "err") throw new Error(paymentMessage(result.err));
      setPurchases((list) => list.map((p) => p.id === result.ok.id ? result.ok : p));
    } catch (e) { setError(message(e)); }
    finally { setBusy(false); }
  }

  if (!isAuthenticated) return (
    <div className="glass mx-auto max-w-md p-8 text-center">
      <h2 className="mb-3 font-display text-2xl">Sign in to mint</h2>
      <p className="mb-6">Internet Identity links your bonsai to your principal. No seed phrase needed.</p>
      <button onClick={signIn} disabled={isLoading} className="btn-primary mx-auto">Sign in with Internet Identity</button>
      {authError && <p role="alert" className="mt-4 text-red-200">{authError}</p>}
    </div>
  );

  return (
    <div className="grid gap-8 md:grid-cols-[1fr_380px]">
      <section className="glass-strong flex min-h-[480px] flex-col items-center justify-center p-6">
        {minted ? <div className="w-full max-w-[340px] text-center">
          <h2 className="mb-3">Your bonsai #{minted.id.toString()}</h2>
          {mintedGrowth && growingId === record?.id
            ? <GrowingPixelBonsai key={minted.id.toString()} growth={mintedGrowth} image={nftImageUrl(minted.id)} alt={bonsaiDescription(minted.traits)} />
            : <BonsaiSvg nftId={minted.id} alt={bonsaiDescription(minted.traits)} />}
          {record?.lucky && <p className="mt-3 inline-block rounded-full bg-amber-300/20 px-3 py-1 text-sm text-amber-200">
            Lucky bloom · grew as {tierName(record.artTier)}</p>}
          <p className="mt-3 text-sm text-slate-300">{bonsaiDescription(minted.traits)}</p>
          <div className="mt-4 flex flex-wrap justify-center gap-2">
            <button className="btn-ghost" onClick={() => { setSelected(null); setGrowingId(null); }}>Mint another bonsai</button>
            <a href="/my-nfts" className="btn-ghost">View my collection</a>
          </div>
        </div> : <MysteryPot tier={record && record.nftId === undefined && record.fulfillment !== "closed" ? Number(record.tier) : tier}
          brewing={busy || !!record && !["minted", "closed", "review"].includes(record.fulfillment)} />}
      </section>
      <section className="space-y-5">
        <div className="glass p-6">
          <h1 className="font-display text-2xl">Mint your bonsai</h1>
          <p className="my-3 text-sm text-slate-300">{mode}</p>
          {pricing
            ? <PricePicker anchors={anchors} value={eur} onChange={setEur} disabled={busy}
                icpLabel={quote !== undefined ? formatIcp(quote) : undefined} />
            : <p className="text-sm text-slate-400">Loading prices…</p>}
          <p className="mt-2 text-xs text-slate-400">{LUCKY_ODDS} bonsai bloom one tier higher.</p>
          <div className="my-4 grid grid-cols-2 gap-1" role="tablist" aria-label="Payment method">
            <button role="tab" aria-selected={payWith === "card"} disabled={!cardReady}
              className={payWith === "card" ? "nav-link-active justify-center" : "nav-link justify-center"} onClick={() => setPayWith("card")}>Card</button>
            <button role="tab" aria-selected={payWith === "icp"}
              className={payWith === "icp" ? "nav-link-active justify-center" : "nav-link justify-center"} onClick={() => setPayWith("icp")}>ICP</button>
          </div>
          {payWith === "icp" && <p className="mb-3 text-sm text-slate-300">
            Wallet: {icpBalance === undefined ? "…" : `${formatIcp(icpBalance)} ICP`}
            {lowBalance && <> · <a href="/wallet" className="underline">top up</a></>}
          </p>}
          <button disabled={busy || quote === undefined || lowBalance || (payWith === "card" && !cardReady)} onClick={create} className="btn-primary w-full justify-center">
            {busy ? (stage ?? "Working…") : quote === undefined ? "Loading…" : payWith === "icp"
              ? `Pay ${formatIcp(quote)} ICP` : `Pay €${eur} by card`}
          </button>
          {payWith === "card" && <p className="mt-3 text-xs text-slate-400">Card via PawPayments (USDC checkout). Card fees extra.</p>}
          {payWith === "icp" && <p className="mt-3 text-xs text-slate-400">Approve + payment fees {formatIcp(2n * ICP_FEE, 8)} ICP.</p>}
          {error && <p role="alert" className="mt-4 text-sm text-red-200">{error}</p>}
        </div>
        {record && <div className="glass space-y-3 p-5">
          <h2 className="font-semibold" aria-live="polite">{label(record)}</h2>
          <p className="text-sm">{record.id} · {tierName(record.tier)} · {record.method === Method.icp && record.amountE8s !== undefined
            ? `${formatIcp(record.amountE8s)} ICP` : `€${record.amountEur.toString()}`}</p>
          {record.lastError && <p role="alert" className="text-sm text-amber-200">{record.lastError}</p>}
          {record.checkoutUrl && record.fulfillment !== "minted" && record.fulfillment !== "closed" &&
            <a href={record.checkoutUrl} target="_blank" rel="noopener noreferrer" className="btn-primary justify-center">Open / reopen secure checkout</a>}
          {!["minted", "closed"].includes(record.fulfillment) &&
            <button onClick={refresh} disabled={busy} className="btn-ghost">Check status / retry fulfillment</button>}
          {record.nftId !== undefined && !minted &&
            <button onClick={() => setLookupAttempt((n) => n + 1)} className="btn-ghost">Retry NFT lookup</button>}
          {record.method !== Method.icp && <p className="text-xs text-slate-400">You can safely leave this page. Do not pay a second invoice to retry minting.</p>}
        </div>}
        {purchases.length > 0 && <div className="glass p-5">
          <h2 className="mb-2 font-semibold">Your purchases</h2>
          <ul className="max-h-72 space-y-2 overflow-auto">{purchases.map((p) =>
            <li key={p.id}><button data-purchase-id={p.id} onClick={() => { setSelected(p.id); setGrowingId(null); }} className="text-left text-sm underline">{tierName(p.tier)} · {label(p)}</button></li>)}</ul>
        </div>}
      </section>
    </div>
  );
}
