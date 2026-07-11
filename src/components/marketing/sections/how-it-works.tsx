import { howItWorks } from "@/lib/marketing/content";
import { Reveal } from "@/components/marketing/sections/reveal";

export function HowItWorks() {
  return (
    <section className="section py-24 md:py-32">
      <Reveal className="text-center">
        <span className="eyebrow">How It Works</span>
        <h2 className="mx-auto mt-5 max-w-2xl text-3xl font-semibold leading-tight md:text-4xl">
          From first inquiry to booked trip, in four steps.
        </h2>
      </Reveal>

      <div className="relative mt-14 grid gap-8 md:grid-cols-4">
        <div className="absolute left-0 right-0 top-5 hidden h-px bg-line md:block" />
        {howItWorks.map((step, i) => (
          <Reveal key={step.step} delay={i * 0.1} className="relative flex flex-col items-center text-center md:items-start md:text-left">
            <span className="relative z-10 flex h-10 w-10 items-center justify-center rounded-full bg-ink font-mono text-sm font-semibold text-white">
              {i + 1}
            </span>
            <h3 className="mt-4 font-display text-lg font-medium">{step.step}</h3>
            <p className="mt-2 text-sm text-ink-muted">{step.body}</p>
          </Reveal>
        ))}
      </div>
    </section>
  );
}
