import { useEffect, useMemo, useState } from "react";
import { LUCKY_ODDS, TIERS, shade } from "../lib/tiers";

interface Props {
  tier: number;
  /** True while payment or minting is in flight. */
  brewing?: boolean;
  /** Set once a minted purchase rolled a lucky bloom. */
  lucky?: boolean;
}

const TEASES = [
  "Every seed draws its own silhouette.",
  "The seal on the pot is still deciding.",
  `${LUCKY_ODDS} seeds bloom a tier higher.`,
  "Twin trunks, or one proud and straight?",
  "What season does your tree dream in?",
  "A sleeping moon has its own opinion.",
  "No two crowns share a pixel.",
];

// "?" glyph in the same 7x7 grid as the minted pot seal.
const QUESTION = [
  "..###..",
  ".#...#.",
  ".....#.",
  "...##..",
  "...#...",
  ".......",
  "...#...",
].map((row) => [...row].map((c) => c === "#"));

function scramble(): boolean[][] {
  return Array.from({ length: 7 }, () => Array.from({ length: 7 }, () => Math.random() < 0.45));
}

// Pixel sapling: one side-branch per tier branch, canopy pads grow with the tier.
function sapling(tier: number) {
  const meta = TIERS[tier]!;
  const pixels: { x: number; y: number; c: string }[] = [];
  const trunkTop = 36 - meta.branches * 3;
  for (let y = trunkTop; y <= 40; y++) {
    const x = 31 + (y < 34 && y % 4 === 0 ? 1 : 0);
    pixels.push({ x, y, c: "#5b3a1e" }, { x: x + 1, y, c: "#8b5a2b" });
  }
  const pad = meta.canopy === "Dense" ? 3 : meta.canopy === "Lush" ? 2 : 1;
  const leaf = (cx: number, cy: number) => {
    for (let dy = -pad; dy <= 0; dy++) {
      for (let dx = -pad - 1; dx <= pad + 1; dx++) {
        if (Math.abs(dx) + Math.abs(dy) > pad + 1) continue;
        pixels.push({ x: cx + dx, y: cy + dy, c: dy === -pad ? "#4ade80" : dy === 0 ? "#166534" : "#22c55e" });
      }
    }
  };
  for (let i = 0; i < meta.branches; i++) {
    const side = i % 2 === 0 ? -1 : 1;
    const y = 37 - i * 3;
    const length = 3 + (i % 3);
    for (let s = 1; s <= length; s++) pixels.push({ x: (side < 0 ? 31 : 32) + side * s, y: y - Math.floor(s / 2), c: "#6b4226" });
    leaf((side < 0 ? 31 : 32) + side * (length + 1), y - Math.floor(length / 2) - 1);
  }
  leaf(31, trunkTop - 1);
  return pixels;
}

export function MysteryPot({ tier, brewing = false, lucky = false }: Props) {
  const meta = TIERS[Math.max(0, Math.min(4, tier))]!;
  const [teaseIdx, setTeaseIdx] = useState(0);
  const [seal, setSeal] = useState(QUESTION);

  useEffect(() => {
    const interval = window.setInterval(() => setTeaseIdx((i) => (i + 1) % TEASES.length), 3500);
    return () => window.clearInterval(interval);
  }, []);

  useEffect(() => {
    if (!brewing) { setSeal(QUESTION); return; }
    const interval = window.setInterval(() => setSeal(scramble()), 140);
    return () => window.clearInterval(interval);
  }, [brewing]);

  const tree = useMemo(() => sapling(tier), [tier]);
  const glow = 0.35 + tier * 0.15;
  const particleCount = brewing ? 18 : 4 + tier * 3;
  const particles = useMemo(() => Array.from({ length: particleCount }, (_, i) => ({
    left: 12 + ((i * 37) % 76),
    delay: (i * 0.31) % 3.5,
    size: 2 + (i % 3),
  })), [particleCount]);

  const pot = meta.pot;
  const potRows = Array.from({ length: 11 }, (_, r) => {
    const inset = Math.floor(r / 4);
    return { y: 43 + r, x0: 18 + inset, x1: 45 - inset };
  });

  return (
    <div className="relative flex h-full w-full flex-col items-center justify-center gap-4">
      <style>{`
        @keyframes mp-pulse { 0%,100% { opacity: .55; transform: scale(1); } 50% { opacity: 1; transform: scale(1.06); } }
        @keyframes mp-float { 0% { transform: translateY(0) scale(1); opacity: 0; } 15% { opacity: 1; } 100% { transform: translateY(-110px) scale(.4); opacity: 0; } }
        @keyframes mp-pop { 0% { transform: scale(.92); opacity: .4; } 60% { transform: scale(1.03); opacity: 1; } 100% { transform: scale(1); } }
        @keyframes mp-sway { 0%,100% { transform: rotate(-1.2deg); } 50% { transform: rotate(1.2deg); } }
        @keyframes mp-shake { 0%,100% { transform: translateX(0); } 25% { transform: translateX(-1px) rotate(-.5deg); } 75% { transform: translateX(1px) rotate(.5deg); } }
        @keyframes mp-spin { to { transform: rotate(360deg); } }
        @media (prefers-reduced-motion: reduce) { .mp-anim, .mp-anim * { animation: none !important; } }
      `}</style>

      <div aria-hidden className="mp-anim pointer-events-none absolute inset-0 m-auto rounded-full transition-all duration-700"
        style={{
          width: `${55 + tier * 9}%`, height: `${55 + tier * 9}%`,
          background: `radial-gradient(circle, ${meta.aura}${Math.round(glow * 120).toString(16).padStart(2, "0")} 0%, transparent 65%)`,
          filter: `blur(${24 + tier * 6}px)`, animation: "mp-pulse 3.2s ease-in-out infinite",
        }} />

      {lucky && <div aria-hidden className="mp-anim pointer-events-none absolute inset-0 m-auto aspect-square w-[70%] rounded-full opacity-60"
        style={{
          background: "conic-gradient(from 0deg, #f472b6, #facc15, #4ade80, #38bdf8, #a78bfa, #f472b6)",
          filter: "blur(40px)", animation: "mp-spin 6s linear infinite",
        }} />}

      <div className="mp-anim pointer-events-none absolute inset-0 overflow-hidden">
        {particles.map((p, i) => (
          <span key={i} className="absolute bottom-[30%] rounded-full"
            style={{
              left: `${p.left}%`, width: p.size, height: p.size,
              background: i % 4 === 0 ? "#fef9c3" : meta.aura,
              boxShadow: `0 0 ${p.size * 3}px ${meta.aura}`,
              animation: `mp-float ${4 + (i % 3)}s ease-in ${p.delay}s infinite`,
            }} />
        ))}
      </div>

      <div key={tier} className="mp-anim relative z-10 w-full max-w-[340px]" style={{ animation: "mp-pop .45s ease-out" }}>
        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" className="aspect-square w-full pixelated"
          shapeRendering="crispEdges" role="img" aria-label={`Mystery ${meta.name} pot`}
          style={{ animation: brewing ? "mp-shake .6s ease-in-out infinite" : undefined }}>
          <g style={{ transformOrigin: "32px 41px", animation: `mp-sway ${brewing ? 1.2 : 4}s ease-in-out infinite` }}>
            {tree.map((p, i) => <rect key={i} x={p.x} y={p.y} width="1" height="1" fill={p.c} />)}
          </g>
          <rect x="19" y="40" width="26" height="1" fill="#3d2614" />
          <rect x="16" y="41" width="32" height="1" fill={shade(pot, 0.35)} />
          <rect x="16" y="42" width="32" height="1" fill={shade(pot, -0.25)} />
          {potRows.map((r) => (
            <g key={r.y}>
              <rect x={r.x0} y={r.y} width={r.x1 - r.x0 + 1} height="1" fill={r.y === 53 ? shade(pot, -0.4) : pot} />
              <rect x={r.x0} y={r.y} width="1" height="1" fill={shade(pot, -0.35)} />
              <rect x={r.x1} y={r.y} width="1" height="1" fill={shade(pot, 0.25)} />
            </g>
          ))}
          <rect x="22" y="54" width="3" height="1" fill={shade(pot, -0.45)} />
          <rect x="39" y="54" width="3" height="1" fill={shade(pot, -0.45)} />
          {seal.flatMap((row, y) => row.map((on, x) => on
            ? <rect key={`${x}-${y}`} x={29 + x} y={45 + y} width="1" height="1" fill="#e34234" />
            : null))}
        </svg>
      </div>

      <div className="z-10 flex w-full max-w-[340px] flex-col items-center gap-2 text-center">
        <div className="flex items-center gap-2">
          <span className="font-display text-lg" style={{ color: shade(meta.aura, 0.2) }}>{meta.name}</span>
          {lucky && <span className="rounded-full bg-amber-300/20 px-2 py-0.5 text-xs text-amber-200">Lucky bloom</span>}
        </div>
        <div className="flex gap-1" aria-label={`Tier ${tier + 1} of 5`}>
          {TIERS.map((t, i) => (
            <span key={t.name} className="h-2 w-6 rounded-sm transition-colors duration-500"
              style={{ background: i <= tier ? t.pot : "rgba(148,163,184,.2)" }} />
          ))}
        </div>
        <p className="text-xs text-slate-400">{meta.branches} branches · {meta.canopy.toLowerCase()} canopy · {meta.potName.toLowerCase()} pot</p>
        <p key={teaseIdx} className="min-h-[2.5rem] text-sm italic text-slate-400">{TEASES[teaseIdx]}</p>
      </div>
    </div>
  );
}
