import { AlertCircle, Clock, FolderX } from "lucide-react";
import { problem } from "@/lib/marketing/content";
import { Card } from "@/components/marketing/ui/card";
import { Reveal } from "@/components/marketing/sections/reveal";

const icons = [AlertCircle, Clock, FolderX];

export function Problem() {
  return (
    <section className="section py-24 md:py-32">
      <Reveal>
        <h2 className="max-w-2xl text-3xl font-semibold leading-tight md:text-4xl">
          {problem.headline}
        </h2>
      </Reveal>
      <Reveal delay={0.1}>
        <p className="mt-5 max-w-2xl text-ink-muted">{problem.body}</p>
      </Reveal>

      <div className="mt-12 grid gap-5 md:grid-cols-3">
        {problem.cards.map((card, i) => {
          const Icon = icons[i];
          return (
            <Reveal key={card.title} delay={0.15 + i * 0.08}>
              <Card className="h-full">
                <Icon size={20} className="text-accent" />
                <h3 className="mt-4 font-display text-lg font-medium">{card.title}</h3>
                <p className="mt-2 text-sm text-ink-muted">{card.body}</p>
              </Card>
            </Reveal>
          );
        })}
      </div>
    </section>
  );
}
