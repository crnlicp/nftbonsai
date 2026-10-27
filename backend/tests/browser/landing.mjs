import assert from "node:assert/strict";
import { test } from "node:test";
import { chromium } from "playwright";

// Rasterizes a tree card: inline scene + tree layers, and the canonical SVG shown by the final <img>.
const inspect = (elements) => elements.map((element) => {
  const grid = (rects) => {
    const cells = new Array(4096).fill(null);
    for (const rect of rects) {
      const x = Number(rect.getAttribute("x")), y = Number(rect.getAttribute("y"));
      for (let i = 0; i < Number(rect.getAttribute("width")); i++) cells[y * 64 + x + i] = rect.getAttribute("fill");
    }
    return cells;
  };
  const svg = element.querySelector("svg");
  const image = element.querySelector("img");
  const canonical = new DOMParser().parseFromString(decodeURIComponent(image.src.split(",")[1]), "image/svg+xml");
  const scene = grid(svg.querySelectorAll("rect:not(.bonsai-pixels)"));
  const composite = grid(svg.querySelectorAll("rect"));
  const expected = grid(canonical.querySelectorAll("rect"));
  return {
    source: image.src,
    holes: scene.filter((cell) => cell === null).length,
    exact: composite.every((cell, index) => cell === expected[index]),
    treeOpacity: [...svg.querySelectorAll(".bonsai-pixels")].map((rect) => getComputedStyle(rect).opacity),
    finalOpacity: getComputedStyle(image).opacity,
    starts: [...svg.querySelectorAll(".bonsai-pixels"), image].map((node) => node.getAnimations()[0]?.startTime),
  };
});

test("canonical pixel trees grow together without outlines, end as the NFT SVG, and respect reduced motion", async () => {
  const browser = await chromium.launch();
  try {
    const origin = process.env.LANDING_TEST_ORIGIN ?? "http://frontend.local.localhost:8765";
    // Inspect frame 0 on a second page so pausing cannot skew this page's timing.
    const frame = await browser.newPage();
    await frame.goto(origin);
    await frame.locator(".growing-bonsai").first().waitFor();
    await frame.evaluate(() => document.getAnimations().forEach((animation) => {
      animation.pause();
      animation.currentTime = 0;
    }));
    for (const tree of await frame.locator(".growing-bonsai").evaluateAll(inspect)) {
      assert.ok(tree.treeOpacity.every((opacity) => opacity === "0"), "no tree pixel or outline before growth");
      assert.equal(tree.finalOpacity, "0");
    }
    await frame.close();
    const page = await browser.newPage();
    const errors = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.goto(origin);
    const trees = page.locator(".growing-bonsai");
    await trees.first().waitFor();
    const loaded = Date.now();
    const until = (ms) => page.waitForTimeout(Math.max(0, loaded + ms - Date.now()));
    assert.equal(await trees.count(), 3);
    const first = await trees.evaluateAll(inspect);
    assert.equal(new Set(first.flatMap((tree) => tree.starts)).size, 1, "all trees must start in the same frame");
    for (const tree of first) {
      assert.equal(tree.holes, 0, "scene must cover every cell so no tree-shaped frame shows");
      assert.ok(tree.exact, "completed layers must equal the canonical NFT pixels");
    }
    const sources = () => trees.evaluateAll((elements) => elements.map((element) => element.querySelector("img").src));
    await until(10150);
    const grown = await sources();
    assert.ok(await trees.evaluateAll((elements) => elements.every((element) =>
      [...element.querySelectorAll(".bonsai-pixels, img")].every((node) => getComputedStyle(node).opacity === "1"))));
    await until(10800);
    assert.deepEqual(await sources(), grown, "samples hold for the pause");
    await until(11400);
    const after = await sources();
    assert.ok(after.every((source, index) => source !== grown[index]), "all three samples change after the pause");
    await page.emulateMedia({ reducedMotion: "reduce" });
    const still = await trees.evaluateAll(inspect);
    assert.ok(still.every((tree) => tree.finalOpacity === "1" && tree.treeOpacity.every((opacity) => opacity === "1")));
    await page.waitForTimeout(11300);
    assert.deepEqual(await sources(), still.map((tree) => tree.source), "reduced motion stops regeneration");
    await page.setViewportSize({ width: 375, height: 812 });
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth));
    assert.deepEqual(errors, []);
  } finally {
    await browser.close();
  }
});
