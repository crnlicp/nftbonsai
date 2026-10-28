import { Link } from "react-router-dom";
import { GrowingBonsaiShowcase } from "../components/GrowingBonsai";

export function Landing() {
  return (
    <div className="space-y-16">
      <section className="grid items-center gap-8 md:grid-cols-2">
        <div className="space-y-6">
          <h1 className="font-display text-4xl font-semibold leading-tight md:text-6xl">
            Grow a bonsai{" "}
            <span className="bg-gradient-to-r from-moss-300 to-cyan-300 bg-clip-text text-transparent">
              forever
            </span>
            .
          </h1>
          <p className="max-w-prose text-lg leading-relaxed text-slate-300">
            Pay with ICP, $BONSAI or card. Get a one-of-a-kind generative pixel-art bonsai NFT,
            minted in real time on the Internet Computer. Stored on-chain, owned by
            you. Card availability is limited to eligible US/EU buyers; provider fees apply.
          </p>
          <div className="flex flex-wrap gap-3">
            <Link to="/mint" className="btn-primary">Mint your bonsai →</Link>
            <Link to="/gallery" className="btn-ghost">Browse the grove</Link>
          </div>
        </div>

        <GrowingBonsaiShowcase />
      </section>

      <section className="grid gap-4 md:grid-cols-3">
        {[
          {
            title: "1. Pick a tier",
            body: "Sprout to Imperial. Every tree is unique; higher tiers add branches, denser canopies and rarer pots. 1 in 32 blooms a tier higher.",
          },
          {
            title: "2. Collect & trade",
            body: "Find a listed bonsai in the grove, or sell yours for ICP or $BONSAI. Prices are capped at 2x the original mint reference, with a 2% seller fee and no listing fee. Network fees apply.",
          },
          {
            title: "3. Own it. Share it.",
            body: "Your bonsai belongs to your Internet Identity principal. Keep it, list it, or send an unlisted tree to another valid principal from its details. Pending purchases stay recoverable.",
          },
        ].map((step) => (
          <article key={step.title} className="glass p-6">
            <h3 className="mb-2 font-display text-lg font-semibold text-moss-200">
              {step.title}
            </h3>
            <p className="text-sm leading-relaxed text-slate-300">{step.body}</p>
          </article>
        ))}
      </section>

      <section className="glass-strong p-8 text-center md:p-12">
        <h2 className="mb-3 font-display text-3xl font-semibold">Ready to grow yours?</h2>
        <p className="mx-auto mb-6 max-w-xl text-slate-300">
          Sign in with Internet Identity — no email, no password, just a passkey on
          this device. Then mint in three clicks.
        </p>
        <Link to="/mint" className="btn-primary">Start minting</Link>
      </section>

      <section className="glass space-y-3 p-6 md:p-8">
        <span className="text-xs font-medium uppercase tracking-widest text-moss-300">Meet $BONSAI</span>
        <h2 className="font-display text-2xl font-semibold">A token rooted in the grove</h2>
        <p className="max-w-3xl text-sm leading-relaxed text-slate-300">
          $BONSAI is our community token, launched on Soon. Mint with it for double the lucky-bloom odds,
          or use it to trade listed trees. Prefer ICP or card? Both remain available for minting;
          card eligibility and provider fees apply.
        </p>
        <Link to="/bonsai" className="btn-ghost">Explore the $BONSAI market</Link>
      </section>
    </div>
  );
}
