import { ArrowRight } from "lucide-react";
import { finalCta } from "@/lib/marketing/content";
import { Button } from "@/components/marketing/ui/button";
import { Reveal } from "@/components/marketing/sections/reveal";

export function CTABanner() {
  return (
    <section className="section py-16 md:py-24">
      <Reveal>
        <div className="relative overflow-hidden rounded-3xl bg-ink px-8 py-16 text-center md:px-16">
          <div className="pointer-events-none absolute inset-0" style={{ background: "radial-gradient(circle at top, rgba(198,255,61,0.15), transparent 60%)" }} />
          <div className="relative">
            <h2 className="mx-auto max-w-2xl text-3xl font-semibold leading-tight text-white md:text-4xl">
              {finalCta.headline}
            </h2>
            <p className="mx-auto mt-4 max-w-xl text-white/70">{finalCta.subheading}</p>
            <div className="mt-8 flex flex-col items-center justify-center gap-4 sm:flex-row">
              <Button
                href={finalCta.primaryCta.href}
                className="btn-lime"
              >
                {finalCta.primaryCta.label}
                <ArrowRight size={16} />
              </Button>
              <Button
                href={finalCta.secondaryCta.href}
                className="!border-white/20 !bg-white/10 !text-white hover:!bg-white/20"
              >
                {finalCta.secondaryCta.label}
              </Button>
            </div>
          </div>
        </div>
      </Reveal>
    </section>
  );
}
