"use client";

import { useState } from "react";
import { dashboards } from "@/lib/marketing/content";
import { Reveal } from "@/components/marketing/sections/reveal";
import {
  PipelineMockup,
  InboxMockup,
  ItineraryMockup,
  AnalyticsMockup,
} from "@/components/marketing/sections/dashboard-mockups";
import { cn } from "@/lib/utils";

const mockupByKey: Record<string, React.ComponentType> = {
  pipeline: PipelineMockup,
  inbox: InboxMockup,
  itinerary: ItineraryMockup,
  analytics: AnalyticsMockup,
};

export function DashboardPreview() {
  const [active, setActive] = useState(dashboards[0].key);
  const ActiveMockup = mockupByKey[active];

  return (
    <section id="overview" className="section py-24 md:py-32">
      <Reveal>
        <span className="eyebrow">Product Preview</span>
        <h2 className="mt-5 max-w-2xl text-3xl font-semibold leading-tight md:text-4xl">
          See how it feels to run your business from one screen.
        </h2>
      </Reveal>

      <Reveal delay={0.1}>
        <div className="mt-8 flex flex-wrap gap-2">
          {dashboards.map((d) => (
            <button
              key={d.key}
              onClick={() => setActive(d.key)}
              className={cn(
                "rounded-full border px-4 py-2 text-sm font-medium transition-all duration-200",
                active === d.key
                  ? "border-ink/20 bg-ink text-white shadow-md"
                  : "border-ink/10 bg-white/80 text-ink-muted backdrop-blur-sm hover:text-ink hover:border-ink/20 hover:shadow-sm"
              )}
            >
              {d.label}
            </button>
          ))}
        </div>
      </Reveal>

      <Reveal delay={0.15} className="mt-8">
        <ActiveMockup />
        <p className="mt-4 text-sm text-ink-muted">
          {dashboards.find((d) => d.key === active)?.caption}
        </p>
      </Reveal>
    </section>
  );
}
