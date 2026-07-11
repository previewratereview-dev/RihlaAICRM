"use client";

import { Fragment, useState } from "react";
import { Check, Minus, ChevronDown } from "lucide-react";
import { Reveal } from "@/components/marketing/sections/reveal";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/marketing/ui/button";
import { cn } from "@/lib/utils";

type BillingPeriod = "monthly" | "yearly";

const plans = [
  {
    name: "Starter",
    tagline: "Everything you need to manage your travel business.",
    highlighted: false,
    badge: "",
    cta: "Start Free Trial",
    ctaVariant: "secondary" as const,
    pricing: {
      monthly: { price: "₹999", period: "/month" },
      yearly: {
        price: "₹9,990",
        period: "/year",
        monthlyEquivalent: "~₹833/mo",
        savings: "Save ₹1,998/year",
      },
    },
    features: [
      "Up to 5 team members",
      "10 GB storage",
      "2,000 AI calls/month",
      "Custom AI provider keys",
      "Custom branding (logo, colors)",
      "Email support",
    ],
  },
  {
    name: "Pro",
    tagline: "Everything in Starter, plus advanced analytics and permissions.",
    highlighted: true,
    badge: "Most Popular",
    cta: "Get Started",
    ctaVariant: "primary" as const,
    pricing: {
      monthly: { price: "₹2,499", period: "/month" },
      yearly: {
        price: "₹24,990",
        period: "/year",
        monthlyEquivalent: "~₹2,083/mo",
        savings: "Save ₹4,998/year",
      },
    },
    features: [
      "Up to 20 team members",
      "50 GB storage",
      "20,000 AI calls/month",
      "Multi-provider AI support",
      "Advanced analytics & reports",
      "Custom branding + banner images",
      "Custom email templates",
      "Priority support",
    ],
  },
  {
    name: "Premium",
    tagline: "Everything in Pro, plus AI co-pilot and full integrations.",
    highlighted: false,
    badge: "",
    cta: "Contact Sales",
    ctaVariant: "secondary" as const,
    pricing: {
      monthly: { price: "₹4,999", period: "/month" },
      yearly: {
        price: "₹49,990",
        period: "/year",
        monthlyEquivalent: "~₹4,166/mo",
        savings: "Save ₹9,998/year",
      },
    },
    features: [
      "Up to 50 team members",
      "200 GB storage",
      "100,000 AI calls/month",
      "Platform-managed AI (premium models)",
      "White-label login page",
      "Remove \"Powered by\" branding",
      "Custom email templates",
      "Dedicated account manager",
    ],
  },
];

const comparisonCategories = [
  {
    category: "Core Features",
    rows: [
      { feature: "Dashboard", starter: true, pro: true, premium: true },
      { feature: "Bulk Import & Export", starter: true, pro: true, premium: true },
      { feature: "Booking Management", starter: true, pro: true, premium: true },
      { feature: "Booking Pipeline", starter: true, pro: true, premium: true },
      { feature: "Past Travel Records", starter: true, pro: true, premium: true },
      { feature: "Calendar & Meeting Scheduler", starter: true, pro: true, premium: true },
      { feature: "Tasks & Reminders", starter: true, pro: true, premium: true },
      { feature: "Customer Database", starter: true, pro: true, premium: true },
      { feature: "Lead Management", starter: true, pro: true, premium: true },
      { feature: "Booking Status Tracking", starter: true, pro: true, premium: true },
      { feature: "Activity Timeline", starter: true, pro: true, premium: true },
      { feature: "Basic Search & Filters", starter: true, pro: true, premium: true },
    ],
  },
  {
    category: "AI & Analytics",
    rows: [
      { feature: "Custom AI provider keys", starter: true, pro: true, premium: true },
      { feature: "Multi-provider AI support", starter: false, pro: true, premium: true },
      { feature: "Platform-managed AI (premium models)", starter: false, pro: false, premium: true },
      { feature: "Advanced analytics & reports", starter: false, pro: true, premium: true },
      { feature: "Audit Logs", starter: false, pro: true, premium: true },
      { feature: "Sales Reports", starter: false, pro: true, premium: true },
      { feature: "Revenue Reports", starter: false, pro: true, premium: true },
      { feature: "Team Productivity Metrics", starter: false, pro: true, premium: true },
      { feature: "Booking Insights", starter: false, pro: true, premium: true },
      { feature: "Customer Analytics", starter: false, pro: true, premium: true },
      { feature: "Custom email templates", starter: false, pro: true, premium: true },
      { feature: "Priority support", starter: false, pro: true, premium: true },
    ],
  },
  {
    category: "Branding & Automation",
    rows: [
      { feature: "Custom branding (logo, colors)", starter: true, pro: true, premium: true },
      { feature: "Custom branding + banner images", starter: false, pro: true, premium: true },
      { feature: "White label / rebranding", starter: false, pro: false, premium: true },
      { feature: "Remove \"Powered by\" branding", starter: false, pro: false, premium: true },
      { feature: "Workflow automation", starter: false, pro: false, premium: true },
      { feature: "Custom automations", starter: false, pro: false, premium: true },
      { feature: "Dedicated account manager", starter: false, pro: false, premium: true },
    ],
  },
  {
    category: "Integrations",
    rows: [
      { feature: "WhatsApp integration", starter: false, pro: false, premium: true },
      { feature: "Google Calendar integration", starter: false, pro: false, premium: true },
      { feature: "Google Meet integration", starter: false, pro: false, premium: true },
      { feature: "Payment gateway integration", starter: false, pro: false, premium: true },
      { feature: "Email integration", starter: false, pro: false, premium: true },
      { feature: "API access", starter: false, pro: false, premium: true },
    ],
  },
  {
    category: "Team & Support",
    rows: [
      { feature: "Team Members", starter: "Up to 5", pro: "Up to 20", premium: "Up to 50" },
      { feature: "Priority support", starter: false, pro: true, premium: true },
    ],
  },
];

const pricingFaqs = [
  { q: "Can I change my plan later?", a: "Yes, you can upgrade or downgrade your plan at any time. Changes take effect immediately, and we'll prorate the difference." },
  { q: "Is there a free trial?", a: "Yes, every plan comes with a 14-day free trial. No credit card required to start." },
  { q: "What payment methods are supported?", a: "We accept all major credit and debit cards, UPI, net banking, and popular wallets through our secure payment gateway." },
  { q: "Is my data secure?", a: "Absolutely. We use bank-grade encryption, regular security audits, and SOC 2 compliant infrastructure to keep your data safe." },
  { q: "Can I cancel anytime?", a: "Yes, cancel anytime with no questions asked. Your access continues until the end of your current billing cycle." },
  { q: "Do you provide onboarding?", a: "Yes, every plan includes a guided onboarding session. Pro and Premium plans get dedicated onboarding support." },
  { q: "Do you offer support?", a: "All plans include email support. Pro plans get priority email support, and Premium plans include 24/7 priority support." },
  { q: "Can I migrate from another CRM?", a: "Yes, we provide free data migration support. Import your leads, bookings, and customer data from spreadsheets or other CRMs." },
];

function CellValue({ value }: { value: boolean | string }) {
  if (value === true) return <Check size={16} className="mx-auto text-[#C6FF3D]" />;
  if (value === false) return <Minus size={16} className="mx-auto text-ink-faint" />;
  return <span className="text-xs font-medium text-ink">{value}</span>;
}

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
          className={cn(
            "shrink-0 text-ink-muted transition-transform duration-300",
            open && "rotate-180"
          )}
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

export default function PricingPage() {
  const [billingPeriod, setBillingPeriod] = useState<BillingPeriod>("monthly");

  return (
    <>
      <section className="section py-24 md:py-32">
        {/* Header */}
        <Reveal className="text-center">
          <span className="eyebrow">Pricing</span>
          <h1 className="mx-auto mt-5 max-w-3xl text-4xl font-semibold leading-tight md:text-5xl">
            Pricing that grows with your agency, not against it.
          </h1>
          <p className="mx-auto mt-5 max-w-2xl text-ink-muted">
            Simple, transparent pricing for travel agencies, tour operators, and DMCs. Pick the plan
            that matches your team.
          </p>
        </Reveal>

        {/* Pricing Cards */}
        <Reveal className="flex justify-center">
          <Tabs
            value={billingPeriod}
            onValueChange={(value) => setBillingPeriod(value as BillingPeriod)}
            className="w-full max-w-[380px]"
          >
            <TabsList className="h-10 p-1" aria-label="Billing period">
              <TabsTrigger value="monthly" className="px-6">
                Monthly
              </TabsTrigger>
              <TabsTrigger value="yearly" className="px-6 gap-2">
                Yearly
                <span className="text-[10px] font-bold uppercase tracking-wide text-emerald-600 bg-emerald-50 px-1.5 py-0.5 rounded">
                  2 mo free
                </span>
              </TabsTrigger>
            </TabsList>
          </Tabs>
        </Reveal>

        <div className="mx-auto mt-10 grid max-w-[1100px] items-start gap-6 md:grid-cols-3">
          {plans.map((plan, i) => (
            <Reveal key={plan.name} delay={i * 0.08}>
              <div
                className={cn(
                  "relative flex h-full flex-col overflow-hidden rounded-2xl border bg-white p-7 transition-all duration-300",
                  plan.highlighted
                    ? "border-[#C6FF3D]/40 shadow-hero-card md:-mt-4 md:mb-4 md:scale-[1.03]"
                    : "border-line shadow-card hover:shadow-hero-card"
                )}
              >
                {/* Glow effect for highlighted plan */}
                {plan.highlighted && (
                  <div className="pointer-events-none absolute inset-0 rounded-2xl"
                    style={{
                      background: "radial-gradient(ellipse at top, rgba(198,255,61,0.1), transparent 60%)",
                    }}
                  />
                )}

                {/* Badge */}
                {plan.badge && (
                  <span
                    className="mb-4 w-fit rounded-full px-4 py-1.5 text-xs font-bold"
                    style={{ backgroundColor: "#C6FF3D", color: "#111111" }}
                  >
                    {plan.badge}
                  </span>
                )}

                {/* Plan name & description */}
                <h2 className="relative text-lg font-semibold text-ink">{plan.name}</h2>
                <p className="relative mt-2 text-sm text-ink-muted">{plan.tagline}</p>

                {/* Price */}
                <div className="relative mt-6 flex items-baseline gap-1">
                  <span className="text-4xl font-semibold text-ink">{plan.pricing[billingPeriod].price}</span>
                  <span className="text-sm text-ink-muted">{plan.pricing[billingPeriod].period}</span>
                </div>
                {billingPeriod === "yearly" && plan.pricing[billingPeriod].monthlyEquivalent ? (
                  <p className="mt-2 text-xs text-ink-muted">
                    {plan.pricing[billingPeriod].monthlyEquivalent} billed annually
                  </p>
                ) : null}

                {/* Divider */}
                <div className="relative my-6 h-px w-full rounded-full" style={{ backgroundColor: "rgba(198,255,61,0.3)" }} />

                {/* Feature list */}
                <ul className="relative flex-1 space-y-3">
                  {plan.features.map((f) => (
                    <li key={f} className="flex items-start gap-2.5 text-sm text-ink-muted">
                      <span
                        className="mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-full"
                        style={{ backgroundColor: "rgba(198,255,61,0.18)" }}
                      >
                        <Check size={10} className="text-ink" strokeWidth={2.5} />
                      </span>
                      <span>{f}</span>
                    </li>
                  ))}
                </ul>

                {/* CTA */}
                <div className="relative mt-8">
                  <Button
                    href="/register"
                    variant={plan.ctaVariant}
                    className={cn(
                      "w-full",
                      plan.highlighted && "!bg-ink !text-white hover:!bg-ink/90"
                    )}
                  >
                    {plan.cta}
                  </Button>
                </div>
              </div>
            </Reveal>
          ))}
        </div>

        {/* Comparison Table */}
        <Reveal delay={0.2} className="mx-auto mt-24 max-w-[1100px]">
          <h2 className="text-center text-2xl font-semibold">Compare all features</h2>
          <div className="mt-10 overflow-x-auto">
            <table className="w-full min-w-[680px] border-collapse">
              <thead>
                <tr className="border-b border-line text-left">
                  <th className="py-4 pr-4 text-sm font-medium text-ink-muted">Feature</th>
                  <th className="py-4 text-center text-sm font-medium text-ink-muted">Starter</th>
                  <th className="py-4 text-center text-sm font-bold text-ink">Pro</th>
                  <th className="py-4 text-center text-sm font-medium text-ink-muted">Premium</th>
                </tr>
              </thead>
              <tbody>
                {comparisonCategories.map((cat) => (
                  <Fragment key={cat.category}>
                    <tr>
                      <td colSpan={4} className="pb-2 pt-6 text-xs font-bold uppercase tracking-wider text-ink">
                        {cat.category}
                      </td>
                    </tr>
                    {cat.rows.map((row) => (
                      <tr key={row.feature} className="border-b border-line/50">
                        <td className="py-3.5 pr-4 text-sm text-ink-muted">{row.feature}</td>
                        <td className="py-3.5 text-center"><CellValue value={row.starter} /></td>
                        <td className="py-3.5 text-center"><CellValue value={row.pro} /></td>
                        <td className="py-3.5 text-center"><CellValue value={row.premium} /></td>
                      </tr>
                    ))}
                  </Fragment>
                ))}
              </tbody>
            </table>
          </div>
        </Reveal>

        {/* FAQ */}
        <Reveal delay={0.25} className="mx-auto mt-24 max-w-2xl">
          <h2 className="text-center text-2xl font-semibold">Frequently asked questions</h2>
          <div className="mt-10 space-y-3">
            {pricingFaqs.map((faq, i) => (
              <Reveal key={faq.q} delay={i * 0.03}>
                <FaqItem q={faq.q} a={faq.a} />
              </Reveal>
            ))}
          </div>
        </Reveal>
      </section>

      {/* Final CTA */}
      <section className="section pb-24 md:pb-32">
        <Reveal>
          <div className="relative overflow-hidden rounded-3xl bg-ink px-8 py-16 text-center md:px-16">
            <div
              className="pointer-events-none absolute inset-0"
              style={{
                background:
                  "radial-gradient(circle at top, rgba(198,255,61,0.15), transparent 60%)",
              }}
            />
            <div className="relative">
              <h2 className="mx-auto max-w-2xl text-3xl font-semibold leading-tight text-white md:text-4xl">
                Ready to Grow Your Travel Business?
              </h2>
              <p className="mx-auto mt-4 max-w-xl text-white/70">
                Join travel agencies using AI to manage bookings, automate operations, and increase revenue.
              </p>
              <div className="mt-8 flex flex-col items-center justify-center gap-4 sm:flex-row">
                <Button
                  href="/register"
                  className="btn-lime"
                >
                  Start Free Trial
                </Button>
                <Button
                  href="/register"
                  className="!border-white/20 !bg-white/10 !text-white hover:!bg-white/20"
                >
                  Book a Demo
                </Button>
              </div>
            </div>
          </div>
        </Reveal>
      </section>
    </>
  );
}
