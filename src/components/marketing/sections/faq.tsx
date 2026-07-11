"use client";

import { useState } from "react";
import { ChevronDown } from "lucide-react";
import { faqHome } from "@/lib/marketing/content";
import { Button } from "@/components/marketing/ui/button";
import { Reveal } from "@/components/marketing/sections/reveal";
import { cn } from "@/lib/utils";

function FaqItem({ q, a }: { q: string; a: string }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="glass overflow-hidden">
      <button
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="flex w-full items-center justify-between px-6 py-5 text-left"
      >
        <span className="font-medium text-ink">{q}</span>
        <ChevronDown
          size={18}
          className={cn("shrink-0 text-ink-muted transition-transform duration-300", open && "rotate-180")}
        />
      </button>
      <div
        className={cn(
          "grid transition-all duration-300 ease-in-out",
          open ? "grid-rows-[1fr] opacity-100" : "grid-rows-[0fr] opacity-0"
        )}
      >
        <div className="overflow-hidden px-6">
          <p className="pb-5 text-sm text-ink-muted">{a}</p>
        </div>
      </div>
    </div>
  );
}

export function FAQ() {
  return (
    <section className="section py-24 md:py-32">
      <Reveal className="text-center">
        <span className="eyebrow">FAQ</span>
        <h2 className="mx-auto mt-5 max-w-2xl text-3xl font-semibold leading-tight md:text-4xl">
          Questions, answered.
        </h2>
      </Reveal>

      <div className="mx-auto mt-12 max-w-2xl space-y-3">
        {faqHome.map((item, i) => (
          <Reveal key={item.q} delay={i * 0.05}>
            <FaqItem q={item.q} a={item.a} />
          </Reveal>
        ))}
      </div>


    </section>
  );
}
