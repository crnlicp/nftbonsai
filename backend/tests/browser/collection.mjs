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
      const likes = new Map();
      const who = () => globalThis.marketBuyer ? "${creator}" : "${owner}";
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
          likeStats: async (ids) => ids.map(id => {
            const set = likes.get(id) ?? new Set();
            return { count: BigInt(set.size + (id === 1n ? 41 : 0)), liked: set.has(who()) };
          }),
          setLike: async (id, liked) => {
            globalThis.likeCalls = (globalThis.likeCalls ?? 0) + 1;
            await new Promise((r) => setTimeout(r, 150));
            if (globalThis.failLike) return { __kind__: "err", err: "Like test outage" };
            const set = likes.get(id) ?? new Set();
            liked ? set.add(who()) : set.delete(who());
            likes.set(id, set);
            return { __kind__: "ok", ok: { count: BigInt(set.size + (id === 1n ? 41 : 0)), liked } };
          },
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
          icrc7_total_supply: async () => BigInt(nfts.length),
          icrc7_balance_of: async (accounts) => accounts.map(() => BigInt(nfts.length)),
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
      await page.waitForFunction(() => document.querySelector("dialog[aria-labelledby^=bonsai-details]") === null);
      assert.equal(await page.getByRole("dialog").count(), 0);
      assert.ok(await trigger.evaluate((button) => document.activeElement === button), "focus returns to the card");
      for (const name of ["View details for Bonsai #0", "Bonsai #0"]) {
        const opener = cards.first().getByRole("button", { name, exact: true });
        await opener.focus();
        await page.keyboard.press("Enter");
        await modal.waitFor();
        await page.keyboard.press("Escape");
        await page.waitForFunction(() => document.querySelector("dialog[aria-labelledby^=bonsai-details]") === null);
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

async function scrollUntil(page, count) {
  for (let attempt = 0; attempt < 40 && await page.locator("article").count() < count; attempt++) {
    await page.mouse.wheel(0, 20000);
    await page.waitForTimeout(150);
  }
  assert.equal(await page.locator("article").count(), count);
}

test("header stays pinned while scrolling and mobile navigation opens as a sidebar", async () => {
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage({ viewport: { width: 1280, height: 700 } });
    const errors = [];
    page.on("pageerror", (e) => errors.push(e.message));
    await fixture(page, 12);
    await page.goto(new URL("/gallery", origin).href);
    await page.locator("article").first().waitFor();
    const header = page.getByRole("navigation", { name: "Main" });
    const menuButton = page.getByRole("button", { name: "Open menu" });
    assert.equal(await menuButton.isVisible(), false, "desktop keeps inline links");
    for (const width of [1280, 390, 320]) {
      await page.setViewportSize({ width, height: 700 });
      await page.evaluate(() => window.scrollTo(0, 1200));
      await page.waitForFunction(() => window.scrollY > 0);
      const box = await header.boundingBox();
      assert.ok(box.y >= 0 && box.y < 24, `header pinned at ${width}px (y=${box.y})`);
      await assertNoOverflow(page);
    }
    const drawer = page.getByRole("dialog", { name: "Menu" });
    assert.equal(await drawer.isVisible(), false);
    await menuButton.click();
    await drawer.waitFor();
    await drawer.evaluate((el) => Promise.all(el.getAnimations().map((a) => a.finished)));
    const panel = await drawer.boundingBox();
    assert.ok(panel.x + panel.width <= 320 + 1 && panel.height >= 699, "sidebar fills the right edge");
    assert.equal(await drawer.getByRole("button", { name: /^Sign (in|out)$/ }).count(), 1);
    await page.keyboard.press("Escape");
    await drawer.waitFor({ state: "hidden" });
    await menuButton.click();
    await page.mouse.click(5, 350);
    await drawer.waitFor({ state: "hidden" });
    await menuButton.click();
    await drawer.getByRole("link", { name: "My bonsai", exact: true }).click();
    await page.waitForURL(/\/my-nfts$/);
    await drawer.waitFor({ state: "hidden" });
    await menuButton.click();
    await page.setViewportSize({ width: 1280, height: 700 });
    await drawer.waitFor({ state: "hidden" });
    assert.deepEqual(errors, []);
  } finally {
    await browser.close();
  }
});

test("hearts show like counts, toggle optimistically in cards and the modal, and roll back on errors", async () => {
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage({ viewport: { width: 390, height: 900 } });
    await fixture(page);
    await page.goto(new URL("/gallery", origin).href);
    const cards = page.locator("article");
    const heart = (n) => cards.nth(n).getByRole("button", { name: /likes\)$/ });
    await page.getByRole("button", { name: "Like (41 likes)" }).waitFor();
    assert.equal(await heart(0).getAttribute("aria-pressed"), "false");
    await heart(0).click();
    await cards.nth(0).getByRole("button", { name: "Unlike (1 likes)", disabled: false }).waitFor();
    assert.equal(await heart(0).getAttribute("aria-pressed"), "true");
    await cards.nth(1).getByRole("button", { name: "Details", exact: true }).click();
    const modal = page.getByRole("dialog", { name: "Bonsai #1", exact: true });
    await modal.getByRole("button", { name: "Like (41 likes)" }).click();
    await modal.getByRole("button", { name: "Unlike (42 likes)", disabled: false }).waitFor();
    await page.keyboard.press("Escape");
    await cards.nth(1).getByRole("button", { name: "Unlike (42 likes)" }).waitFor();
    await page.evaluate(() => { globalThis.failLike = true; });
    await heart(2).click();
    await cards.nth(2).getByRole("alert").filter({ hasText: "Like test outage" }).waitFor();
    await cards.nth(2).getByRole("button", { name: "Like (0 likes)" }).waitFor();
    assert.equal(await page.evaluate(() => globalThis.likeCalls), 3, "only the clicked hearts call the backend");
    await cards.nth(0).getByRole("button", { name: "Unlike (1 likes)" }).waitFor();
    await cards.nth(1).getByRole("button", { name: "Unlike (42 likes)" }).waitFor();
    assert.equal(await page.getByRole("alert").count(), 1, "only the failed card shows an error");
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth));
    const dir = process.env.COLLECTION_SCREENSHOT_DIR;
    if (dir) {
      await mkdir(dir, { recursive: true });
      await page.evaluate(() => { globalThis.failLike = false; });
      await heart(2).click();
      await cards.nth(2).getByRole("button", { name: "Unlike (1 likes)", disabled: false }).waitFor();
      assert.equal(await page.getByRole("alert").count(), 0, "a successful retry clears the error");
      await page.evaluate(() => window.scrollTo(0, 0));
      await page.screenshot({ path: join(dir, "likes-cards-mobile.png") });
      await page.setViewportSize({ width: 1280, height: 900 });
      await page.screenshot({ path: join(dir, "likes-cards-desktop.png") });
      await cards.nth(1).getByRole("button", { name: "Details", exact: true }).click();
      await modal.locator("img").evaluate((img) => img.decode()).catch(() => {});
      await page.screenshot({ path: join(dir, "likes-modal-desktop.png") });
    }
  } finally { await browser.close(); }
});

test("detail failures stay explicit and retryable; both pages infinite-scroll in small pages without refetching", async () => {
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage();
    await fixture(page, 101);
    await page.addInitScript(() => { globalThis.failMintDetails = true; });
    await page.goto(new URL("/gallery", origin).href);
    await page.getByRole("alert").filter({ hasText: "Mint details test outage" }).waitFor();
    assert.equal(await page.locator("article").count(), 24);
    assert.equal(await page.locator("article").first().getByText("Unavailable", { exact: true }).count(), 1);
    await page.getByText("Showing 24 of 101 bonsai.").waitFor();
    await page.evaluate(() => { globalThis.failMintDetails = false; });
    await page.getByRole("button", { name: "Retry details" }).click();
    await page.locator("article").first().getByText("19 ICP", { exact: true }).waitFor();
    assert.equal(await page.getByRole("alert").count(), 0);
    const afterRetry = (await page.evaluate(() => globalThis.mintRequests)).length;
    await scrollUntil(page, 101);
    await page.getByRole("heading", { name: "Bonsai #100", exact: true }).waitFor();
    await page.locator("article").last().getByText("19 ICP", { exact: true }).waitFor();
    await page.getByText("Showing 101 of 101 bonsai.").waitFor();
    await page.getByText("You've reached the first bonsai ever planted.").waitFor();
    if (process.env.COLLECTION_SCREENSHOT_DIR) {
      await mkdir(process.env.COLLECTION_SCREENSHOT_DIR, { recursive: true });
      await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
      await page.screenshot({ path: join(process.env.COLLECTION_SCREENSHOT_DIR, "gallery-infinite-end.png") });
    }
    assert.equal(await page.getByRole("button", { name: "Load more bonsai" }).count(), 0);
    const scrolled = (await page.evaluate(() => globalThis.mintRequests)).slice(afterRetry);
    assert.deepEqual(scrolled, [24, 24, 24, 5], "each scroll page loads only its own details");

    await page.goto(new URL("/my-nfts", origin).href);
    await page.getByRole("alert").filter({ hasText: "Mint details test outage" }).waitFor();
    await page.evaluate(() => { globalThis.failMintDetails = false; });
    await page.getByRole("button", { name: "Retry details" }).click();
    await page.locator("article").first().getByText("19 ICP", { exact: true }).waitFor();
    assert.equal(await page.locator("article").count(), 24);
    await page.getByText("101 bonsai in your grove").waitFor();
    // The fallback button works without scrolling (keyboard users, no IntersectionObserver).
    await page.getByRole("button", { name: "Load more of my bonsai" }).first().click();
    await scrollUntil(page, 101);
    await page.locator("article").last().getByText("19 ICP", { exact: true }).waitFor();
    assert.equal(await page.getByRole("button", { name: "Load more of my bonsai" }).count(), 0);
    const myRequests = await page.evaluate(() => globalThis.mintRequests);
    assert.ok(myRequests.every((count) => count <= 24), "my bonsai details are fetched per page");
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
