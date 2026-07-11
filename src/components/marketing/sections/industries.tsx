import { Plane, Map, Building2, Stamp, Package, Users2 } from "lucide-react";
import { industries } from "@/lib/marketing/content";
import { Card } from "@/components/marketing/ui/card";
import { Button } from "@/components/marketing/ui/button";
import { Reveal } from "@/components/marketing/sections/reveal";

const icons = [Plane, Map, Building2, Stamp, Package, Users2];

export function Industries() {
  return (
    <section className="section py-24 md:py-32">
      <Reveal>
        <span className="eyebrow">Industries Served</span>
        <h2 className="mt-5 max-w-2xl text-3xl font-semibold leading-tight md:text-4xl">
          Built for how your part of the travel industry actually works.
        </h2>
      </Reveal>

      <div className="mt-12 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
        {industries.map((ind, i) => {
          const Icon = icons[i];
          return (
            <Reveal key={ind.title} delay={i * 0.06}>
              <Card className="h-full">
                <Icon size={20} className="text-accent" />
                <h3 className="mt-4 font-display text-base font-medium">{ind.title}</h3>
                <p className="mt-2 text-sm text-ink-muted">{ind.body}</p>
              </Card>
            </Reveal>
          );
        })}
      </div>

      <Reveal delay={0.2} className="mt-10 flex justify-center">
        <Button href="/pricing" variant="secondary">
          Find Your Industry
        </Button>
      </Reveal>
    </section>
  );
}
