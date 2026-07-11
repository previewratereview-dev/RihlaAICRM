import { stats } from "@/lib/marketing/content";
import { AnimatedCounter } from "@/components/marketing/ui/animated-counter";
import { Reveal } from "@/components/marketing/sections/reveal";

export function Stats() {
  return (
    <section className="border-y border-line bg-white py-20">
      <div className="section grid grid-cols-1 gap-10 text-center sm:grid-cols-3">
        {stats.map((s, i) => (
          <Reveal key={s.label} delay={i * 0.1}>
            <p className="font-display text-4xl font-bold text-ink md:text-5xl">
              <AnimatedCounter value={s.value} suffix={s.suffix} />
            </p>
            <p className="mt-2 text-sm text-ink-muted">{s.label}</p>
          </Reveal>
        ))}
      </div>
    </section>
  );
}
