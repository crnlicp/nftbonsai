import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import { chromium } from "playwright";
import { createAuthContext, signInWithPasskey } from "./identity.mjs";

async function checkLocalAuth(hostname) {
  const network = JSON.parse(execFileSync("node_modules/.bin/icp", ["network", "status", "-e", "local", "--json"], { encoding: "utf8" }));
  const ids = JSON.parse(await readFile(new URL("../../../.icp/cache/mappings/local.ids.json", import.meta.url), "utf8"));
  const origin = new URL(network.gateway_url);
  origin.hostname = hostname === "alias" ? "frontend.local.localhost" : `${ids.frontend}.localhost`;
  const appOrigin = process.env.AUTH_TEST_ORIGIN ?? origin.origin;
  const browser = await chromium.launch();
  try {
    const context = await createAuthContext(browser);
    const app = await context.newPage();
    await app.goto(new URL("/mint", appOrigin).href);
    assert.doesNotMatch(await app.locator("main").innerText(), /Local test identity/);
    const credentials = await signInWithPasskey(app, { name: "Bonsai local auth regression" });
    assert.equal(context.pages().length, 1);
    const checkout = app.getByRole("button", { name: "Pay 19 ICP", exact: true });
    await checkout.waitFor();
    assert.equal(app.url(), new URL("/mint", appOrigin).href);
    const principal = await app.locator("header span[title]").getAttribute("title");
    await app.getByText("Local mock - card payments are simulated").waitFor();
    await app.reload();
    await checkout.waitFor();
    assert.equal(await app.locator("header span[title]").getAttribute("title"), principal);
    await app.getByRole("button", { name: "Sign out", exact: true }).click();
    await signInWithPasskey(app, { credentials });
    await checkout.waitFor();
    assert.equal(await app.locator("header span[title]").getAttribute("title"), principal);
    await context.close();

    const returningContext = await createAuthContext(browser);
    const returningApp = await returningContext.newPage();
    await returningApp.goto(new URL("/gallery?auth-test=return", appOrigin).href);
    await signInWithPasskey(returningApp, { credentials });
    assert.equal(returningApp.url(), new URL("/gallery?auth-test=return", appOrigin).href);
    assert.equal(await returningApp.locator("header span[title]").getAttribute("title"), principal);
    assert.equal(returningContext.pages().length, 1);
  } finally {
    await browser.close();
  }
}

for (const hostname of process.env.AUTH_TEST_ORIGIN ? ["custom"] : ["canonical", "alias"]) {
  test(`hosted II authenticates local canisters and restores the session (${hostname})`, { timeout: 120_000 }, () => checkLocalAuth(hostname));
}
