import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { test } from "node:test";
import { chromium } from "playwright";
import { Ed25519KeyIdentity } from "@icp-sdk/core/identity";

test("signed local marketplace renders real listings, sending and responsive landing", {
  skip: !process.env.COLLECTION_MARKET_ORIGIN,
  timeout: 120_000,
}, async () => {
  const liveOrigin = process.env.COLLECTION_MARKET_ORIGIN;
  assert.equal(new URL(liveOrigin).hostname, "localhost", "signed test identity is local-only");
  const identity = Ed25519KeyIdentity.generate();
  const buyer = Ed25519KeyIdentity.generate();
  const recipient = Ed25519KeyIdentity.generate().getPrincipal().toText();
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage({ viewport: { width: 1440, height: 1100 } });
    const errors = [];
    page.on("pageerror", (e) => errors.push(e.message));
    await page.route("**/src/components/AuthProvider.tsx*", (route) => route.fulfill({
      contentType: "application/javascript",
      body: `
        import { Ed25519KeyIdentity } from "/node_modules/@icp-sdk/core/lib/esm/identity/index.js";
        const identity = Ed25519KeyIdentity.fromJSON(sessionStorage.getItem("market-test-identity") ?? ${JSON.stringify(JSON.stringify(identity.toJSON()))});
        export function AuthProvider({children}) { return children; }
        export function useAuthContext() {
          return { identity, principal: identity.getPrincipal().toText(), isAuthenticated: true, isLoading: false, signIn() {}, signOut() {} };
        }
      `,
    }));
    await page.goto(new URL("/mint", liveOrigin).href);
    await page.getByTestId("pay-card").click();
    await page.getByLabel("Exact price in EUR").fill("99");
    await page.getByLabel("Exact price in EUR").press("Tab");
    await page.getByRole("button", { name: "Pay €99 by card", exact: true }).click().catch(async (error) => {
      throw new Error(`${error.message}\n${await page.locator("main").innerText()}\n${errors.join("\n")}`);
    });
    await page.getByRole("heading", { name: /^Your bonsai #/ }).waitFor({ timeout: 60_000 });
    await page.goto(new URL("/my-nfts", liveOrigin).href);
    const card = page.locator("article").first();
    await card.getByRole("button", { name: "Details", exact: true }).click();
    const name = await card.getByRole("heading").innerText();
    const modal = page.getByRole("dialog");
    const screenshotDir = process.env.COLLECTION_SCREENSHOT_DIR;
    if (screenshotDir) await mkdir(screenshotDir, { recursive: true });
    async function capture(name) {
      for (const [device, width, height] of [["desktop", 1440, 1100], ["mobile", 390, 1000]]) {
        await page.setViewportSize({ width, height });
        assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth));
        // Full-page stitching drops backdrop-filter layers; grow the viewport to the page instead.
        if (name === "collection") await page.setViewportSize({ width, height: await page.evaluate(() => document.documentElement.scrollHeight) });
        if (screenshotDir) await page.screenshot({ path: join(screenshotDir, `${name}-${device}.png`), fullPage: name === "landing" });
      }
    }
    await modal.getByRole("tab", { name: "Trade", exact: true }).click();
    await modal.getByRole("combobox", { name: /^Currency/ }).selectOption("token");
    await modal.getByLabel("Asking price").fill("25000");
    await modal.getByRole("button", { name: "Review listing", exact: true }).click();
    await modal.getByRole("button", { name: "Confirm listing", exact: true }).waitFor();
    await modal.getByRole("button", { name: "Confirm listing", exact: true }).scrollIntoViewIfNeeded();
    await capture("listing-review");
    await modal.getByRole("button", { name: "Confirm listing", exact: true }).click();
    await modal.getByRole("button", { name: "Cancel listing", exact: true }).waitFor();
    await page.keyboard.press("Escape");
    await page.waitForFunction(() => !document.querySelector("dialog"));
    await card.getByRole("button", { name: "Details", exact: true }).waitFor();
    await page.getByRole("region", { name: "Marketplace activity" }).getByText("For sale", { exact: true }).waitFor();
    await capture("listed-collection");
    await page.evaluate((json) => sessionStorage.setItem("market-test-identity", json), JSON.stringify(buyer.toJSON()));
    await page.goto(new URL("/gallery", liveOrigin).href);
    await page.locator("article").filter({ has: page.getByRole("heading", { name, exact: true }) }).getByRole("button", { name: "Details & Buy", exact: true }).click();
    await modal.getByRole("button", { name: "Review purchase", exact: true }).click();
    await modal.getByText("25,000.0002 $BONSAI", { exact: true }).waitFor();
    await modal.getByText("Not enough funds", { exact: false }).waitFor();
    assert.ok(await modal.getByRole("button", { name: "Approve & buy bonsai", exact: true }).isDisabled());
    await modal.getByRole("button", { name: "Approve & buy bonsai", exact: true }).scrollIntoViewIfNeeded();
    await capture("purchase-review");
    await page.evaluate(() => sessionStorage.removeItem("market-test-identity"));
    await page.goto(new URL("/my-nfts", liveOrigin).href);
    await card.getByRole("button", { name: "Details", exact: true }).click();
    await modal.getByRole("button", { name: "Cancel listing", exact: true }).click();
    await modal.getByRole("tab", { name: "Send", exact: true }).click();
    await modal.getByLabel("Send to principal").fill(recipient);
    await modal.getByRole("button", { name: "Review transfer", exact: true }).click();
    await modal.getByRole("button", { name: "Confirm send bonsai", exact: true }).waitFor();
    await modal.getByRole("button", { name: "Confirm send bonsai", exact: true }).scrollIntoViewIfNeeded();
    await capture("send-review");
    await modal.getByRole("button", { name: "Confirm send bonsai", exact: true }).click();
    await page.waitForFunction(() => !document.querySelector("dialog"));
    await page.waitForFunction(() => document.querySelectorAll("article").length === 0);
    await page.goto(new URL("/", liveOrigin).href);
    await page.getByRole("link", { name: /Explore.*BONSAI/i }).waitFor();
    await capture("landing");
    await page.setViewportSize({ width: 320, height: 900 });
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth));
    await page.locator("footer").scrollIntoViewIfNeeded();
    await capture("landing-footer");
    await page.goto(new URL("/wallet", liveOrigin).href);
    await page.getByRole("link", { name: "Canister IDs & wallet guide", exact: true }).click();
    await page.getByRole("heading", { name: "On-chain & in your wallet", exact: true }).waitFor();
    const logo = page.getByRole("img", { name: "ICPBonsai collection logo" });
    await logo.evaluate((img) => img.decode());
    assert.ok(await logo.evaluate((img) => img.naturalWidth > 0), "collection logo loads from the NFT canister");
    const nftCanister = await page.getByTestId("canister-NFT collection").innerText();
    assert.match(nftCanister, /^[a-z0-9-]+-cai$/);
    await page.getByText("$BONSAI ledger", { exact: true }).waitFor();
    await page.setViewportSize({ width: 320, height: 900 });
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), "collection page fits 320px");
    await capture("collection");
    assert.deepEqual(errors, []);
  } finally { await browser.close(); }
});
