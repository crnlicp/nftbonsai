import { writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { resolve } from "node:path";
import { PocketIc, PocketIcServer } from "@dfinity/pic";
import { IDL } from "@icp-sdk/core/candid";
// Run with --experimental-strip-types; validates the exact browser growth code against every sample.
import { growth } from "../../frontend/src/lib/growth.ts";

// Must serialize exactly like Art.mo; GrowingBonsai.tsx uses the same row-run encoding.
function serialize(colors) {
  let svg = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" shape-rendering="crispEdges">';
  for (let y = 0; y < 64; y++) {
    for (let x = 0; x < 64;) {
      const color = colors[y * 64 + x];
      let width = 1;
      while (x + width < 64 && colors[y * 64 + x + width] === color) width++;
      svg += `<rect x="${x}" y="${y}" width="${width}" height="1" fill="${color}"/>`;
      x += width;
    }
  }
  return svg + "</svg>";
}

const server = await PocketIcServer.start();
let pic;
try {
  pic = await PocketIc.create(server.getUrl());
  const { actor } = await pic.setupCanister({
    wasm: resolve(".mops/.build/art-tests.wasm"),
    idlFactory: () => IDL.Service({
      batch: IDL.Func([IDL.Nat, IDL.Nat], [IDL.Vec(IDL.Record({
        shape: IDL.Vec(IDL.Nat8), pixels: IDL.Vec(IDL.Nat8), valid: IDL.Bool,
        style: IDL.Nat, tier: IDL.Nat, svg: IDL.Text,
        sky: IDL.Nat, moonPhase: IDL.Nat, season: IDL.Nat, specialElem: IDL.Nat,
      }))], ["query"]),
    }),
  });
  const samples = [];
  for (const start of [0n, 20n]) {
    for (const sample of await actor.batch(start, 20n)) {
      if (!sample.valid || !sample.svg) throw new Error("Invalid canonical landing sample");
      const canonical = new Array(4096);
      for (const [, x, y, width, color] of sample.svg.matchAll(/<rect x="(\d+)" y="(\d+)" width="(\d+)" height="1" fill="(#[0-9a-f]{6})"\/>/g)) {
        for (let offset = 0; offset < Number(width); offset++) canonical[Number(y) * 64 + Number(x) + offset] = color;
      }
      if (canonical.includes(undefined)) throw new Error("Incomplete canonical SVG raster");
      const rgb = Buffer.concat(canonical.map((color) => Buffer.from(color.slice(1), "hex")));
      if (!createHash("sha256").update(rgb).digest().equals(Buffer.from(sample.pixels))) {
        throw new Error("Landing pixels differ from canonical artwork");
      }

      if (serialize(canonical) !== sample.svg) throw new Error("Landing serializer differs from Art.mo");
      const palette = [...new Set(canonical)];
      if (palette.length > 36) throw new Error("Landing palette exceeds one base-36 digit per pixel");
      const atmosphere = Object.fromEntries(["sky", "moonPhase", "season", "specialElem"].map((key) => [key, Number(sample[key])]));
      growth(canonical, sample.shape, atmosphere);
      samples.push({
        palette,
        art: canonical.map((color) => palette.indexOf(color).toString(36)).join(""),
        shape: [...sample.shape].join(""),
        atmosphere,
      });
    }
  }
  await writeFile(new URL("../../frontend/public/previews/growing.json", import.meta.url), JSON.stringify(samples) + "\n");
} finally {
  await pic?.tearDown();
  await server.stop();
}
