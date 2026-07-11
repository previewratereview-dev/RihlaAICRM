import { Heart, Target, Compass, Users } from "lucide-react";
import { Reveal } from "@/components/marketing/sections/reveal";
import { Card } from "@/components/marketing/ui/card";
import { CTABanner } from "@/components/marketing/sections/cta-banner";

export const metadata = {
  title: "About — Why We Built Rihla",
  description:
    "Rihla was built because travel businesses deserve better than spreadsheets. Learn our mission, story, and values.",
};

const values = [
  { icon: Heart, title: "Built for the people who love travel", body: "We design for the agents and operators who got into this industry for the trips, not the tools." },
  { icon: Target, title: "Outcomes over features", body: "We measure success by bookings converted and hours saved, not by how many buttons we ship." },
  { icon: Compass, title: "Travel-specific, always", body: "We'd rather do fewer things exceptionally well for travel than everything adequately for everyone." },
  { icon: Users, title: "Built with real operators", body: "Every feature is shaped by feedback from agencies, tour operators, and consultants actually using it." },
];

export default function AboutPage() {
  return (
    <>
      <section className="section py-24 md:py-32">
        <Reveal className="mx-auto max-w-3xl text-center">
          <span className="eyebrow">About Rihla</span>
          <h1 className="mt-5 text-4xl font-semibold leading-tight md:text-5xl">
            We built Rihla because travel businesses deserve better than spreadsheets.
          </h1>
        </Reveal>

        <Reveal delay={0.1} className="mx-auto mt-10 max-w-2xl space-y-5 text-ink-muted">
          <p>
            Travel is one of the most relationship-driven, detail-heavy industries there is — and
            for years, the software built for it treated that complexity like an afterthought.
            Agencies were stuck choosing between generic CRMs that don&rsquo;t understand a visa
            application or a supplier rate sheet, and travel tools that stopped at digital
            paperwork.
          </p>
          <p>
            Rihla exists to close that gap — with a CRM that understands travel from day one, and
            AI that actually does the repetitive work, not just talks about it. We built it for
            the people who got into this industry because they love travel, not spreadsheets.
          </p>
        </Reveal>

        <div className="mx-auto mt-16 grid max-w-4xl gap-8 md:grid-cols-2">
          <Reveal>
            <Card className="h-full">
              <h2 className="font-display text-lg font-medium">Our Mission</h2>
              <p className="mt-2 text-sm text-ink-muted">
                Give every travel business the operating system it deserves — so agents spend
                their time on trips, not tabs.
              </p>
            </Card>
          </Reveal>
          <Reveal delay={0.08}>
            <Card className="h-full">
              <h2 className="font-display text-lg font-medium">Our Vision</h2>
              <p className="mt-2 text-sm text-ink-muted">
                A world where no travel business loses a booking to a forgotten follow-up or a
                lost spreadsheet — where technology handles the busywork, and people handle the
                relationships.
              </p>
            </Card>
          </Reveal>
        </div>

        <Reveal delay={0.15} className="mx-auto mt-16 max-w-4xl">
          <h2 className="text-center font-display text-2xl font-semibold">Our Values</h2>
          <div className="mt-8 grid gap-5 sm:grid-cols-2">
            {values.map((v) => {
              const Icon = v.icon;
              return (
                <Card key={v.title} className="h-full">
                  <Icon size={20} className="text-[#C6FF3D]" />
                  <h3 className="mt-4 font-display text-base font-medium">{v.title}</h3>
                  <p className="mt-2 text-sm text-ink-muted">{v.body}</p>
                </Card>
              );
            })}
          </div>
        </Reveal>
      </section>
      <CTABanner />
    </>
  );
}
