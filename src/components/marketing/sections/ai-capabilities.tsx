import { Brain, MessageCircleReply, FileText, BellRing } from "lucide-react";
import { aiFeatures } from "@/lib/marketing/content";
import { Card } from "@/components/marketing/ui/card";
import { Reveal } from "@/components/marketing/sections/reveal";

const icons = [Brain, MessageCircleReply, FileText, BellRing];

export function AICapabilities() {
  return (
    <section className="relative overflow-hidden py-24 md:py-32">
      <div className="pointer-events-none absolute inset-0 bg-radial-glow" />
      <div className="section relative">
        <Reveal className="text-center">
          <span className="eyebrow">AI Capabilities</span>
          <h2 className="mx-auto mt-5 max-w-2xl text-3xl font-semibold leading-tight md:text-4xl">
            The parts of the job that eat your time —{" "}
            <span className="text-gradient">Rihla already handles them.</span>
          </h2>
        </Reveal>

        <div className="mt-12 grid gap-5 md:grid-cols-2">
          {aiFeatures.map((f, i) => {
            const Icon = icons[i];
            return (
              <Reveal key={f.title} delay={i * 0.08}>
                <Card strong className="h-full">
                  <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-ink">
                    <Icon size={18} className="text-white" />
                  </div>
                  <h3 className="mt-4 font-display text-lg font-medium">{f.title}</h3>
                  <p className="mt-2 text-sm text-ink-muted">{f.body}</p>
                </Card>
              </Reveal>
            );
          })}
        </div>

        <Reveal delay={0.3}>
          <p className="mx-auto mt-10 max-w-xl text-center text-sm italic text-ink-muted">
            This isn&rsquo;t AI for the sake of AI. It&rsquo;s the difference between a team of
            five working like a team of fifteen.
          </p>
        </Reveal>
      </div>
    </section>
  );
}
