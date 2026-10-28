import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { test } from "node:test";
import { chromium } from "playwright";
import { Principal } from "@icp-sdk/core/principal";
import { createAuthContext, signInWithPasskey } from "./identity.mjs";

const origin = process.env.COLLECTION_TEST_ORIGIN ?? "http://localhost:5173";
const creator = Principal.selfAuthenticating(Uint8Array.of(1)).toText();
const owner = Principal.selfAuthenticating(Uint8Array.of(2)).toText();

async function fixture(page, count = 4) {
  await page.route("**/src/components/AuthProvider.tsx*", (route) => route.fulfill({
    contentType: "application/javascript",
    body: `
      const identity = {};
      export function AuthProvider({children}) { return children; }
      export function useAuthContext() {
        return { isAuthenticated: true, identity, principal: globalThis.marketBuyer ? "${creator}" : "${owner}", signIn() {}, signOut() {} };
      }
    `,
  }));
  await page.route("**/src/lib/actors.ts*", (route) => route.fulfill({
    contentType: "application/javascript",
    body: `
      const owner = { toText: () => "${owner}" };
      const creator = { toText: () => "${creator}" };
      const nfts = Array.from({length: ${count}}, (_, i) => ({
        id: BigInt(i), owner, paymentId: "mock:bonsai-" + i, createdAt: 1793174400000000000n,
        traits: { trunkStyle: i % 5, leafColor: i % 8, branchCount: 4 }
      }));
      globalThis.mintRequests = [];
      let sale = null;
      const makeListing = (nftId, price) => ({
        id: 1n, nftId, seller: owner, buyer: undefined, currency: "icp", ledger: owner,
        price, revision: 1n, phase: "active", fee: 10000n, appFee: price * 2n / 100n,
        proceeds: price - price * 2n / 100n - 10000n, createdAt: 0n, updatedAt: 0n
      });

      if (globalThis.marketBuyer) sale = makeListing(0n, 2500000000n);
      export function artLabId() { return undefined; }
      export function artLabActor() { throw new Error("Art lab is outside this fixture"); }
      export async function backendActor() {
        return {
          marketPolicy: async () => ({feeBps: 200n, maxMultiple: 2n, token: {ledger: owner}}),
          marketListings: async (ids) => ids.map(id => sale?.nftId === id ? sale : null),
          mintReferences: async (keys) => keys.map(() => ({icp: 1900000000n, token: 1900000000000n})),
          myMarketActivity: async () => sale ? [sale] : [],
          listBonsai: async (id, currency, price) => { sale = {...makeListing(id,price),currency}; return {__kind__: "ok", ok:sale}; },
          cancelListing: async () => { sale = {...sale,phase:"cancelled"}; return {__kind__:"ok",ok:sale}; },
          marketQuote: async () => ({__kind__:"ok",ok: {
            listing: sale, approvalFee: 10000n, paymentFee:10000n, payoutFee:10000n,
            totalDebit:sale.price + 20000n, sellerReceives:sale.proceeds
          }}),
          buyBonsai: async () => { sale = {...sale,buyer:creator,phase:"sold"}; nfts[Number(sale.nftId)].owner=creator; return {__kind__:"ok",ok:sale}; },
          getMintDetails: async (keys) => {
          globalThis.mintRequests.push(keys.length);
          if (globalThis.failMintDetails) throw new Error("Mint details test outage");
          return keys.map((key) => {
            const id = BigInt(key.split("-").at(-1));
            if (id % 4n === 3n) return null;
            const prices = [
              {__kind__: "icp", icp: 1900000000n},
              {__kind__: "token", token: 4900000000000n},
              {__kind__: "eur", eur: 150n}
            ];
            return { nftId: id, creator, price: prices[Number(id % 4n)],
              artTier: 1n, lucky: id === 0n, testMint: id === 2n };
          });
        }};
      }
      export async function icrc7Actor() {
        return {
          listPage: async (before, limit) => nfts.slice(before === null ? 0 : Number(before) + 1,
            (before === null ? 0 : Number(before) + 1) + Number(limit)),
          icrc7_tokens_of: async (_account, before, limit) => nfts.slice(before === null ? 0 : Number(before) + 1,
            (before === null ? 0 : Number(before) + 1) + Number(limit)).map(nft => nft.id),
          getNft: async (id) => nfts[Number(id)],
          icrc7_owner_of: async (ids) => ids.map(id => ({owner: nfts[Number(id)].owner})),
          icrc7_transfer: async (args) => { nfts[Number(args[0].token_id)].owner = args[0].to.owner; return [{__kind__:"Ok", Ok:1n}]; },
          icrc7_token_metadata: async (ids) => ids.map(id => id % 4n === 3n ? null :
            [["bonsai:generation_version", {__kind__: "Nat", Nat: id % 4n === 1n ? 7n : 8n}]])
        };
      }
    `,
  }));
  await page.route("**/nft/*.svg", (route) => route.fulfill({
    contentType: "image/svg+xml",
    body: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect width="64" height="64" fill="#23543a"/></svg>',
  }));
}

async function assertNoOverflow(page) {
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
    "collection must not overflow the viewport");
  assert.ok(await page.locator("article").evaluateAll((cards) => cards.every((card) =>
    card.scrollWidth <= card.clientWidth)), "card content must not overflow");
}

test("compact cards open accessible modals with full provenance, prices, timestamps and version-aware facts", async () => {
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage({ viewport: { width: 1440, height: 1100 }, timezoneId: "Europe/Paris" });
    const errors = [];
    page.on("pageerror", (e) => errors.push(e.message));
    await fixture(page);
    for (const path of ["/gallery", "/my-nfts"]) {
      await page.goto(new URL(path, origin).href);
      const cards = page.locator("article");
      await cards.first().getByText("19 ICP", { exact: true }).waitFor();
      assert.equal(await cards.count(), 4);
      assert.match(await cards.nth(1).innerText(), /49,000 \$BONSAI/);
      assert.match(await cards.nth(2).innerText(), /Mint price \(test\)[\s\S]*150 EUR/);
      assert.equal(await cards.nth(3).getByText("Not recorded", { exact: true }).count(), 1);
      assert.doesNotMatch(await cards.first().innerText(), /Creator|Current owner|7 x 7/);
      assert.equal(await cards.first().getByText("Lucky bloom", { exact: false }).count(), 1);
      assert.equal(await cards.nth(1).getByText("Lucky bloom", { exact: false }).count(), 0);
      assert.equal(await page.locator("main ul.grid").evaluate((ul) => getComputedStyle(ul).gridTemplateColumns.split(" ").length), 3);
      await assertNoOverflow(page);
      const trigger = cards.first().getByRole("button", { name: "Details", exact: true });
      await trigger.click();
      const modal = page.getByRole("dialog", { name: "Bonsai #0", exact: true });
      await modal.waitFor();
      assert.equal(await modal.getByText("Lucky bloom", { exact: true }).count(), 1);
      assert.match(await modal.innerText(), /7 x 7 stamp/);
      await modal.getByRole("heading", { name: "The pot's secret signature", exact: true }).waitFor();
      assert.equal(await modal.locator("time").getAttribute("datetime"), "2026-10-28T08:00:00.000Z");
      assert.match(await modal.locator("time").innerText(), /09:00:00/);
      for (let tab = 0; tab < 8; tab++) {
        await page.keyboard.press("Tab");
        assert.ok(await modal.evaluate((dialog) =>
          dialog.contains(document.activeElement) || document.activeElement === document.body),
        "keyboard focus cannot reach background controls");
      }
      for (const width of [768, 390, 320]) {
        await page.setViewportSize({ width, height: 1000 });
        await assertNoOverflow(page);
        assert.ok(await modal.evaluate((dialog) => dialog.scrollWidth <= dialog.clientWidth), "modal content fits narrow screens");
      }
      const identities = modal.locator("details");
      await identities.nth(0).locator("summary").click();
      await identities.nth(1).locator("summary").click();
      assert.equal(await identities.nth(0).locator("p").innerText(), creator);
      assert.equal(await identities.nth(1).locator("p").innerText(), owner);
      await assertNoOverflow(page);
      await page.keyboard.press("Escape");
      await page.waitForFunction(() => document.querySelector("dialog") === null);
      assert.equal(await page.getByRole("dialog").count(), 0);
      assert.ok(await trigger.evaluate((button) => document.activeElement === button), "focus returns to the card");
      for (const name of ["View details for Bonsai #0", "Bonsai #0"]) {
        const opener = cards.first().getByRole("button", { name, exact: true });
        await opener.focus();
        await page.keyboard.press("Enter");
        await modal.waitFor();
        await page.keyboard.press("Escape");
        await page.waitForFunction(() => document.querySelector("dialog") === null);
        assert.ok(await opener.evaluate((button) => document.activeElement === button), "focus returns to the image or name");
      }
      for (const index of [1, 3]) {
        await cards.nth(index).getByRole("button", { name: "Details", exact: true }).click();
        const legacy = page.getByRole("dialog");
        await legacy.waitFor();
        assert.doesNotMatch(await legacy.innerText(), /7 x 7 stamp/);
        if (index === 3) assert.equal(await legacy.getByText("Not recorded", { exact: true }).count(), 2);
        await legacy.getByRole("button", { name: "Close details" }).click();
      }
      await trigger.click();
      await page.mouse.click(5, 5);
      assert.equal(await page.getByRole("dialog").count(), 0, "backdrop click closes the modal");
      await page.setViewportSize({ width: 1440, height: 1100 });
    }
    assert.deepEqual(errors, []);
  } finally { await browser.close(); }
});

test("detail failures stay explicit and retryable; both pages batch large collections and preserve pagination", async () => {
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage();
    await fixture(page, 101);
    await page.addInitScript(() => { globalThis.failMintDetails = true; });
    await page.goto(new URL("/gallery", origin).href);
    await page.getByRole("alert").filter({ hasText: "Mint details test outage" }).waitFor();
    assert.equal(await page.locator("article").count(), 60);
    assert.equal(await page.locator("article").first().getByText("Unavailable", { exact: true }).count(), 1);
    await page.evaluate(() => { globalThis.failMintDetails = false; });
    await page.getByRole("button", { name: "Retry details" }).click();
    await page.locator("article").first().getByText("19 ICP", { exact: true }).waitFor();
    assert.equal(await page.getByRole("alert").count(), 0);
    await page.getByRole("button", { name: "Load more bonsai" }).click();
    await page.getByRole("heading", { name: "Bonsai #100", exact: true }).waitFor();
    await page.locator("article").last().getByText("19 ICP", { exact: true }).waitFor();
    assert.equal(await page.locator("article").count(), 101);
    assert.equal(await page.getByRole("button", { name: "Load more bonsai" }).count(), 0);
    const galleryRequests = await page.evaluate(() => globalThis.mintRequests);
    assert.deepEqual(galleryRequests.slice(-2), [100, 1]);
    assert.ok(galleryRequests.slice(0, -2).every((count) => count === 60), "initial and retry requests are batched");
    await page.goto(new URL("/my-nfts", origin).href);
    await page.getByRole("alert").filter({ hasText: "Mint details test outage" }).waitFor();
    await page.evaluate(() => { globalThis.failMintDetails = false; });
    await page.getByRole("button", { name: "Retry details" }).click();
    await page.locator("article").last().getByText("19 ICP", { exact: true }).waitFor();
    assert.equal(await page.locator("article").count(), 101);
    const myRequests = await page.evaluate(() => globalThis.mintRequests);
    assert.deepEqual(myRequests.slice(-2), [100, 1]);
    assert.ok(myRequests.slice(0, -2).every((count) => count === 100), "initial and retry requests are batched");
  } finally { await browser.close(); }
});

test("owners list, cancel and send; buyers review exact prices and purchase from listed cards", async () => {
  const browser = await chromium.launch();
  try {
    for (const buyer of [false, true]) {
      const page = await browser.newPage({ viewport: { width: 390, height: 900 } });
      await fixture(page);
      if (buyer) await page.addInitScript(() => { globalThis.marketBuyer = true; });
      await page.route((url) => url.pathname === "/src/lib/ledger.ts" && !url.searchParams.has("market-actual"), (route) => route.fulfill({
        contentType: "application/javascript",
        body: `export * from "/src/lib/ledger.ts?market-actual"; export async function approveMarket() { return 1n; } export async function marketLedgerFee() { return 10000n; } export async function tokenBalance() { return globalThis.marketPoor ? 250000000n : 10000000000n; }`,
      }));
      await page.goto(new URL("/gallery", origin).href);
      const card = page.locator("article").first();
      if (buyer) {
        await card.getByText("For sale").waitFor();
        assert.ok(await card.getByRole("button", { name: "Details & Buy", exact: true }).evaluate((button) => button.getBoundingClientRect().width >= 120));
      }
      assert.equal(await card.locator("details").count(), 0, "card owner is a plain short principal");
      await card.getByRole("button", { name: buyer ? "Details & Buy" : "Details", exact: true }).click();
      const modal = page.getByRole("dialog");
      if (buyer) {
        assert.equal(await modal.getByRole("tab").count(), 0, "listed bonsai hides trade and send tabs");
        await page.evaluate(() => { globalThis.marketPoor = true; });
        await modal.getByRole("button", { name: "Review purchase", exact: true }).click();
        await modal.getByRole("alert").filter({ hasText: "Not enough funds" }).waitFor();
        assert.ok(await modal.getByRole("button", { name: "Approve & buy bonsai", exact: true }).isDisabled());
        await modal.getByRole("button", { name: "Back", exact: true }).click();
        await page.evaluate(() => { globalThis.marketPoor = false; });
        await modal.getByRole("button", { name: "Review purchase", exact: true }).click();
        await modal.getByText("25.0002 ICP", { exact: true }).waitFor();
        assert.equal(await modal.getByRole("button", { name: "Cancel listing", exact: true }).count(), 0);
        await modal.getByRole("button", { name: "Approve & buy bonsai", exact: true }).click();
        await modal.getByText("Sale complete", { exact: true }).waitFor();
      } else {
        assert.equal(await modal.getByLabel("Asking price").count(), 0, "info tab is shown first");
        await modal.getByRole("tab", { name: "Trade", exact: true }).click();
        await modal.getByLabel("Asking price").fill("39");
        await modal.getByRole("button", { name: "Review listing", exact: true }).click();
        await modal.getByRole("alert").filter({ hasText: "2x" }).waitFor();
        await modal.getByLabel("Asking price").fill("25");
        await modal.getByRole("button", { name: "Review listing", exact: true }).click();
        await modal.getByRole("button", { name: "Confirm listing", exact: true }).click();
        await modal.getByRole("button", { name: "Cancel listing", exact: true }).waitFor();
        assert.equal(await modal.getByLabel("Send to principal").count(), 0);
        assert.equal(await modal.getByRole("tab").count(), 0);
        await modal.getByRole("button", { name: "Cancel listing", exact: true }).click();
        await modal.getByRole("tab", { name: "Send", exact: true }).click();
        await modal.getByLabel("Send to principal").fill("not-a-principal");
        await modal.getByRole("button", { name: "Review transfer", exact: true }).click();
        assert.equal(await modal.getByRole("button", { name: "Confirm send bonsai", exact: true }).count(), 0);
        await modal.getByLabel("Send to principal").fill(creator);
        await modal.getByRole("button", { name: "Review transfer", exact: true }).click();
        await modal.getByRole("button", { name: "Confirm send bonsai", exact: true }).click();
        await modal.getByText("Bonsai sent successfully", { exact: true }).waitFor();
      }
      assert.ok(await modal.evaluate((dialog) => dialog.scrollWidth <= dialog.clientWidth));
      await page.close();
    }
  } finally { await browser.close(); }
});

test("real local minted cards render in both collections on desktop and mobile", {
  skip: !process.env.COLLECTION_LIVE_ORIGIN,
  timeout: 120_000,
}, async () => {
  const liveOrigin = process.env.COLLECTION_LIVE_ORIGIN;
  const hostname = new URL(liveOrigin).hostname;
  assert.ok(hostname === "localhost" || hostname.endsWith(".localhost"), "live mint test is local-only");
  const browser = await chromium.launch();
  try {
    const context = await createAuthContext(browser);
    const page = await context.newPage();
    const errors = [];
    page.on("pageerror", (e) => errors.push(e.message));
    await page.goto(new URL("/mint", liveOrigin).href);
    await signInWithPasskey(page, { name: "Bonsai collection cards" });
    await page.getByTestId("pay-card").click();
    await page.getByRole("button", { name: "Pay €99 by card", exact: true }).click();
    await page.getByRole("heading", { name: /^Your bonsai #/ }).waitFor({ timeout: 60_000 });
    const screenshotDir = process.env.COLLECTION_SCREENSHOT_DIR;
    if (screenshotDir) await mkdir(screenshotDir, { recursive: true });
    for (const [name, path] of [["my-bonsai", "/my-nfts"], ["gallery", "/gallery"]]) {
      await page.goto(new URL(path, liveOrigin).href);
      const first = page.locator("article").first();
      await first.getByText("99 EUR", { exact: true }).waitFor();
      await page.waitForFunction(() => [...document.querySelectorAll("article img")].every((img) =>
        img.complete && img.naturalWidth > 0));
      for (const [device, width, height] of [["desktop", 1440, 1100], ["mobile", 390, 1100]]) {
        await page.setViewportSize({ width, height });
        await assertNoOverflow(page);
        if (screenshotDir) await page.screenshot({ path: join(screenshotDir, `${name}-${device}.png`) });
        await first.getByRole("button", { name: "Details", exact: true }).click();
        const modal = page.getByRole("dialog");
        await modal.getByText(/7 x 7 stamp/).waitFor();
        await modal.locator("img").evaluate((img) => img.decode());
        if (screenshotDir && name === "gallery") {
          await page.screenshot({ path: join(screenshotDir, `details-${device}.png`) });
        }
        await page.keyboard.press("Escape");
      }
    }
    assert.deepEqual(errors, []);
    await context.close();
  } finally { await browser.close(); }
});
