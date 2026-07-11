"use client";

import { useState } from "react";
import { Check, Minus, ChevronDown } from "lucide-react";
import { Reveal } from "@/components/marketing/sections/reveal";
import { Card } from "@/components/marketing/ui/card";
import { Button } from "@/components/marketing/ui/button";
import { cn } from "@/lib/utils";

const plans = [
  {
    name: "Starter",
    tagline: "Everything you need to manage your travel business.",
    price: "₹499",
    period: "/month",
    highlighted: false,
    badge: "",
    cta: "Start Free Trial",
    ctaVariant: "secondary" as const,
    features: [
      "Dashboard",
      "Bulk Import & Export",
      "Booking Management",
      "Booking Pipeline",
      "Past Travel Records",
      "Calendar & Meeting Scheduler",
      "Tasks & Reminders",
      "Customer Database",
      "Lead Management",
      "Booking Status Tracking",
      "Activity Timeline",
      "Basic Search & Filters",
      "Up to 10 Team Members",
    ],
  },
  {
    name: "Pro",
    tagline: "Everything in Starter, plus advanced analytics and permissions.",
    price: "₹799",
    period: "/month",
    highlighted: true,
    badge: "Most Popular",
    cta: "Get Started",
    ctaVariant: "primary" as const,
    features: [
      "Team Performance Dashboard",
      "AI Reports & Analytics",
      "Audit Logs",
      "Sales Reports",
      "Revenue Reports",
      "Team Productivity Metrics",
      "Advanced Filters",
      "Custom Views",
      "Booking Insights",
      "Customer Analytics",
      "Follow-up Tracking",
      "Role-Based Permissions",
      "Up to 20 Team Members",
    ],
  },
  {
    name: "Premium",
    tagline: "Everything in Pro, plus AI co-pilot and full integrations.",
    price: "₹1,599",
    period: "/month",
    highlighted: false,
    badge: "",
    cta: "Contact Sales",
    ctaVariant: "secondary" as const,
    features: [
      "AI Co-Pilot",
      "White Label / Rebranding",
      "Custom Branding",
      "Third-Party Integrations",
      "WhatsApp Integration",
      "Google Calendar Integration",
      "Google Meet Integration",
      "Payment Gateway Integration",
      "Email Integration",
      "API Access",
      "Workflow Automation",
      "Custom Automations",
      "Unlimited Team Members",
      "Priority Support",
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
    category: "Analytics & Reports",
    rows: [
      { feature: "Team Performance Dashboard", starter: false, pro: true, premium: true },
      { feature: "AI Reports & Analytics", starter: false, pro: true, premium: true },
      { feature: "Audit Logs", starter: false, pro: true, premium: true },
      { feature: "Sales Reports", starter: false, pro: true, premium: true },
      { feature: "Revenue Reports", starter: false, pro: true, premium: true },
      { feature: "Team Productivity Metrics", starter: false, pro: true, premium: true },
      { feature: "Booking Insights", starter: false, pro: true, premium: true },
      { feature: "Customer Analytics", starter: false, pro: true, premium: true },
    ],
  },
  {
    category: "Advanced Features",
    rows: [
      { feature: "Advanced Filters", starter: false, pro: true, premium: true },
      { feature: "Custom Views", starter: false, pro: true, premium: true },
      { feature: "Follow-up Tracking", starter: false, pro: true, premium: true },
      { feature: "Role-Based Permissions", starter: false, pro: true, premium: true },
      { feature: "AI Co-Pilot", starter: false, pro: false, premium: true },
      { feature: "White Label / Rebranding", starter: false, pro: false, premium: true },
      { feature: "Custom Branding", starter: false, pro: false, premium: true },
    ],
  },
  {
    category: "Integrations & Automations",
    rows: [
      { feature: "WhatsApp Integration", starter: false, pro: false, premium: true },
      { feature: "Google Calendar Integration", starter: false, pro: false, premium: true },
      { feature: "Google Meet Integration", starter: false, pro: false, premium: true },
      { feature: "Payment Gateway Integration", starter: false, pro: false, premium: true },
      { feature: "Email Integration", starter: false, pro: false, premium: true },
      { feature: "API Access", starter: false, pro: false, premium: true },
      { feature: "Workflow Automation", starter: false, pro: false, premium: true },
      { feature: "Custom Automations", starter: false, pro: false, premium: true },
    ],
  },
  {
    category: "Team & Support",
    rows: [
      { feature: "Team Members", starter: "Up to 10", pro: "Up to 20", premium: "Unlimited" },
      { feature: "Priority Support", starter: false, pro: false, premium: true },
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
        <div className="mx-auto mt-16 grid max-w-[1100px] items-start gap-6 md:grid-cols-3">
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
                  <span className="text-4xl font-semibold text-ink">{plan.price}</span>
                  <span className="text-sm text-ink-muted">{plan.period}</span>
                </div>

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
                  <>
                    <tr key={cat.category}>
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
                  </>
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
