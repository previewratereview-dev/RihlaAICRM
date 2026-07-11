import { integrations } from "@/lib/marketing/content";
import { Reveal } from "@/components/marketing/sections/reveal";
import { Plug } from "lucide-react";

export function Integrations() {
  return (
    <section className="section py-24 md:py-32">
      <Reveal className="text-center">
        <span className="eyebrow">Integrations</span>
        <h2 className="mx-auto mt-5 max-w-2xl text-3xl font-semibold leading-tight md:text-4xl">
          Works with the tools you already use.
        </h2>
      </Reveal>

      <Reveal delay={0.1}>
        <div className="mt-12 flex flex-wrap items-center justify-center gap-4">
          {integrations.map((tool) => (
            <div
              key={tool}
              className="glass flex items-center gap-2 px-5 py-3 text-sm font-medium text-ink-muted"
            >
              <Plug size={14} className="text-accent" />
              {tool}
            </div>
          ))}
        </div>
      </Reveal>
    </section>
  );
}
