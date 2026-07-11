import { Quote } from "lucide-react";
import { testimonials } from "@/lib/marketing/content";
import { Card } from "@/components/marketing/ui/card";
import { Reveal } from "@/components/marketing/sections/reveal";

export function Testimonials() {
  return (
    <section className="section py-24 md:py-32">
      <Reveal className="text-center">
        <span className="eyebrow">Customer Stories</span>
        <h2 className="mx-auto mt-5 max-w-2xl text-3xl font-semibold leading-tight md:text-4xl">
          Trusted by travel businesses that book more, chase less.
        </h2>
      </Reveal>

      <div className="mt-12 grid gap-5 md:grid-cols-3">
        {testimonials.map((t, i) => (
          <Reveal key={t.name} delay={i * 0.08}>
            <Card className="flex h-full flex-col">
              <Quote size={20} className="text-accent" />
              <p className="mt-4 flex-1 text-sm text-ink-muted">&ldquo;{t.quote}&rdquo;</p>
              <div className="mt-6 flex items-center gap-3">
                <div className="h-9 w-9 rounded-full bg-ink" />
                <div>
                  <p className="text-sm font-medium text-ink">{t.name}</p>
                  <p className="text-xs text-ink-faint">{t.company}</p>
                </div>
              </div>
            </Card>
          </Reveal>
        ))}
      </div>
    </section>
  );
}
