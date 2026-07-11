import { Hero } from "@/components/marketing/sections/hero";
import { TrustedBy } from "@/components/marketing/sections/trusted-by";
import { Problem } from "@/components/marketing/sections/problem";
import { ProductOverview } from "@/components/marketing/sections/product-overview";
import { DashboardPreview } from "@/components/marketing/sections/dashboard-preview";
import { FeatureGrid } from "@/components/marketing/sections/feature-grid";
import { AICapabilities } from "@/components/marketing/sections/ai-capabilities";
import { Benefits } from "@/components/marketing/sections/benefits";
import { Industries } from "@/components/marketing/sections/industries";
import { HowItWorks } from "@/components/marketing/sections/how-it-works";
import { Integrations } from "@/components/marketing/sections/integrations";
import { Testimonials } from "@/components/marketing/sections/testimonials";
import { Stats } from "@/components/marketing/sections/stats";
import { FAQ } from "@/components/marketing/sections/faq";
import { CTABanner } from "@/components/marketing/sections/cta-banner";

export default function MarketingHome() {
  return (
    <>
      <Hero />
      <TrustedBy />
      <Problem />
      <ProductOverview />
      <DashboardPreview />
      <FeatureGrid />
      <AICapabilities />
      <Benefits />
      <Industries />
      <HowItWorks />
      <Integrations />
      <Testimonials />
      <Stats />
      <FAQ />
      <CTABanner />
    </>
  );
}
