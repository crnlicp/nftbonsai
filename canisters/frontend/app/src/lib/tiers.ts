// Display metadata for the backend's five named tiers (anchor prices per payment method come from backend `pricing()`).
interface TierMeta {
  name: string;
  pot: string;
  aura: string;
  branches: number;
  canopy: string;
  potName: string;
}

export const TIERS: TierMeta[] = [
  { name: "Sprout", pot: "#a0522d", aura: "#86efac", branches: 3, canopy: "Airy", potName: "Terracotta" },
  { name: "Grove", pot: "#9ca3af", aura: "#a7f3d0", branches: 4, canopy: "Airy", potName: "Stone" },
  { name: "Jade", pot: "#15803d", aura: "#34d399", branches: 5, canopy: "Lush", potName: "Jade" },
  { name: "Lacquer", pot: "#0369a1", aura: "#38bdf8", branches: 6, canopy: "Lush", potName: "Lacquer" },
  { name: "Imperial", pot: "#a16207", aura: "#facc15", branches: 7, canopy: "Dense", potName: "Gold" },
];

export const LUCKY_ODDS = "1 in 32";
// Paying with the token doubles the lucky-bloom odds (mirrors backend Tiers.lucky).
export const TOKEN_LUCKY_ODDS = "1 in 16";

// A price earns the highest tier whose anchor it reaches (mirrors backend Tiers.tierIn).
export function tierOf(amount: number, anchors: number[]): number {
  let tier = 0;
  anchors.forEach((anchor, i) => { if (amount >= anchor) tier = i; });
  return tier;
}

// The slider gives each gap between tier anchors an equal share of the track, so cheap tiers stay easy to dial in.
export const SLIDER_MAX = 1000;
export function sliderToAmount(position: number, anchors: number[]): number {
  const gaps = anchors.length - 1;
  const span = SLIDER_MAX / gaps;
  const gap = Math.min(gaps - 1, Math.floor(position / span));
  const t = (position - gap * span) / span;
  return Math.round(anchors[gap] + t * (anchors[gap + 1] - anchors[gap]));
}
export function amountToSlider(amount: number, anchors: number[]): number {
  const gaps = anchors.length - 1;
  const span = SLIDER_MAX / gaps;
  const gap = Math.max(0, Math.min(gaps - 1, tierOf(amount, anchors) - (amount >= anchors[gaps] ? 1 : 0)));
  const t = (amount - anchors[gap]) / (anchors[gap + 1] - anchors[gap]);
  return Math.round(gap * span + Math.max(0, Math.min(1, t)) * span);
}

export function tierName(index: bigint | number | undefined): string {
  return TIERS[Number(index ?? 0)]?.name ?? "Bonsai";
}

export function shade(hex: string, amount: number): string {
  const n = parseInt(hex.slice(1), 16);
  const channel = (shift: number) => {
    const c = (n >> shift) & 255;
    const v = amount >= 0 ? c + (255 - c) * amount : c * (1 + amount);
    return Math.round(Math.max(0, Math.min(255, v))).toString(16).padStart(2, "0");
  };
  return `#${channel(16)}${channel(8)}${channel(0)}`;
}
