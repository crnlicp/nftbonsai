export const GROWTH_STEPS = 20;
export const GROWTH_STEP_MS = 500;
export const GROWTH_MS = GROWTH_STEPS * GROWTH_STEP_MS;

/** Bonsai traits that decide the sky decorations Art.mo paints behind the tree. */
export interface Atmosphere { sky: number; moonPhase: number; season: number; specialElem: number }

export type Run = [x: number, y: number, width: number, fill: string, step: number];
export interface Growth { scene: Run[]; tree: Run[] }

const SVG_OPEN = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" shape-rendering="crispEdges">';
const POT_RIM = "#d4b48c";
const ACCENT = "#b1c786";
const LIGHT = "#f4dfab";
const MARK = "#c2410c";
const POT_SAMPLE = 56 * 64 + 40;

/** Pot mark from Art.mo: the tree silhouette pooled to 7x7, one entry per cell at x 28-34, y 51-57. */
function potMark(shape: ArrayLike<number>): boolean[] {
  let minX = 64, maxX = -1, minY = 64, maxY = -1;
  for (let index = 0; index < 4096; index++) {
    if (shape[index] !== 1) continue;
    const x = index % 64, y = Math.floor(index / 64);
    minX = Math.min(minX, x); maxX = Math.max(maxX, x); minY = Math.min(minY, y); maxY = Math.max(maxY, y);
  }
  if (maxX < 0) return new Array<boolean>(49).fill(false);
  const w = maxX - minX + 1, h = maxY - minY + 1;
  const mark: boolean[] = [];
  for (let gy = 0; gy < 7; gy++) {
    const y1 = minY + Math.floor(gy * h / 7), y2 = Math.max(minY + Math.floor((gy + 1) * h / 7), y1 + 1);
    for (let gx = 0; gx < 7; gx++) {
      const x1 = minX + Math.floor(gx * w / 7), x2 = Math.max(minX + Math.floor((gx + 1) * w / 7), x1 + 1);
      let count = 0;
      for (let sy = y1; sy < y2; sy++) for (let sx = x1; sx < x2; sx++) count += shape[sy * 64 + sx] === 1 ? 1 : 0;
      mark.push(4 * count > (y2 - y1) * (x2 - x1));
    }
  }
  return mark;
}

// Mirrors Art.mo's paint order without the tree: ground, pot, atmosphere, then the pot mark.
function backdrop(sky: string, ground: string, pot: string, { sky: skyIndex, moonPhase, season, specialElem }: Atmosphere, shape: ArrayLike<number>): string[] {
  const colors = Array.from({ length: 4096 }, (_, index) => index >= 47 * 64 ? ground : sky);
  const cell = (x: number, y: number, color: string) => {
    if (x >= 0 && x < 64 && y >= 0 && y < 64) colors[y * 64 + x] = color;
  };
  const disc = (cx: number, cy: number, r: number, color: string) => {
    for (let y = -r; y <= r; y++) for (let x = -r; x <= r; x++) if (x * x + y * y <= r * r) cell(cx + x, cy + y, color);
  };
  for (let y = 49; y <= 57; y++) {
    const inset = Math.floor((y - 49) / 3);
    for (let x = 17 + inset; x <= 45 - inset; x++) cell(x, y, y === 49 || x === 17 + inset ? POT_RIM : pot);
  }
  if (skyIndex >= 3) {
    disc(51, 8, 3, LIGHT);
    if (moonPhase !== 4) disc(49 + Math.floor(moonPhase / 2), 8, 3, sky);
  }
  for (const [x, y] of [[5, 10], [58, 20], [7, 31]]) cell(x + season, y, season === 3 ? LIGHT : ACCENT);
  if (specialElem > 0) {
    cell(8 + specialElem, 43, LIGHT);
    cell(9 + specialElem, 42, LIGHT);
  }
  potMark(shape).forEach((on, index) => { if (on) cell(28 + index % 7, 51 + Math.floor(index / 7), MARK); });
  return colors;
}

// Row-run encoding identical to Art.mo, so canonicalSvg(parseCanonicalSvg(svg)) === svg.
function runs(colors: string[], steps?: (number | undefined)[]): Run[] {
  const result: Run[] = [];
  for (let y = 0; y < 64; y++) {
    for (let x = 0; x < 64;) {
      const index = y * 64 + x;
      const step = steps?.[index];
      if (steps && step === undefined) { x++; continue; }
      let width = 1;
      while (x + width < 64 && colors[index + width] === colors[index] && steps?.[index + width] === step) width++;
      result.push([x, y, width, colors[index], step ?? 0]);
      x += width;
    }
  }
  return result;
}

export function canonicalSvg(colors: string[]): string {
  return runs(colors).reduce((svg, [x, y, width, fill]) =>
    `${svg}<rect x="${x}" y="${y}" width="${width}" height="1" fill="${fill}"/>`, SVG_OPEN) + "</svg>";
}

export function parseCanonicalSvg(svg: string): string[] {
  const colors = new Array<string | undefined>(4096);
  for (const [, x, y, width, fill] of svg.matchAll(/<rect x="(\d+)" y="(\d+)" width="(\d+)" height="1" fill="(#[0-9a-f]{6})"\/>/g)) {
    for (let offset = 0; offset < Number(width); offset++) colors[Number(y) * 64 + Number(x) + offset] = fill;
  }
  if (colors.includes(undefined)) throw new Error("Incomplete bonsai artwork");
  return colors as string[];
}

/** Splits canonical pixels into the scene behind the tree and tree pixels ordered by path distance from the trunk base. */
export function growth(colors: string[], shape: ArrayLike<number>, atmosphere: Atmosphere): Growth {
  if (colors.length !== 4096 || shape.length !== 4096) throw new Error("Invalid bonsai artwork");
  const tree = (index: number) => shape[index] === 1;
  if (tree(0) || tree(63 * 64) || tree(POT_SAMPLE)) throw new Error("Bonsai scene is not visible");
  // Rebuild what lies behind the tree, so hidden tree cells never leave a hole.
  const behind = backdrop(colors[0], colors[63 * 64], colors[POT_SAMPLE], atmosphere, shape);
  if (colors.some((color, index) => !tree(index) && color !== behind[index])) throw new Error("Bonsai scene does not match its artwork");
  const scene = colors.map((color, index) => tree(index) ? behind[index] : color);
  const distance = new Array<number>(4096).fill(-1);
  const queue: number[] = [];
  for (let x = 0; x < 64; x++) if (tree(47 * 64 + x)) { distance[47 * 64 + x] = 0; queue.push(47 * 64 + x); }
  for (let q = 0; q < queue.length; q++) {
    const index = queue[q], x = index % 64;
    for (const next of [index - 64, index + 64, ...(x ? [index - 1] : []), ...(x < 63 ? [index + 1] : [])]) {
      if (next >= 0 && next < 4096 && tree(next) && distance[next] < 0) {
        distance[next] = distance[index] + 1;
        queue.push(next);
      }
    }
  }
  if (!queue.length || distance.some((value, index) => tree(index) && value < 0)) throw new Error("Bonsai tree is not connected");
  const farthest = Math.max(1, ...distance);
  return {
    scene: runs(scene),
    tree: runs(colors, distance.map((value) => value < 0 ? undefined : Math.round(value / farthest * (GROWTH_STEPS - 1)))),
  };
}

export function svgDataUrl(svg: string): string {
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}
