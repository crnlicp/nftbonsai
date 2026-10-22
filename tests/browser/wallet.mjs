import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { test } from "node:test";
import { chromium } from "playwright";

// Requires the local network with the ICP ledger; the DEV identity holds local test ICP.
const funder = process.env.FUND_IDENTITY ?? "DEV";
const icp = (...args) => execFileSync("node_modules/.bin/icp", [...args, "--identity", funder], { encoding: "utf8" }).trim();
const fund = (principal, amount) => icp("token", "transfer", amount, principal, "-n", "local", "--quiet");

test("wallet shows, receives and sends ICP; Mint pays with ICP and mints the chosen tier", { timeout: 180_000 }, async () => {
  const origin = process.env.MINT_TEST_ORIGIN ?? "http://frontend.local.localhost:8765";
  const browser = await chromium.launch();
  try {
    const context = await browser.newContext();
    context.on("page", (page) => page.on("dialog", (dialog) => dialog.accept(Date.now().toString())));
    const app = await context.newPage();
    const errors = [];
    app.on("pageerror", (error) => errors.push(error.message));
    await app.goto(new URL("/wallet", origin).href);
    await app.getByRole("button", { name: "Sign in with Internet Identity", exact: true }).click();
    await app.getByRole("button", { name: "Create", exact: true }).click();
    await app.getByRole("button", { name: "Create with passkey", exact: true }).click();
    await app.getByPlaceholder("Identity name").fill("Bonsai wallet regression");
    await app.getByRole("button", { name: "Create identity", exact: true }).click();
    await app.getByRole("button", { name: "Continue", exact: true }).click();

    const balance = app.getByTestId("icp-balance");
    await balance.waitFor();
    const address = app.getByTestId("receive-address");
    assert.match(await address.innerText(), /^[0-9a-f]{64}$/, "account ID is the default receive address");
    assert.equal(await app.getByAltText(/^QR code for /).count(), 1);
    await app.getByRole("tab", { name: "Principal" }).click();
    const principal = (await address.innerText()).trim();
    assert.equal(principal, await app.locator("header span[title]").getAttribute("title"));

    fund(principal, "150");
    await app.getByRole("button", { name: "Refresh", exact: true }).click();
    await app.waitForFunction(() => document.querySelector("[data-testid=icp-balance]")?.textContent?.includes("150"));

    assert.equal(await app.getByLabel("To").fill("2vxsx-fae").then(() => app.getByRole("button", { name: "Review", exact: true }).click()).then(() => app.getByRole("alert").innerText()), "Enter a valid principal or 64-character account ID");
    await app.getByLabel("To").fill(icp("identity", "principal"));
    await app.getByLabel("Amount").fill("1.5");
    await app.getByRole("button", { name: "Review", exact: true }).click();
    await app.getByRole("button", { name: "Confirm send", exact: true }).click();
    await app.locator("main [role=status], main [role=alert]").first().waitFor({ timeout: 30_000 });
    assert.equal(await app.getByRole("alert").count(), 0, await app.locator("main [role=alert]").allInnerTexts().then(String));
    await app.waitForFunction(() => document.querySelector("[data-testid=icp-balance]")?.textContent?.includes("148.4999"));

    await app.screenshot({ path: process.env.WALLET_SCREENSHOT ?? "test-results/wallet.png", fullPage: true }).catch(() => {});

    await app.getByRole("link", { name: "Mint", exact: true }).first().click();
    const price = app.getByRole("textbox", { name: "Exact price in euro" });
    const slider = app.getByRole("slider", { name: "Price in euro" });
    await slider.waitFor();
    const priceIs = (value) => app.waitForFunction((v) => document.getElementById("price-eur")?.value === v, value);
    const sliderSays = (text) => app.waitForFunction((t) => document.querySelector("input[type=range]")?.getAttribute("aria-valuetext") === t, text);
    await priceIs("99");
    await app.getByRole("button", { name: "Jade from €199" }).click();
    await priceIs("199");
    await sliderSays("€199, Jade tier");
    await slider.focus();
    await app.keyboard.press("ArrowRight");
    await priceIs("200");
    await app.keyboard.press("PageDown");
    await priceIs("190");
    await sliderSays("€190, Grove tier");
    await price.fill("5000");
    await price.press("Enter");
    await priceIs("999");
    await price.fill("250");
    await price.press("Enter");
    await sliderSays("€250, Jade tier");
    await app.getByRole("button", { name: "+€249 for Lacquer" }).waitFor();

    await app.getByRole("tab", { name: "ICP", exact: true }).click();
    const quote = (await app.getByTestId("icp-quote").innerText()).replace(/[^\d.]/g, "");
    await app.getByRole("button", { name: `Pay ${quote} ICP`, exact: true }).click();
    await app.getByRole("heading", { name: /^Your bonsai #/ }).waitFor({ timeout: 90_000 });
    assert.match(await app.locator("main").innerText(), /Jade · €250|Jade · [\d.]+ ICP/);
    const expected = (148.4999 - Number(quote) - 0.0002).toFixed(4);
    await app.goto(new URL("/wallet", origin).href);
    await app.waitForFunction((value) => document.querySelector("[data-testid=icp-balance]")?.textContent?.startsWith(value), expected);
    assert.deepEqual(errors, []);
  } finally {
    await browser.close();
  }
});
