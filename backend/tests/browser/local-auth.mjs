import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import { chromium } from "playwright";

async function checkLocalAuth(hostname) {
  const network = JSON.parse(execFileSync("node_modules/.bin/icp", ["network", "status", "-e", "local", "--json"], { encoding: "utf8" }));
  const ids = JSON.parse(await readFile(new URL("../../../.icp/cache/mappings/local.ids.json", import.meta.url), "utf8"));
  const origin = new URL(network.gateway_url);
  origin.hostname = hostname === "alias" ? "frontend.local.localhost" : `${ids.frontend}.localhost`;
  const appOrigin = process.env.AUTH_TEST_ORIGIN ?? origin.origin;
  const browser = await chromium.launch();
  try {
    const context = await browser.newContext();
    const seedIndex = Date.now().toString();
    const handleSeedPrompt = (page) => {
      page.on("dialog", async (dialog) => {
        assert.equal(dialog.type(), "prompt");
        assert.equal(dialog.message(), "Enter seed index");
        await new Promise((resolve) => setTimeout(resolve, 8_000));
        await dialog.accept(seedIndex);
      });
    };
    context.on("page", handleSeedPrompt);
    const app = await context.newPage();
    await app.goto(new URL("/mint", appOrigin).href);
    assert.doesNotMatch(await app.locator("main").innerText(), /Local test identity/);
    await app.getByRole("button", { name: "Sign in with Internet Identity", exact: true }).click();
    const provider = app;
    await provider.getByRole("button", { name: "Sign in with passkey", exact: true }).waitFor();
    const providerUrl = new URL(provider.url());
    assert.equal(providerUrl.hostname, "uqzsh-gqaaa-aaaaq-qaada-cai.localhost");
    assert.equal(providerUrl.pathname, "/authorize");
    assert.equal(context.pages().length, 1);
    await provider.getByRole("button", { name: "Create", exact: true }).click();
    await provider.getByRole("button", { name: "Create with passkey", exact: true }).click();
    await provider.getByPlaceholder("Identity name").fill("Bonsai local auth regression");
    await provider.getByRole("button", { name: "Create identity", exact: true }).click();
    await provider.getByRole("button", { name: "Continue", exact: true }).click();
    const checkout = app.getByRole("button", { name: "Pay €99 by card", exact: true });
    await checkout.waitFor();
    assert.equal(app.url(), new URL("/mint", appOrigin).href);
    const principal = await app.locator("header span[title]").getAttribute("title");
    await app.getByText("Local mock - card payments are simulated").waitFor();
    await app.reload();
    await checkout.waitFor();
    await app.getByRole("button", { name: "Sign out", exact: true }).click();
    await app.getByRole("button", { name: "Sign in with Internet Identity", exact: true }).click();
    await app.getByRole("button", { name: "Continue", exact: true }).click();
    await checkout.waitFor();
    assert.doesNotMatch(await app.locator("body").innerText(), /anchor_number|Channel was closed/);
    await context.close();

    const returningContext = await browser.newContext();
    returningContext.on("page", handleSeedPrompt);
    const returningApp = await returningContext.newPage();
    await returningApp.goto(new URL("/gallery?auth-test=return", appOrigin).href);
    await returningApp.getByRole("button", { name: "Sign in", exact: true }).click();
    await returningApp.getByRole("button", { name: "Sign in with passkey", exact: true }).click();
    await returningApp.getByRole("button", { name: "Continue", exact: true }).click();
    await returningApp.getByRole("button", { name: "Sign out", exact: true }).waitFor();
    assert.equal(returningApp.url(), new URL("/gallery?auth-test=return", appOrigin).href);
    assert.equal(await returningApp.locator("header span[title]").getAttribute("title"), principal);
    assert.equal(returningContext.pages().length, 1);
    assert.doesNotMatch(await returningApp.locator("body").innerText(), /anchor_number|Channel was closed/);
  } finally {
    await browser.close();
  }
}

for (const hostname of process.env.AUTH_TEST_ORIGIN ? ["custom"] : ["canonical", "alias"]) {
  test(`local II redirect survives a slow seed prompt (${hostname})`, { timeout: 90_000 }, () => checkLocalAuth(hostname));
}
