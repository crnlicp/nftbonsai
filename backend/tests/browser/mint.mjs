import assert from "node:assert/strict";
import { test } from "node:test";
import { chromium } from "playwright";
import { createAuthContext, signInWithPasskey } from "./identity.mjs";

// Requires the local network with MOCK_PAYMENTS=1, where a purchase is paid and minted without checkout.
test("a freshly minted bonsai grows once on the Mint page; past mints stay static and are not the default view", { timeout: 120_000 }, async () => {
  const origin = process.env.MINT_TEST_ORIGIN ?? "http://frontend.local.localhost:8765";
  const browser = await chromium.launch();
  try {
    const context = await createAuthContext(browser);
    const app = await context.newPage();
    const errors = [];
    app.on("pageerror", (error) => errors.push(error.message));
    await app.goto(new URL("/mint", origin).href);
    await signInWithPasskey(app, { name: "Bonsai mint growth regression" });
    // ICP is the default method; switching to card keeps the Grove tier (19 ICP -> €99).
    await app.getByRole("button", { name: "Pay 19 ICP", exact: true }).waitFor();
    await app.getByTestId("pay-card").click();
    await app.getByRole("button", { name: "Pay €99 by card", exact: true }).click();

    const tree = app.locator(".growing-bonsai");
    await tree.waitFor({ timeout: 60_000 });
    const appeared = Date.now();
    const state = () => tree.evaluate((element) => ({
      src: element.querySelector("img").src,
      final: getComputedStyle(element.querySelector("img")).opacity,
      opacity: [...element.querySelectorAll(".bonsai-pixels")].map((rect) => getComputedStyle(rect).opacity),
      holes: (() => {
        const cells = new Set();
        for (const rect of element.querySelectorAll("rect:not(.bonsai-pixels)")) {
          for (let i = 0; i < Number(rect.getAttribute("width")); i++) cells.add(`${Number(rect.getAttribute("x")) + i},${rect.getAttribute("y")}`);
        }
        return 4096 - cells.size;
      })(),
    }));
    const start = await state();
    assert.match(start.src, /\/nft\/\d+\.svg$/, "final frame is the certified NFT image URL");
    assert.equal(start.holes, 0);
    assert.equal(start.final, "0");
    assert.ok(start.opacity.filter((value) => value === "1").length < start.opacity.length / 4, "tree starts mostly hidden");

    // Composite of scene + every tree layer must equal the certified SVG served by the NFT canister.
    const certifiedPage = await context.newPage();
    await certifiedPage.goto(start.src);
    const certified = await certifiedPage.evaluate(() => new XMLSerializer().serializeToString(document));
    await certifiedPage.close();
    assert.ok(await tree.evaluate((element, svg) => {
      const grid = (rects) => {
        const cells = new Array(4096).fill(null);
        for (const rect of rects) {
          const x = Number(rect.getAttribute("x")), y = Number(rect.getAttribute("y"));
          for (let i = 0; i < Number(rect.getAttribute("width")); i++) cells[y * 64 + x + i] = rect.getAttribute("fill");
        }
        return cells;
      };
      const expected = grid(new DOMParser().parseFromString(svg, "image/svg+xml").querySelectorAll("rect"));
      return grid(element.querySelectorAll("rect")).every((cell, index) => cell === expected[index]);
    }, certified), "grown layers equal the certified NFT pixels");

    await app.waitForTimeout(Math.max(0, appeared + 4000 - Date.now()));
    const middle = await state();
    assert.equal(middle.final, "0", "still growing at 4s with 500ms steps");
    assert.ok(middle.opacity.includes("0") && middle.opacity.includes("1"));
    await app.waitForTimeout(Math.max(0, appeared + 10_300 - Date.now()));
    const done = await state();
    assert.equal(done.final, "1");
    assert.ok(done.opacity.every((value) => value === "1"));

    // Revisiting: no default bonsai, past mints open as the static gallery image.
    const heading = app.getByRole("heading", { name: /^Your bonsai #/ });
    const purchase = app.locator("main [data-purchase-id]").first();
    const purchaseId = await purchase.getAttribute("data-purchase-id");
    await app.reload();
    await purchase.waitFor();
    await app.waitForTimeout(5000);
    assert.equal(await heading.count(), 0, "the last minted bonsai is not the default view");
    assert.equal(await app.getByRole("button", { name: "Pay 19 ICP", exact: true }).count(), 1, "ICP is the default after reload");
    await purchase.click();
    await heading.waitFor();
    await app.locator("main img[src$='.svg']").first().waitFor();
    assert.equal(await tree.count(), 0, "previously minted bonsai is static");

    // Paw's return redirect lands on a fresh /mint load: a purchase seen unpaid grows exactly once.
    const principal = await app.locator("header span[title]").getAttribute("title");
    await app.evaluate(([key, id]) => localStorage.setItem(key, JSON.stringify([id])), [`bonsai:awaiting-growth:${principal}`, purchaseId]);
    await app.reload();
    await tree.waitFor({ timeout: 15_000 });
    await app.reload();
    await purchase.waitFor();
    await app.waitForTimeout(5000);
    assert.equal(await tree.count(), 0, "growth is shown only once");
    assert.equal(await heading.count(), 0);
    assert.deepEqual(errors, []);
  } finally {
    await browser.close();
  }
});
