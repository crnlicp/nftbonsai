import { useEffect, useState, type KeyboardEvent } from "react";
import { SLIDER_MAX, TIERS, amountToSlider, sliderToAmount, tierOf } from "../lib/tiers";

// How a payment unit is shown: "€49", "19 ICP", "9,000 BONSAI". `step` is the keyboard and slider granularity.
export interface PriceUnit {
  code: string;
  prefix?: string;
  suffix?: string;
  step: number;
}

interface Props {
  anchors: number[];
  value: number;
  onChange: (amount: number) => void;
  unit: PriceUnit;
  disabled?: boolean;
}

export function formatAmount(amount: number, unit: PriceUnit, compact = false): string {
  const n = compact && amount >= 1000 && amount % 1000 === 0 ? `${(amount / 1000).toLocaleString("en-US")}k` : amount.toLocaleString("en-US");
  return unit.prefix ? `${unit.prefix}${n}` : `${n} ${unit.suffix ?? unit.code}`;
}

// Slider positions this close to a tier anchor snap onto it, so thresholds are easy to hit.
const SNAP = 12;

export function PricePicker({ anchors, value, onChange, unit, disabled }: Props) {
  const min = anchors[0]!, max = anchors[anchors.length - 1]!;
  const tier = tierOf(value, anchors);
  const meta = TIERS[tier]!;
  const next = anchors[tier + 1];
  const [draft, setDraft] = useState(String(value));
  useEffect(() => setDraft(String(value)), [value]);

  const position = amountToSlider(value, anchors);
  const digits = String(max).length;
  const snap = (n: number) => Math.max(min, Math.min(max, Math.round(n / unit.step) * unit.step || min));
  const stops = anchors.map((_, i) => (i * SLIDER_MAX) / (anchors.length - 1));

  function fromSlider(raw: number) {
    const near = stops.findIndex((s) => Math.abs(s - raw) <= SNAP);
    onChange(near >= 0 ? anchors[near]! : snap(sliderToAmount(raw, anchors)));
  }
  // Keyboard steps in whole units; snapping is only for pointer drags, where it would otherwise trap arrow keys at anchors.
  function onSliderKey(e: KeyboardEvent<HTMLInputElement>) {
    const delta: Record<string, number> = { ArrowRight: 1, ArrowUp: 1, ArrowLeft: -1, ArrowDown: -1, PageUp: 10, PageDown: -10 };
    let target: number | undefined;
    if (e.key in delta) target = value + delta[e.key]! * unit.step;
    else if (e.key === "Home") target = min;
    else if (e.key === "End") target = max;
    if (target === undefined) return;
    e.preventDefault();
    onChange(Math.max(min, Math.min(max, target)));
  }
  function commitDraft() {
    const n = Math.round(Number(draft));
    if (!Number.isFinite(n) || draft.trim() === "") return setDraft(String(value));
    const clamped = Math.max(min, Math.min(max, n));
    onChange(clamped);
    setDraft(String(clamped));
  }

  const track = TIERS.slice(0, anchors.length - 1)
    .map((t, i) => `${t.pot} ${(stops[i]! / SLIDER_MAX) * 100}% ${(stops[i + 1]! / SLIDER_MAX) * 100}%`).join(", ");
  const fill = (position / SLIDER_MAX) * 100;

  return (
    <div className="space-y-3">
      <div className="flex items-end justify-between gap-3">
        <label className="flex min-w-0 items-baseline gap-1 font-display text-4xl" htmlFor="price-amount">
          {unit.prefix && <span className="text-slate-400">{unit.prefix}</span>}
          <input id="price-amount" aria-label={`Exact price in ${unit.code}`} inputMode="numeric" value={draft} disabled={disabled} aria-describedby="price-hint"
            onChange={(e) => setDraft(e.target.value.replace(/[^\d]/g, "").slice(0, digits))}
            onBlur={commitDraft} onKeyDown={(e) => { if (e.key === "Enter") commitDraft(); }}
            style={{ width: `${Math.max(2, digits) + 0.5}ch` }}
            className="border-b border-white/20 bg-transparent text-slate-50 outline-none focus:border-white/60" />
          {!unit.prefix && <span className="text-base font-semibold text-slate-400">{unit.suffix ?? unit.code}</span>}
        </label>
        <div className="text-right">
          <span className="inline-block rounded-full px-3 py-1 text-sm font-semibold"
            style={{ background: `${meta.aura}26`, color: meta.aura, boxShadow: `inset 0 0 0 1px ${meta.aura}55` }}>{meta.name}</span>
        </div>
      </div>

      <div className="relative">
        <div aria-hidden className="pointer-events-none absolute inset-x-3 top-1/2 h-2 -translate-y-1/2 overflow-hidden rounded-full"
          style={{ background: `linear-gradient(90deg, ${track})`, opacity: 0.35 }} />
        <div aria-hidden className="pointer-events-none absolute left-3 top-1/2 h-2 -translate-y-1/2 rounded-full transition-[width] duration-100"
          style={{ width: `calc((100% - 1.5rem) * ${fill / 100})`, background: `linear-gradient(90deg, ${track})`, backgroundSize: `${10_000 / Math.max(fill, 0.5)}% 100%` }} />
        <input type="range" className="price-range" min={0} max={SLIDER_MAX} step={1} value={position} disabled={disabled}
          aria-label={`Price in ${unit.code}`} aria-valuetext={`${formatAmount(value, unit)}, ${meta.name} tier`}
          style={{ ["--thumb" as string]: meta.aura }}
          onKeyDown={onSliderKey}
          onChange={(e) => fromSlider(Number(e.target.value))} />
      </div>

      <div className="relative h-9 mx-3">
        {anchors.map((anchor, i) => (
          <button key={anchor} type="button" disabled={disabled} onClick={() => onChange(anchor)}
            className={`absolute top-0 -translate-x-1/2 text-center text-[11px] leading-tight transition ${i === tier ? "text-slate-50" : "text-slate-400 hover:text-slate-200"}`}
            style={{ left: `${(stops[i]! / SLIDER_MAX) * 100}%` }} aria-label={`${TIERS[i]!.name} from ${formatAmount(anchor, unit)}`}>
            <span aria-hidden className="mx-auto mb-0.5 block h-1.5 w-1.5 rounded-full" style={{ background: i <= tier ? TIERS[i]!.aura : "#475569" }} />
            <span className="block font-semibold">{TIERS[i]!.name}</span>
            <span className="block whitespace-nowrap">{formatAmount(anchor, unit, true)}</span>
          </button>
        ))}
      </div>

      <p id="price-hint" className="text-xs text-slate-400">
        {meta.branches} branches · {meta.canopy.toLowerCase()} canopy · {meta.potName.toLowerCase()} pot
        {next !== undefined
          ? <> · <button type="button" className="underline decoration-dotted hover:text-slate-200" disabled={disabled}
              onClick={() => onChange(next)}>+{formatAmount(next - value, unit)} for {TIERS[tier + 1]!.name}</button></>
          : <> · top tier</>}
      </p>
    </div>
  );
}
