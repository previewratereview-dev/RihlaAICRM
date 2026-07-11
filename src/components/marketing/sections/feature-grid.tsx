import {
  Users,
  GitBranch,
  Package,
  Map,
  Receipt,
  MessageSquare,
} from "lucide-react";
import { features } from "@/lib/marketing/content";
import { Card } from "@/components/marketing/ui/card";
import { Button } from "@/components/marketing/ui/button";
import { Reveal } from "@/components/marketing/sections/reveal";

const icons = [Users, GitBranch, Package, Map, Receipt, MessageSquare];

export function FeatureGrid() {
  return (
    <section className="section py-24 md:py-32">
      <Reveal>
        <span className="eyebrow">Key Features</span>
        <h2 className="mt-5 max-w-2xl text-3xl font-semibold leading-tight md:text-4xl">
          Everything your travel business runs on, in one place.
        </h2>
      </Reveal>

      <div className="mt-12 grid gap-5 md:grid-cols-2 lg:grid-cols-3">
        {features.map((f, i) => {
          const Icon = icons[i];
          return (
            <Reveal key={f.title} delay={i * 0.06}>
              <Card className="h-full transition-colors hover:bg-surface-strong">
                <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-accent/10">
                  <Icon size={18} className="text-accent" />
                </div>
                <h3 className="mt-4 font-display text-lg font-medium">{f.title}</h3>
                <p className="mt-2 text-sm text-ink-muted">{f.body}</p>
              </Card>
            </Reveal>
          );
        })}
      </div>

      
    </section>
  );
}
