import { CheckCircle2 } from "lucide-react";
import { benefits } from "@/lib/marketing/content";
import { Reveal } from "@/components/marketing/sections/reveal";

export function Benefits() {
  return (
    <section className="section py-24 md:py-32">
      <Reveal>
        <span className="eyebrow">Core Benefits</span>
        <h2 className="mt-5 max-w-2xl text-3xl font-semibold leading-tight md:text-4xl">
          What changes when your business runs on Rihla.
        </h2>
      </Reveal>

      <div className="mt-12 grid gap-x-10 gap-y-8 md:grid-cols-2">
        {benefits.map((b, i) => (
          <Reveal key={b.title} delay={i * 0.05} className="flex gap-4">
            <CheckCircle2 size={22} className="mt-0.5 shrink-0 text-accent" />
            <div>
              <h3 className="font-display text-base font-medium">{b.title}</h3>
              <p className="mt-1 text-sm text-ink-muted">{b.body}</p>
            </div>
          </Reveal>
        ))}
      </div>
    </section>
  );
}
