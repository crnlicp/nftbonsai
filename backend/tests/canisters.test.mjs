import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { existsSync } from "node:fs";
import { PocketIc, PocketIcServer, SubnetStateType } from "@dfinity/pic";
import { Certificate, Cbor, reconstruct, lookup_path, LookupPathStatus, HttpAgent } from "@icp-sdk/core/agent";
import { IDL } from "@icp-sdk/core/candid";
import { Principal } from "@icp-sdk/core/principal";
import { idlFactory as backendIdl } from "../../frontend/src/bindings/declarations/backend.did.js";
import { idlFactory as nftIdl } from "../../frontend/src/bindings/declarations/icrc7.did.js";

const owner = Principal.selfAuthenticating(Uint8Array.of(1));
const buyer = Principal.selfAuthenticating(Uint8Array.of(2));
const emptyArgs = IDL.encode([], []);
const upgradeModeOptions = { skip_pre_upgrade: [], wasm_memory_persistence: [{ keep: null }] };
const bytes = (text) => new TextEncoder().encode(text);
const digest = (buffer) => createHash("sha256").update(buffer).digest("hex");
function rgbHash(svg) {
  const pixels = new Uint8Array(64 * 64 * 3);
  for (const match of svg.matchAll(/<rect x="(\d+)" y="(\d+)" width="(\d+)" height="1" fill="#([0-9a-f]{6})"\/>/g)) {
    const [, x, y, width, color] = match;
    for (let offset = 0; offset < Number(width); offset++) {
      pixels.set(Buffer.from(color, "hex"), (Number(y) * 64 + Number(x) + offset) * 3);
    }
  }
  return digest(pixels);
}
const seed = (name) => new Uint8Array(createHash("sha256").update(name).digest());
const wasm = (name) => resolve(`.mops/.build/${name}.wasm`);
const baselineDir = process.env.MARKET_BASELINE_DIR ?? "../.icp/cache/artifacts";
let server;

before(async () => { server = await PocketIcServer.start(); });
after(async () => { await server?.stop(); });

const ACCOUNT = IDL.Record({ owner: IDL.Principal, subaccount: IDL.Opt(IDL.Vec(IDL.Nat8)) });
const ledgerIdl = ({ IDL }) => IDL.Service({
  mint: IDL.Func([IDL.Principal, IDL.Nat], [], []),
  setMode: IDL.Func([IDL.Variant({ normal: IDL.Null, unavailable: IDL.Null, trap: IDL.Null })], [], []),
  setPayoutMode: IDL.Func([IDL.Variant({ normal: IDL.Null, unavailable: IDL.Null, trap: IDL.Null })], [], []),
  setFee: IDL.Func([IDL.Nat], [], []),
  icrc1_balance_of: IDL.Func([ACCOUNT], [IDL.Nat], ["query"]),
  icrc2_approve: IDL.Func([IDL.Record({
    spender: ACCOUNT, amount: IDL.Nat, from_subaccount: IDL.Opt(IDL.Vec(IDL.Nat8)), expected_allowance: IDL.Opt(IDL.Nat),
    expires_at: IDL.Opt(IDL.Nat64), fee: IDL.Opt(IDL.Nat), memo: IDL.Opt(IDL.Vec(IDL.Nat8)), created_at_time: IDL.Opt(IDL.Nat64),
  })], [IDL.Variant({ Ok: IDL.Nat, Err: IDL.Reserved })], []),
});

async function fixture({ mock = false, gateway = false, ledger = false, token = false, baseline = false } = {}) {
  const pic = await PocketIc.create(server.getUrl(), gateway ? {
    nns: { state: { type: SubnetStateType.New } },
    application: [{ state: { type: SubnetStateType.New } }],
  } : undefined);
  const nftId = await pic.createCanister({ sender: owner, controllers: [owner], cycles: 10_000_000_000_000n });
  let ledgerId;
  if (ledger) {
    ledgerId = await pic.createCanister({ sender: owner, controllers: [owner], cycles: 10_000_000_000_000n });
    await pic.installCode({ sender: owner, canisterId: ledgerId, wasm: wasm("mock-ledger"), arg: emptyArgs });
  }
  let tokenId;
  if (token) {
    tokenId = await pic.createCanister({ sender: owner, controllers: [owner], cycles: 10_000_000_000_000n });
    await pic.installCode({ sender: owner, canisterId: tokenId, wasm: wasm("mock-ledger"), arg: emptyArgs });
  }
  const backendId = await pic.createCanister({
    sender: owner, controllers: [owner], cycles: 10_000_000_000_000n,
    environmentVariables: [
      { name: "PUBLIC_CANISTER_ID:icrc7", value: nftId.toText() },
      { name: "MOCK_PAYMENTS", value: mock ? "1" : "0" },
      ...(ledgerId ? [{ name: "ICP_LEDGER_ID", value: ledgerId.toText() }] : []),
    ],
  });
  await pic.updateCanisterSettings({
    sender: owner, canisterId: nftId,
    environmentVariables: [{ name: "PUBLIC_CANISTER_ID:backend", value: backendId.toText() }],
  });
  await pic.installCode({ sender: owner, canisterId: nftId, wasm: baseline ? resolve(baselineDir, "icrc7") : wasm("icrc7"), arg: emptyArgs });
  await pic.installCode({ sender: owner, canisterId: backendId, wasm: baseline ? resolve(baselineDir, "backend") : wasm("backend"), arg: emptyArgs });
  const backend = pic.createActor(backendIdl, backendId);
  const nft = pic.createActor(nftIdl, nftId);
  const deferred = pic.createDeferredActor(backendIdl, backendId);
  backend.setPrincipal(owner);
  deferred.setPrincipal(owner);
  nft.setPrincipal(owner);
  const icp = ledgerId ? pic.createActor(ledgerIdl, ledgerId) : undefined;
  icp?.setPrincipal(owner);
  const tok = tokenId ? pic.createActor(ledgerIdl, tokenId) : undefined;
  tok?.setPrincipal(owner);
  return { pic, nft, backend, deferred, nftId, backendId, icp, ledgerId, tok, tokenId };
}

async function setBackend(f, principal) {
  await f.pic.updateCanisterSettings({
    sender: owner, canisterId: f.nftId,
    environmentVariables: [{ name: "PUBLIC_CANISTER_ID:backend", value: principal.toText() }],
  });
}

test("runtime wiring and controller authorization change without an upgrade", async () => {
  const f = await fixture({ mock: true });
  try {
    f.nft.setPrincipal(Principal.anonymous());
    assert.deepEqual(await f.nft.mintV2(owner, seed("wiring"), 2n, "runtime"), { err: { unauthorized: null } });
    f.nft.setPrincipal(owner);
    assert.deepEqual(await f.nft.mintV2(owner, seed("wiring"), 2n, "runtime"), { err: { forbidden: null } });
    await setBackend(f, owner);
    assert.ok("ok" in await f.nft.mintV2(owner, seed("wiring"), 2n, "runtime"));
    await setBackend(f, f.backendId);
    assert.deepEqual(await f.nft.mintV2(owner, seed("wiring"), 2n, "runtime"), { err: { forbidden: null } });
    await f.pic.updateCanisterSettings({ sender: owner, canisterId: f.backendId, controllers: [buyer] });
    assert.deepEqual(await f.backend.configurePaw("live-key", "usdc_eth", "", false), { err: { forbidden: null } });
    f.backend.setPrincipal(buyer);
    assert.ok("ok" in await f.backend.configurePaw("live-key", "usdc_eth", "", false));
  } finally { await f.pic.tearDown(); }
});

const account = (owner) => ({ owner, subaccount: [] });
async function approve(f, who, amount, ledger = f.icp) {
  ledger.setPrincipal(who);
  const r = await ledger.icrc2_approve({ spender: account(f.backendId), amount, from_subaccount: [], expected_allowance: [], expires_at: [], fee: [], memo: [], created_at_time: [] });
  assert.ok("Ok" in r);
}

const E8S = 100_000_000n;
const json = (v) => JSON.stringify(v, (_, x) => typeof x === "bigint" ? x.toString() : x);

async function mintedForMarket(f, units = 19n) {
  await f.icp.mint(owner, 1000n * E8S);
  await approve(f, owner, 1000n * E8S);
  const purchase = (await f.backend.buyWithIcp(units)).ok;
  assert.ok(purchase?.nftId.length);
  return purchase;
}

test("marketplace enforces immutable caps, ownership locks and single-buyer settlement with isolated fees", async () => {
  const f = await fixture({ ledger: true, token: true });
  try {
    const purchase = await mintedForMarket(f, 30n);
    const nftId = purchase.nftId[0];
    const token = (await f.nft.getNft(nftId))[0];
    const [[reference]] = await f.backend.mintReferences([token.paymentId]);
    assert.deepEqual(reference, { icp: 30n * E8S, token: 30_000n * E8S });
    await f.backend.setTierPrices({ icp: null }, [90n, 190n, 490n, 990n, 2490n]);
    assert.deepEqual((await f.backend.mintReferences([token.paymentId]))[0][0], reference);
    assert.match((await f.backend.listBonsai(nftId, { icp: null }, 60n * E8S + 1n)).err, /2x/);
    assert.match((await f.backend.listBonsai(nftId, { icp: null }, 0n)).err, /positive/);
    const listing = (await f.backend.listBonsai(nftId, { icp: null }, 40n * E8S)).ok;
    assert.ok("active" in listing.phase);
    assert.equal((await f.nft.getNft(nftId))[0].owner.toText(), owner.toText());
    const transfer = await f.nft.icrc7_transfer([{ token_id: nftId, to: account(buyer), from_subaccount: [], memo: [], created_at_time: [] }]);
    assert.match(transfer[0][0].Err.GenericError.message, /Cancel/);
    assert.match((await f.backend.buyBonsai(listing.id, listing.revision, 10_000n)).err, /own/);
    f.backend.setPrincipal(buyer);
    assert.match((await f.backend.cancelListing(listing.id)).err, /seller/);
    await f.icp.mint(buyer, 100n * E8S);
    await approve(f, buyer, 100n * E8S);
    const before = await f.icp.icrc1_balance_of(account(buyer));
    const sellerBefore = await f.icp.icrc1_balance_of(account(owner));
    const sale = (await f.backend.buyBonsai(listing.id, listing.revision, 10_000n)).ok;
    assert.ok("sold" in sale.phase, json(sale));
    assert.equal((await f.nft.getNft(nftId))[0].owner.toText(), buyer.toText());
    assert.equal(await f.icp.icrc1_balance_of(account(buyer)), before - sale.price - 10_000n);
    assert.equal(await f.icp.icrc1_balance_of(account(owner)), sellerBefore + sale.proceeds);
    assert.equal(sale.appFee, 80_000_000n);
    const replay = (await f.backend.buyBonsai(listing.id, listing.revision, 10_000n)).ok;
    assert.deepEqual(replay, sale);
    assert.equal(await f.icp.icrc1_balance_of(account(buyer)), before - sale.price - 10_000n);
    assert.match((await f.backend.listBonsai(nftId, { icp: null }, 60n * E8S + 1n)).err, /2x/);
    const relisted = (await f.backend.listBonsai(nftId, { icp: null }, 60n * E8S)).ok;
    assert.ok("active" in relisted.phase);
    assert.ok("cancelled" in (await f.backend.cancelListing(relisted.id)).ok.phase);
    f.backend.setPrincipal(owner);
    assert.ok("ok" in await f.backend.claimMarketFee(listing.id));
    assert.ok("ok" in await f.backend.claimMarketFee(listing.id), "fee sweep is idempotent");
    const recipient = Principal.selfAuthenticating(Uint8Array.of(3));
    f.nft.setPrincipal(buyer);
    const sent = await f.nft.icrc7_transfer([{ token_id: nftId, to: account(recipient), from_subaccount: [], memo: [], created_at_time: [] }]);
    assert.ok("Ok" in sent[0][0]);
    assert.match((await f.nft.deliverSale(nftId, listing.id, buyer)).err, /backend/i);
    await setBackend(f, owner);
    f.nft.setPrincipal(owner);
    assert.equal((await f.nft.deliverSale(nftId, listing.id, buyer)).ok, sale.deliveryBlock[0]);
    assert.equal((await f.nft.getNft(nftId))[0].owner.toText(), recipient.toText(), "old delivery replay cannot undo an onward transfer");
    assert.match((await f.nft.deliverSale(nftId, listing.id, owner)).err, /receipt|match|conflict/i);
  } finally { await f.pic.tearDown(); }
});

test("marketplace reconciles expired unknown debits and payouts without recharging or stranding proceeds", async () => {
  const f = await fixture({ ledger: true });
  try {
    const nftId = (await mintedForMarket(f)).nftId[0];
    let listing = (await f.backend.listBonsai(nftId, { icp: null }, 20n * E8S)).ok;
    await f.icp.mint(buyer, 100n * E8S);
    await approve(f, buyer, 100n * E8S);
    f.backend.setPrincipal(buyer);
    const before = await f.icp.icrc1_balance_of(account(buyer));
    await f.icp.setMode({ trap: null });
    let sale = (await f.backend.buyBonsai(listing.id, listing.revision, 10_000n)).ok;
    assert.ok(sale.paymentUncertain);
    await f.pic.advanceTime(25 * 60 * 60 * 1000);
    await f.icp.setMode({ normal: null });
    for (let attempt = 0; attempt < 10; attempt++) {
      await f.pic.tick(10);
      listing = (await f.backend.marketListings([listing.nftId]))[0][0];
      if ("active" in listing.phase) break;
      await f.backend.retryMarket(listing.id);
    }
    assert.ok("active" in listing.phase, json(listing));
    assert.equal(await f.icp.icrc1_balance_of(account(buyer)), before);
    assert.equal((await f.nft.getNft(nftId))[0].owner.toText(), owner.toText());
    await f.icp.setPayoutMode({ trap: null });
    sale = (await f.backend.buyBonsai(listing.id, listing.revision, 10_000n)).ok;
    assert.ok("paying" in sale.phase);
    assert.ok(sale.payoutUncertain);
    const paidBalance = await f.icp.icrc1_balance_of(account(buyer));
    await f.pic.advanceTime(25 * 60 * 60 * 1000);
    await f.icp.setFee(20_000n);
    await f.icp.setPayoutMode({ normal: null });
    for (let attempt = 0; attempt < 10; attempt++) {
      await f.pic.tick(10);
      sale = (await f.backend.marketListings([listing.nftId]))[0][0];
      if ("sold" in sale.phase) break;
      await f.backend.retryMarket(listing.id);
    }
    assert.ok("sold" in sale.phase, json(sale));
    assert.equal(sale.proceeds, sale.price - sale.appFee - 20_000n);
    assert.equal(await f.icp.icrc1_balance_of(account(buyer)), paidBalance);
    assert.equal((await f.nft.getNft(nftId))[0].owner.toText(), buyer.toText());
  } finally { await f.pic.tearDown(); }
});

test("marketplace paid delivery and seller payouts recover across outages and upgrades without recharging", async () => {
  const f = await fixture({ ledger: true });
  try {
    const purchase = await mintedForMarket(f);
    const nftId = purchase.nftId[0];
    const listing = (await f.backend.listBonsai(nftId, { icp: null }, 20n * E8S)).ok;
    await f.icp.mint(buyer, 100n * E8S);
    await approve(f, buyer, 100n * E8S);
    await setBackend(f, owner);
    f.backend.setPrincipal(buyer);
    let sale = (await f.backend.buyBonsai(listing.id, listing.revision, 10_000n)).ok;
    assert.ok("delivering" in sale.phase);
    const paidBalance = await f.icp.icrc1_balance_of(account(buyer));
    assert.match((await f.backend.cancelListing(listing.id)).err, /seller/);
    f.backend.setPrincipal(owner);
    assert.match((await f.backend.cancelListing(listing.id)).err, /reserved/);
    await f.pic.upgradeCanister({ sender: owner, canisterId: f.backendId, wasm: wasm("backend"), arg: emptyArgs, upgradeModeOptions });
    await setBackend(f, f.backendId);
    await f.icp.setPayoutMode({ unavailable: null });
    f.backend.setPrincipal(buyer);
    sale = (await f.backend.retryMarket(listing.id)).ok;
    assert.ok("paying" in sale.phase);
    assert.equal((await f.nft.getNft(nftId))[0].owner.toText(), buyer.toText());
    await f.icp.setPayoutMode({ normal: null });
    await f.icp.setFee(20_000n);
    await f.backend.retryMarket(listing.id);
    sale = (await f.backend.retryMarket(listing.id)).ok;
    assert.ok("sold" in sale.phase, json(sale));
    assert.equal(sale.proceeds, sale.price - sale.appFee - 20_000n);
    assert.equal(await f.icp.icrc1_balance_of(account(buyer)), paidBalance);
    assert.equal((await f.backend.myMarketActivity([]))[0].id, sale.id);
  } finally { await f.pic.tearDown(); }
});

test("marketplace reservations prevent double buyers and preserve approval locks", async () => {
  const f = await fixture({ ledger: true });
  try {
    const purchase = await mintedForMarket(f);
    const nftId = purchase.nftId[0];
    await f.nft.icrc37_approve_collection([{ approval_info: {
      spender: account(buyer), memo: [], from_subaccount: [], created_at_time: [], expires_at: [],
    } }]);
    const listing = (await f.backend.listBonsai(nftId, { icp: null }, 20n * E8S)).ok;
    f.nft.setPrincipal(buyer);
    const approved = (await f.nft.icrc37_transfer_from([{
      spender_subaccount: [], from: account(owner), to: account(buyer), token_id: nftId, memo: [], created_at_time: [],
    }]))[0][0];
    assert.match(approved.Err.GenericError.message, /locked/);
    await f.icp.mint(buyer, 100n * E8S);
    await approve(f, buyer, 100n * E8S);
    await f.icp.setMode({ unavailable: null });
    f.backend.setPrincipal(buyer);
    const reserved = (await f.backend.buyBonsai(listing.id, listing.revision, 10_000n)).ok;
    assert.ok("collecting" in reserved.phase);
    f.backend.setPrincipal(Principal.selfAuthenticating(Uint8Array.of(3)));
    assert.match((await f.backend.buyBonsai(listing.id, listing.revision, 10_000n)).err, /reserved/);
    await f.icp.setMode({ normal: null });
    f.backend.setPrincipal(buyer);
    assert.ok("sold" in (await f.backend.retryMarket(listing.id)).ok.phase);
  } finally { await f.pic.tearDown(); }
});

test("marketplace upgrades the deployed pre-marketplace artifacts preserving purchases, SVGs and frozen references", {
  skip: !existsSync(resolve(baselineDir, "backend")) || !existsSync(resolve(baselineDir, "icrc7")),
}, async () => {
  const f = await fixture({ ledger: true, baseline: true });
  try {
    const purchase = await mintedForMarket(f, 30n);
    const nftId = purchase.nftId[0];
    const art = (await f.nft.getArtwork(nftId))[0];
    await f.pic.upgradeCanister({ sender: owner, canisterId: f.nftId, wasm: wasm("icrc7"), arg: emptyArgs, upgradeModeOptions });
    await f.pic.upgradeCanister({ sender: owner, canisterId: f.backendId, wasm: wasm("backend"), arg: emptyArgs, upgradeModeOptions });
    assert.deepEqual((await f.backend.getMyPurchases())[0], purchase);
    assert.equal((await f.nft.getArtwork(nftId))[0].svg, art.svg);
    assert.equal((await f.nft.http_request({ method: "GET", url: "/logo.svg", headers: [], body: new Uint8Array() })).status_code, 200,
      "upgraded collection serves the certified logo");
    const key = (await f.nft.getNft(nftId))[0].paymentId;
    assert.deepEqual((await f.backend.mintReferences([key]))[0][0], { icp: 30n * E8S, token: 30_000n * E8S });
    const listing = (await f.backend.listBonsai(nftId, { icp: null }, 40n * E8S)).ok;
    assert.ok("active" in listing.phase);
    await f.pic.upgradeCanister({ sender: owner, canisterId: f.nftId, wasm: wasm("icrc7"), arg: emptyArgs, upgradeModeOptions });
    assert.equal((await f.nft.saleLock(nftId))[0].listingId, listing.id);
    assert.deepEqual(await f.backend.setLike(nftId, true), { ok: { count: 1n, liked: true } }, "migrated backend accepts likes");
  } finally { await f.pic.tearDown(); }
});

test("likes are per principal, idempotent, verified against the collection and survive upgrades", async () => {
  const f = await fixture({ ledger: true });
  try {
    const nftId = (await mintedForMarket(f)).nftId[0];
    f.backend.setPrincipal(Principal.anonymous());
    assert.deepEqual(await f.backend.setLike(nftId, true), { err: "Sign in to like bonsai" });
    assert.deepEqual(await f.backend.likeStats([nftId]), [{ count: 0n, liked: false }]);
    f.backend.setPrincipal(owner);
    assert.deepEqual(await f.backend.setLike(nftId + 99n, true), { err: "Unknown bonsai" });
    assert.deepEqual(await f.backend.likeStats([nftId + 99n]), [{ count: 0n, liked: false }]);
    assert.deepEqual(await f.backend.setLike(nftId, true), { ok: { count: 1n, liked: true } });
    assert.deepEqual(await f.backend.setLike(nftId, true), { ok: { count: 1n, liked: true } }, "liking twice counts once");
    f.backend.setPrincipal(buyer);
    assert.deepEqual(await f.backend.setLike(nftId, true), { ok: { count: 2n, liked: true } });
    assert.deepEqual(await f.backend.setLike(nftId, false), { ok: { count: 1n, liked: false } });
    assert.deepEqual(await f.backend.setLike(nftId, false), { ok: { count: 1n, liked: false } }, "unliking twice is a no-op");
    await assert.rejects(f.backend.likeStats(Array.from({ length: 101 }, (_, i) => BigInt(i))));
    await f.pic.upgradeCanister({ sender: owner, canisterId: f.backendId, wasm: wasm("backend"), arg: emptyArgs, upgradeModeOptions });
    f.backend.setPrincipal(owner);
    assert.deepEqual(await f.backend.likeStats([nftId, nftId + 99n]), [{ count: 1n, liked: true }, { count: 0n, liked: false }]);
    f.backend.setPrincipal(Principal.anonymous());
    assert.deepEqual(await f.backend.likeStats([nftId]), [{ count: 1n, liked: false }], "anonymous viewers see counts");
  } finally { await f.pic.tearDown(); }
});

test("marketplace cross-currency token sales use pinned ledgers and caps, not current tier prices", async () => {
  const f = await fixture({ ledger: true, token: true });
  try {
    await f.backend.setToken([{ ledger: f.tokenId, market: f.tokenId, symbol: "BONSAI" }]);
    const purchase = await mintedForMarket(f, 19n);
    const nftId = purchase.nftId[0];
    assert.match((await f.backend.listBonsai(nftId, { token: null }, 38_000n * E8S + 1n)).err, /2x/);
    const listing = (await f.backend.listBonsai(nftId, { token: null }, 25_000n * E8S)).ok;
    await f.tok.mint(buyer, 100_000n * E8S);
    await approve(f, buyer, 100_000n * E8S, f.tok);
    await f.backend.setToken([]);
    f.backend.setPrincipal(buyer);
    const sale = (await f.backend.buyBonsai(listing.id, listing.revision, 10_000n)).ok;
    assert.ok("sold" in sale.phase);
    assert.equal(sale.ledger.toText(), f.tokenId.toText());
    assert.equal(await f.tok.icrc1_balance_of(account(owner)), sale.proceeds);
    assert.match((await f.backend.listBonsai(nftId, { token: null }, 25_000n * E8S)).err, /not configured/);
  } finally { await f.pic.tearDown(); }
});

test("pricing is public; any amount in range maps to a tier; only controllers set tiers, the token and withdraw", async () => {
  const f = await fixture({ mock: true, ledger: true });
  try {
    const pricing = await f.backend.pricing();
    assert.deepEqual(pricing.tiers.map((t) => t.name), ["Sprout", "Grove", "Jade", "Lacquer", "Imperial"]);
    assert.deepEqual(pricing.tiers.map((t) => t.eur), [49n, 99n, 199n, 499n, 999n]);
    assert.deepEqual(pricing.tiers.map((t) => t.icp), [9n, 19n, 49n, 99n, 249n]);
    assert.deepEqual(pricing.tiers.map((t) => t.token), [9_000n, 19_000n, 49_000n, 99_000n, 249_000n]);
    assert.deepEqual([pricing.minEur, pricing.maxEur, pricing.minIcp, pricing.maxIcp, pricing.minToken, pricing.maxToken],
      [49n, 999n, 9n, 249n, 9_000n, 249_000n]);
    assert.deepEqual(pricing.token, []);
    f.backend.setPrincipal(buyer);
    assert.deepEqual(await f.backend.setTierPrices({ icp: null }, [1n, 2n, 3n, 4n, 5n]), { err: { forbidden: null } });
    assert.deepEqual(await f.backend.setToken([{ ledger: buyer, market: buyer, symbol: "X" }]), { err: { forbidden: null } });
    assert.deepEqual(await f.backend.withdrawIcp(account(buyer), 1n), { err: { forbidden: null } });
    assert.deepEqual(await f.backend.withdrawToken(account(buyer), 1n), { err: { forbidden: null } });
    for (const icp of [0n, 8n, 250n]) assert.ok("err" in await f.backend.buyWithIcp(icp));
    assert.match((await f.backend.buyWithToken(9_000n)).err.rejected, /not enabled/);
    for (const eur of [0n, 48n, 1000n]) assert.ok("err" in await f.backend.createPurchase(eur));
    for (const [eur, tier] of [[49n, 0n], [98n, 0n], [99n, 1n], [150n, 1n], [498n, 2n], [500n, 3n], [999n, 4n]]) {
      const purchase = (await f.backend.createPurchase(eur)).ok;
      assert.deepEqual([purchase.amountEur, purchase.tier], [eur, tier]);
      await f.pic.advanceTime(61_000);
      await f.pic.tick(12);
    }
    f.backend.setPrincipal(owner);
    for (const bad of [[1n, 2n, 3n, 4n], [0n, 1n, 2n, 3n, 4n], [1n, 2n, 2n, 3n, 4n], [1n, 2n, 3n, 4n, 2_000_000_000n]]) {
      assert.ok("err" in await f.backend.setTierPrices({ icp: null }, bad));
    }
    assert.ok("err" in await f.backend.setTierPrices({ paw: null }, [1n, 2n, 3n, 4n, 5n]));
    assert.ok("ok" in await f.backend.setTierPrices({ icp: null }, [5n, 10n, 20n, 50n, 100n]));
    assert.ok("ok" in await f.backend.setTierPrices({ token: null }, [100n, 200n, 300n, 400n, 500n]));
    assert.ok("err" in await f.backend.setToken([{ ledger: buyer, market: buyer, symbol: "" }]));
    assert.ok("ok" in await f.backend.setToken([{ ledger: buyer, market: owner, symbol: "BONSAI" }]));
    const updated = await f.backend.pricing();
    assert.deepEqual([updated.minIcp, updated.maxIcp, updated.minToken, updated.maxToken], [5n, 100n, 100n, 500n]);
    assert.equal(updated.token[0].symbol, "BONSAI");
    assert.ok("ok" in await f.backend.setToken([]));
  } finally { await f.pic.tearDown(); }
});

test("ICP checkout pulls whole ICP once, mints the tier and lets the owner withdraw", async () => {
  const f = await fixture({ ledger: true });
  try {
    const price = 50n * E8S;
    await f.icp.mint(buyer, 200n * E8S);
    f.backend.setPrincipal(buyer);
    assert.ok("err" in await f.backend.buyWithIcp(50n), "no approval");
    let [closed] = await f.backend.getMyPurchases();
    assert.ok("closed" in closed.fulfillment);
    assert.deepEqual(await f.backend.getMintDetails([`icp:${closed.id}`]), [[]], "failed payments have no public receipt");
    assert.equal((await f.backend.paymentInfo()).pending, 0n);
    await f.pic.advanceTime(61_000);
    await approve(f, buyer, price + 10_000n);
    const result = await f.backend.buyWithIcp(50n);
    assert.ok("ok" in result, json(result.err));
    const purchase = result.ok;
    assert.ok("minted" in purchase.fulfillment);
    assert.ok("icp" in purchase.method);
    assert.deepEqual([purchase.amountEur, purchase.tier, purchase.amountE8s[0]], [0n, 2n, price]);
    assert.equal(purchase.ledgerBlock.length, 1);
    assert.equal(purchase.artTier[0], purchase.lucky ? 3n : 2n);
    assert.equal(await f.icp.icrc1_balance_of(account(f.backendId)), price);
    const art = (await f.nft.getArtwork(purchase.nftId[0]))[0];
    assert.equal(art.traits.branchCount, 3 + Number(purchase.artTier[0]));
    assert.equal((await f.nft.getNft(purchase.nftId[0]))[0].owner.toText(), buyer.toText());
    const [[receipt]] = await f.backend.getMintDetails([`icp:${purchase.id}`]);
    assert.deepEqual(receipt.price, [{ icp: price }]);
    assert.equal(receipt.creator.toText(), buyer.toText());
    assert.equal(receipt.testMint, false);
    f.backend.setPrincipal(owner);
    assert.ok("ok" in await f.backend.withdrawIcp(account(owner), price - 10_000n));
    assert.equal(await f.icp.icrc1_balance_of(account(f.backendId)), 0n);
  } finally { await f.pic.tearDown(); }
});

test("token checkout pulls from the configured token ledger, never ICP, and the owner withdraws tokens", async () => {
  const f = await fixture({ ledger: true, token: true });
  try {
    f.backend.setPrincipal(owner);
    assert.ok("ok" in await f.backend.setToken([{ ledger: f.tokenId, market: f.tokenId, symbol: "BONSAI" }]));
    const price = 20_000n * E8S;
    await f.tok.mint(buyer, 30_000n * E8S);
    await f.icp.mint(buyer, 100n * E8S);
    await approve(f, buyer, 1_000n * E8S, f.icp);
    f.backend.setPrincipal(buyer);
    assert.match((await f.backend.buyWithToken(8_999n)).err.rejected, /9000 to 249000 BONSAI/);
    assert.match((await f.backend.buyWithToken(20_000n)).err.rejected, /BONSAI approval/, "an ICP approval does not pay in tokens");
    await f.pic.advanceTime(61_000);
    await approve(f, buyer, price + 10_000n, f.tok);
    const result = await f.backend.buyWithToken(20_000n);
    assert.ok("ok" in result, json(result.err));
    const purchase = result.ok;
    assert.ok("token" in purchase.method);
    assert.ok("minted" in purchase.fulfillment);
    assert.deepEqual([purchase.tier, purchase.amountE8s[0]], [1n, price]);
    assert.equal(await f.tok.icrc1_balance_of(account(f.backendId)), price);
    assert.equal(await f.icp.icrc1_balance_of(account(f.backendId)), 0n);
    assert.equal(await f.nft.getMintByKey(`token:${purchase.id}`).then((r) => r[0]), purchase.nftId[0]);
    assert.deepEqual((await f.backend.getMintDetails([`token:${purchase.id}`]))[0][0].price, [{ token: price }]);
    assert.deepEqual(await f.backend.tokenStats(), { mints: 1n, collectedE8s: price, buyers: 1n }, "a rejected attempt is not counted");
    f.backend.setPrincipal(owner);
    assert.ok("ok" in await f.backend.withdrawToken(account(owner), price - 10_000n));
    assert.equal(await f.tok.icrc1_balance_of(account(f.backendId)), 0n);
    assert.equal(await f.tok.icrc1_balance_of(account(owner)), price - 10_000n);
  } finally { await f.pic.tearDown(); }
});

test("ICP ledger outage is retried with the same dedup key and charges once", async () => {
  const f = await fixture({ ledger: true });
  try {
    const price = 9n * E8S;
    await f.icp.mint(buyer, 10n * price);
    await approve(f, buyer, 3n * price);
    f.icp.setPrincipal(owner);
    await f.icp.setMode({ unavailable: null });
    f.backend.setPrincipal(buyer);
    let purchase = (await f.backend.buyWithIcp(9n)).ok;
    assert.ok("awaiting" in purchase.fulfillment);
    assert.equal(await f.nft.icrc7_total_supply(), 0n);
    await f.icp.setMode({ normal: null });
    for (let i = 0; i < 3; i++) { await f.pic.advanceTime(35_000); await f.pic.tick(12); }
    [purchase] = await f.backend.getMyPurchases();
    assert.ok("minted" in purchase.fulfillment);
    assert.equal(await f.nft.icrc7_total_supply(), 1n);
    assert.equal(await f.icp.icrc1_balance_of(account(buyer)), 10n * price - 10_000n - price - 10_000n);
  } finally { await f.pic.tearDown(); }
});

async function answer(pic, body, statusCode = 200) {
  await pic.tick(2);
  const calls = await pic.getPendingHttpsOutcalls();
  assert.equal(calls.length, 1, "expected one pending outcall");
  const request = calls[0];
  await pic.mockPendingHttpsOutcall({
    requestId: request.requestId, subnetId: request.subnetId,
    response: { type: "success", statusCode, headers: [], body: bytes(JSON.stringify(body)) },
  });
  await pic.tick(3);
  return request;
}

function invoice(id, intent, status, overrides = {}) {
  return {
    order_id: id, extra: intent, fiat_currency: "EUR", initial_fiat_amount: 150,
    fiat_amount: 149.4, billing_type: "STATIC", status,
    payment_url: "https://pay.pawpayments.com/checkout/test",
    ...overrides,
  };
}
async function createPaw(f) {
  assert.ok("ok" in await f.backend.configurePaw("test-live-key", "usdc_eth", "https://bonsai.example", false));
  const pending = await f.deferred.createPurchase(150n);
  const request = await answer(f.pic, { ok: true, result: invoice("0123456789abcdef01234567", "bonsai-1", "created") }, 201);
  const body = JSON.parse(new TextDecoder().decode(request.body));
  assert.equal(body.billing_type, "STATIC");
  assert.equal(body.fiat_currency, "EUR");
  assert.equal(body.asset, "usdc_eth");
  assert.deepEqual(body.accepted_coins, ["usdc_eth"]);
  assert.equal(body.underpay_tolerance, 0);
  assert.equal(body.permanent_address, false);
  assert.equal(body.extra, "bonsai-1");
  const result = await pending();
  assert.ok("ok" in result, result.err);
  return result.ok;
}
async function status(f, purchase, value) {
  const pending = await f.deferred.refreshPurchase(purchase.id);
  await answer(f.pic, value);
  const result = await pending();
  assert.ok("ok" in result);
  return result.ok;
}

test("STATIC partial payments do not mint; success fulfills once despite net fees", async () => {
  const f = await fixture();
  try {
    let purchase = await createPaw(f);
    assert.deepEqual(await f.backend.getMintDetails([`paw:live:${purchase.id}`, "unknown"]), [[], []]);
    purchase = await status(f, purchase, { ok: true, result: invoice("0123456789abcdef01234567", purchase.id, "partially_paid") });
    assert.equal(await f.nft.icrc7_total_supply(), 0n);
    assert.ok("awaiting" in purchase.fulfillment);
    purchase = await status(f, purchase, { ok: true, result: invoice("0123456789abcdef01234567", purchase.id, "success") });
    assert.ok("minted" in purchase.fulfillment);
    assert.equal(await f.nft.icrc7_total_supply(), 1n);
    await f.backend.refreshPurchase(purchase.id);
    assert.equal(await f.nft.icrc7_total_supply(), 1n);
    const token = (await f.nft.getNft(purchase.nftId[0]))[0];
    assert.equal(token.owner.toText(), owner.toText());
    f.backend.setPrincipal(Principal.anonymous());
    const [[details]] = await f.backend.getMintDetails([token.paymentId]);
    assert.deepEqual(Object.keys(details).sort(), ["artTier", "creator", "lucky", "nftId", "price", "testMint"]);
    assert.equal(details.creator.toText(), owner.toText());
    assert.equal(details.nftId, token.id);
    assert.deepEqual(details.price, [{ eur: 150n }]);
    assert.equal(details.artTier[0], purchase.artTier[0]);
    assert.equal(details.lucky, purchase.lucky);
    assert.equal(details.testMint, false);
    assert.deepEqual(await f.backend.getMintDetails([`icp:${purchase.id}`, "x".repeat(129)]), [[], []]);
    await assert.rejects(f.backend.getMintDetails(new Array(101).fill(token.paymentId)), /at most 100/);
    f.nft.setPrincipal(owner);
    assert.ok("Ok" in (await f.nft.icrc7_transfer([{
      from_subaccount: [], to: account(buyer), token_id: token.id, memo: [], created_at_time: [],
    }]))[0][0]);
    assert.equal((await f.nft.getNft(token.id))[0].owner.toText(), buyer.toText());
    assert.equal((await f.backend.getMintDetails([token.paymentId]))[0][0].creator.toText(), owner.toText(),
      "creator does not change with ownership");
    f.backend.setPrincipal(owner);
    const art = (await f.nft.getArtwork(token.id))[0];
    assert.equal(art.version, 8n);
    assert.equal(art.seed.length, 32);
    assert.equal(digest(art.silhouette), Buffer.from(art.silhouetteHash).toString("hex"));
    const image = await f.nft.http_request({ method: "GET", url: `/nft/${token.id}.svg`, headers: [], body: new Uint8Array() });
    assert.equal(new TextDecoder().decode(image.body), art.svg);
    const [[metadata]] = await f.nft.icrc7_token_metadata([token.id]);
    assert.match(metadata.find(([k]) => k === "icrc7:metadata:uri:image")[1].Text, /\.icp\.net\/nft\/0\.svg$/);
    assert.equal(metadata.find(([k]) => k === "icrc7:image")[1].Text, metadata.find(([k]) => k === "icrc7:metadata:uri:image")[1].Text);
    const logoUrl = `https://${f.nftId.toText()}.icp.net/logo.svg`;
    assert.deepEqual(await f.nft.icrc7_logo(), [logoUrl]);
    assert.equal((await f.nft.icrc7_collection_metadata()).find(([k]) => k === "icrc7:logo")[1].Text, logoUrl);
    const logo = await f.nft.http_request({ method: "GET", url: "/logo.svg", headers: [], body: new Uint8Array() });
    assert.equal(logo.status_code, 200);
    assert.match(new TextDecoder().decode(logo.body), /^<svg [^>]*viewBox="0 0 32 32"/);
    const tip = await f.nft.icrc3_get_tip_certificate();
    assert.equal(tip.length, 1);
    assert.ok(tip[0].certificate.length);
  } finally { await f.pic.tearDown(); }
});

test("failed mint is paid and recoverable with the same seed and mint key", async () => {
  const f = await fixture();
  try {
    let purchase = await createPaw(f);
    await setBackend(f, buyer);
    purchase = await status(f, purchase, { ok: true, result: invoice("0123456789abcdef01234567", purchase.id, "paid_over") });
    assert.ok("paid" in purchase.fulfillment);
    const frozen = purchase.seed[0];
    assert.ok(purchase.lastError.length);
    await setBackend(f, f.backendId);
    purchase = (await f.backend.refreshPurchase(purchase.id)).ok;
    assert.ok("minted" in purchase.fulfillment);
    assert.deepEqual(purchase.seed[0], frozen);
    assert.equal(await f.nft.icrc7_total_supply(), 1n);
  } finally { await f.pic.tearDown(); }
});

test("uncertain creation is reconciled without a second POST and cannot mint from a list", async () => {
  const f = await fixture();
  try {
    await f.backend.configurePaw("test-live-key", "usdc_eth", "", false);
    const submitted = await f.deferred.createPurchase(150n);
    await answer(f.pic, { ok: false }, 503);
    assert.ok("err" in await submitted());
    let [purchase] = await f.backend.getMyPurchases();
    assert.ok("review" in purchase.fulfillment);
    const reconcile = await f.deferred.refreshPurchase(purchase.id);
    const discovery = await answer(f.pic, { ok: true, result: [invoice("0123456789abcdef01234567", purchase.id, "success")] });
    assert.equal(discovery.httpMethod, "GET");
    assert.match(discovery.url, /invoices\?date_from=/);
    assert.equal(await f.nft.icrc7_total_supply(), 0n);
    purchase = (await reconcile()).ok;
    assert.equal(purchase.invoiceId[0], "0123456789abcdef01234567");
    assert.equal(purchase.checkoutUrl.length, 0);
    purchase = await status(f, purchase, { ok: true, result: invoice("0123456789abcdef01234567", purchase.id, "success") });
    assert.ok("minted" in purchase.fulfillment);
    assert.equal(await f.nft.icrc7_total_supply(), 1n);
  } finally { await f.pic.tearDown(); }
});

test("sandbox key routing works without a webhook-only marker; wrong markers fail closed", async () => {
  const f = await fixture();
  try {
    assert.ok("err" in await f.backend.configurePaw("sk_sandbox_test", "usdc_eth", "", false));
    assert.ok("ok" in await f.backend.configurePaw("sk_sandbox_test", "usdc_eth", "", true));
    const submitted = await f.deferred.createPurchase(150n);
    await answer(f.pic, { ok: true, result: invoice("0123456789abcdef01234567", "bonsai-1", "created") });
    let purchase = (await submitted()).ok;
    assert.equal(purchase.sandbox, true);
    assert.ok("err" in await f.backend.configurePaw("live-key", "usdc_eth", "", false));
    purchase = await status(f, purchase, { ok: true, result: invoice("0123456789abcdef01234567", purchase.id, "success", { sandbox: false }) });
    assert.equal(await f.nft.icrc7_total_supply(), 0n);
    purchase = await status(f, purchase, { ok: true, result: invoice("0123456789abcdef01234567", purchase.id, "success") });
    assert.ok("minted" in purchase.fulfillment);
  } finally { await f.pic.tearDown(); }
});

test("only owner can close dashboard-reconciled unknown creations and release capacity", async () => {
  const f = await fixture();
  try {
    await f.backend.configurePaw("test-live-key", "usdc_eth", "", false);
    const submitted = await f.deferred.createPurchase(150n);
    await answer(f.pic, { ok: false }, 503);
    await submitted();
    const [purchase] = await f.backend.getMyPurchases();
    f.backend.setPrincipal(buyer);
    assert.deepEqual(await f.backend.closeUnknownPurchase(purchase.id, "Dashboard ticket confirms no invoice"), { err: { forbidden: null } });
    f.backend.setPrincipal(owner);
    assert.ok("err" in await f.backend.closeUnknownPurchase(purchase.id, "short"));
    assert.ok("ok" in await f.backend.closeUnknownPurchase(purchase.id, "Dashboard ticket confirms no invoice"));
    assert.equal((await f.backend.paymentInfo()).pending, 0n);
    assert.ok("closed" in (await f.backend.getMyPurchases())[0].fulfillment);
    assert.equal(await f.nft.icrc7_total_supply(), 0n);
  } finally { await f.pic.tearDown(); }
});

test("anonymous/invalid/rapid purchases fail and timer round-robin serves beyond ten pending", async () => {
  const f = await fixture({ mock: true });
  try {
    f.backend.setPrincipal(Principal.anonymous());
    assert.deepEqual(await f.backend.createPurchase(150n), { err: { unauthorized: null } });
    f.backend.setPrincipal(owner);
    for (const amount of [5n, 48n, 1000n]) assert.ok("err" in await f.backend.createPurchase(amount));
    assert.ok("ok" in await f.backend.createPurchase(150n));
    assert.ok("err" in await f.backend.createPurchase(150n));
    for (let n = 3; n < 15; n++) {
      f.backend.setPrincipal(Principal.selfAuthenticating(Uint8Array.of(n)));
      assert.ok("ok" in await f.backend.createPurchase(150n));
    }
    await f.pic.advanceTime(35_000);
    await f.pic.tick(70);
    assert.equal(await f.nft.icrc7_total_supply(), 10n);
    await f.pic.advanceTime(35_000);
    await f.pic.tick(40);
    assert.equal(await f.nft.icrc7_total_supply(), 13n);
  } finally { await f.pic.tearDown(); }
});

test("wrong identity/amount, unknown status and HTTP errors cannot authorize mint", async () => {
  const f = await fixture();
  try {
    let purchase = await createPaw(f);
    for (const overrides of [{ initial_fiat_amount: 28 }, { fiat_currency: "USD" }, { extra: "other" }, { sandbox: true }, { status: "new-provider-status" }]) {
      purchase = await status(f, purchase, { ok: true, result: invoice("0123456789abcdef01234567", purchase.id, "success", overrides) });
      assert.equal(await f.nft.icrc7_total_supply(), 0n);
      assert.ok(purchase.lastError.length);
    }
    const pending = await f.deferred.refreshPurchase(purchase.id);
    await answer(f.pic, { ok: false, error: { message: "private provider body" } }, 401);
    purchase = (await pending()).ok;
    assert.match(purchase.lastError[0], /HTTP 401/);
    assert.doesNotMatch(purchase.lastError[0], /private/);
    assert.equal(await f.nft.icrc7_total_supply(), 0n);
  } finally { await f.pic.tearDown(); }
});

test("NFT mint replay is idempotent after transfer and conflicting replays fail", async () => {
  const f = await fixture({ mock: true });
  try {
    await setBackend(f, owner);
    const first = await f.nft.mintV2(owner, seed("idempotency"), 2n, "test-key");
    assert.ok("ok" in first);
    const transfer = await f.nft.icrc7_transfer([{ token_id: first.ok, to: { owner: buyer, subaccount: [] }, from_subaccount: [], memo: [], created_at_time: [] }]);
    assert.ok("Ok" in transfer[0][0]);
    assert.deepEqual(await f.nft.mintV2(owner, seed("idempotency"), 2n, "test-key"), first);
    assert.ok("err" in await f.nft.mintV2(buyer, seed("idempotency"), 2n, "test-key"));
    assert.equal(await f.nft.icrc7_total_supply(), 1n);
    assert.equal((await f.nft.getNft(first.ok))[0].owner.toText(), buyer.toText());
    const originalArt = await f.nft.getArtwork(first.ok);
    const distinct = await f.nft.mintV2(owner, seed("idempotency"), 2n, "another-key");
    assert.ok("ok" in distinct);
    const [alternative] = await f.nft.getArtwork(distinct.ok);
    assert.equal(alternative.attempt, 1n);
    assert.notDeepEqual(alternative.silhouetteHash, originalArt[0].silhouetteHash);
    assert.notDeepEqual(alternative.pixelHash, originalArt[0].pixelHash);
    await f.pic.upgradeCanister({ sender: owner, canisterId: f.nftId, wasm: wasm("icrc7"), arg: emptyArgs, upgradeModeOptions });
    assert.deepEqual(await f.nft.getArtwork(first.ok), originalArt);
    assert.deepEqual(await f.nft.mintV2(owner, seed("idempotency"), 2n, "test-key"), first);
    assert.equal(await f.nft.icrc7_total_supply(), 2n);
  } finally { await f.pic.tearDown(); }
});

test("migration-chain upgrade preserves purchases, artwork, approvals and certified history", async () => {
  const f = await fixture({ mock: true });
  try {
    const purchase = (await f.backend.createPurchase(150n)).ok;
    await f.pic.advanceTime(35_000);
    await f.pic.tick(12);
    const [minted] = await f.backend.getMyPurchases();
    assert.equal(minted.id, purchase.id);
    assert.ok("minted" in minted.fulfillment);
    const id = minted.nftId[0];
    await f.nft.icrc37_approve_tokens([{
      token_id: id,
      approval_info: { spender: { owner: buyer, subaccount: [] }, from_subaccount: [], expires_at: [], memo: [], created_at_time: [] },
    }]);
    const approvals = await f.nft.icrc37_get_token_approvals(id, [], []);
    const history = await f.nft.icrc3_get_blocks([{ start: 0n, length: 10n }]);
    const original = await f.nft.getArtwork(id);
    await f.pic.upgradeCanister({ sender: owner, canisterId: f.nftId, wasm: wasm("icrc7"), arg: emptyArgs, upgradeModeOptions });
    await f.pic.upgradeCanister({ sender: owner, canisterId: f.backendId, wasm: wasm("backend"), arg: emptyArgs, upgradeModeOptions });
    assert.deepEqual(await f.backend.getMyPurchases(), [minted]);
    assert.equal(await f.nft.icrc7_total_supply(), 1n);
    assert.deepEqual(await f.nft.getArtwork(id), original);
    assert.deepEqual(await f.nft.getMintByKey("mock:" + purchase.id), [id]);
    assert.deepEqual(await f.nft.icrc37_get_token_approvals(id, [], []), approvals);
    assert.deepEqual(await f.nft.icrc3_get_blocks([{ start: 0n, length: 10n }]), history);
  } finally { await f.pic.tearDown(); }
});

test("mock pending purchase survives upgrade and is eventually minted", async () => {
  const f = await fixture({ mock: true });
  try {
    const purchase = (await f.backend.createPurchase(150n)).ok;
    await f.pic.upgradeCanister({ sender: owner, canisterId: f.backendId, wasm: wasm("backend"), arg: emptyArgs, upgradeModeOptions });
    await f.pic.advanceTime(35_000);
    await f.pic.tick(12);
    const [restored] = await f.backend.getMyPurchases();
    assert.equal(restored.id, purchase.id);
    assert.ok("minted" in restored.fulfillment);
    assert.equal(await f.nft.icrc7_total_supply(), 1n);
  } finally { await f.pic.tearDown(); }
});

test("idle backend stops its payment poll timer and resumes for new purchases", async () => {
  const f = await fixture({ mock: true });
  const idleBurn = async () => {
    const before = await f.pic.getCyclesBalance(f.backendId);
    for (let i = 0; i < 20; i++) {
      await f.pic.advanceTime(31_000);
      await f.pic.tick(2);
    }
    return before - await f.pic.getCyclesBalance(f.backendId);
  };
  try {
    // Twenty 30-second polls would cost at least 20 * 5M cycles in execution fees alone.
    assert.ok(await idleBurn() < 50_000_000);
    await f.backend.createPurchase(150n);
    await f.pic.advanceTime(35_000);
    await f.pic.tick(12);
    const [purchase] = await f.backend.getMyPurchases();
    assert.ok("minted" in purchase.fulfillment);
    await f.pic.advanceTime(31_000);
    await f.pic.tick(2);
    assert.ok(await idleBurn() < 50_000_000);
  } finally { await f.pic.tearDown(); }
});

test("verifying gateway accepts images, 404 and 405; ICRC-3 witness authenticates the tip", async () => {
  const f = await fixture({ mock: true, gateway: true });
  try {
    await setBackend(f, owner);
    const id = (await f.nft.mintV2(owner, seed("certification"), 2n, "certified")).ok;
    const port = await f.pic.makeLive();
    const host = `http://localhost:${port}`;
    for (const [path, method, expected] of [
      [`/nft/${id}.svg`, "GET", 200],
      ["/logo.svg", "GET", 200],
      ["/logo.svg", "POST", 405],
      ["/logo.svg/x", "GET", 404],
      ["/logo", "GET", 404],
      ["/nft/123.svg", "GET", 404],
      ["/unknown/path", "GET", 404],
      ["/nft/00.svg", "GET", 404],
      ["/", "GET", 404],
      [`/nft/${id}.svg`, "POST", 405],
      ["/unknown", "POST", 405],
    ]) {
      const response = await fetch(`${host}${path}?canisterId=${f.nftId.toText()}`, { method });
      const body = await response.text();
      assert.equal(response.status, expected, `${method} ${path}: ${body}`);
      assert.doesNotMatch(body, /backend_response_verification/);
      assert.match(response.headers.get("ic-certificate"), /version=2/);
    }
    const agent = await HttpAgent.create({ host, shouldFetchRootKey: true });
    const [tip] = await f.nft.icrc3_get_tip_certificate();
    const certificate = await Certificate.create({
      certificate: tip.certificate, rootKey: agent.rootKey, principal: { canisterId: f.nftId },
    });
    const certified = certificate.lookup_path(["canister", f.nftId.toUint8Array(), "certified_data"]);
    assert.equal(certified.status, LookupPathStatus.Found);
    const tree = Cbor.decode(tip.hash_tree);
    assert.deepEqual(new Uint8Array(await reconstruct(tree)), new Uint8Array(certified.value));
    const index = lookup_path(["last_block_index"], tree);
    const hash = lookup_path(["last_block_hash"], tree);
    assert.equal(index.status, LookupPathStatus.Found);
    assert.deepEqual([...index.value], [0]);
    assert.equal(hash.status, LookupPathStatus.Found);
    assert.equal(hash.value.byteLength, 32);
    await f.pic.stopLive();
  } finally { await f.pic.tearDown(); }
});

// Everyday runs sweep 1,000 seeds; `npm run test:art:full` (ART_SAMPLES=10000) runs the full sweep after art changes.
const ART_SAMPLES = Number(process.env.ART_SAMPLES || 1000);

test(`${ART_SAMPLES} seeded trees: unique silhouettes and pixels, attached geometry, all styles/tiers`, { timeout: 600_000 }, async () => {
  assert.ok(Number.isInteger(ART_SAMPLES) && ART_SAMPLES >= 200 && ART_SAMPLES % 20 === 0, "ART_SAMPLES must be a multiple of 20, at least 200");
  const pic = await PocketIc.create(server.getUrl());
  const factory = ({ IDL }) => IDL.Service({
    batch: IDL.Func([IDL.Nat, IDL.Nat], [IDL.Vec(IDL.Record({ shape: IDL.Vec(IDL.Nat8), pixels: IDL.Vec(IDL.Nat8), valid: IDL.Bool, style: IDL.Nat, tier: IDL.Nat, svg: IDL.Text }))], ["query"]),
  });
  try {
    const { actor } = await pic.setupCanister({ sender: owner, wasm: wasm("art-tests"), idlFactory: factory });
    const shapes = new Set();
    const pixels = new Set();
    const coverage = new Map();
    for (let start = 0; start < ART_SAMPLES; start += 20) {
      const samples = await actor.batch(BigInt(start), 20n);
      for (const sample of samples) {
        assert.ok(sample.valid);
        const shape = digest(sample.shape);
        const pixel = Buffer.from(sample.pixels).toString("hex");
        if (sample.svg) assert.equal(rgbHash(sample.svg), pixel, "RGB provenance differs from rendered SVG");
        assert.ok(!shapes.has(shape), `duplicate shape at ${start}`);
        assert.ok(!pixels.has(pixel), `duplicate pixels at ${start}`);
        shapes.add(shape);
        pixels.add(pixel);
        const occupied = [...sample.shape].reduce((a, b) => a + b, 0);
        assert.ok(occupied >= 180 && occupied <= 1800, `bad canopy occupancy ${occupied}`);
        // Flood-fill proves every occupied tree cell belongs to the same planted tree.
        const visited = new Set();
        const queue = [sample.shape.indexOf(1)];
        for (let q = 0; q < queue.length; q++) {
          const index = queue[q];
          if (visited.has(index)) continue;
          visited.add(index);
          const x = index % 64;
          for (const next of [index - 64, index + 64, ...(x ? [index - 1] : []), ...(x < 63 ? [index + 1] : [])]) {
            if (next >= 0 && next < 4096 && sample.shape[next] && !visited.has(next)) queue.push(next);
          }
        }
        assert.equal(visited.size, occupied, "detached tree pixels");
        const key = `${sample.style}-${sample.tier}`;
        if (sample.svg && !coverage.has(key)) coverage.set(key, sample.svg);
      }
    }
    assert.equal(shapes.size, ART_SAMPLES);
    assert.equal(pixels.size, ART_SAMPLES);
    assert.equal(coverage.size, 25);
    if (process.env.ART_OUTPUT_DIR) {
      await mkdir(process.env.ART_OUTPUT_DIR, { recursive: true });
      let sheet = '<svg xmlns="http://www.w3.org/2000/svg" width="1000" height="1000" viewBox="0 0 320 320">';
      for (let tier = 0; tier < 5; tier++) for (let style = 0; style < 5; style++) {
        const svg = coverage.get(`${style}-${tier}`);
        sheet += `<g transform="translate(${style * 64},${tier * 64})">${svg.replace('<svg ', '<svg width="64" height="64" ')}</g>`;
      }
      await writeFile(resolve(process.env.ART_OUTPUT_DIR, "bonsai-contact-sheet.svg"), sheet + "</svg>");
    }
  } finally { await pic.tearDown(); }
});
