import { Reveal } from "@/components/marketing/sections/reveal";

export const metadata = {
  title: "Terms of Service",
  description: "The terms that govern your use of Rihla.",
};

const sections = [
  {
    title: "1. Acceptance of Terms",
    body: "By accessing or using Rihla, you agree to be bound by these Terms of Service and our Privacy Policy.",
  },
  {
    title: "2. Use of the Service",
    body: "You may use Rihla only for lawful business purposes and in accordance with these terms. You are responsible for the accuracy of data your team enters into the platform.",
  },
  {
    title: "3. Account Responsibilities",
    body: "You are responsible for maintaining the confidentiality of your account credentials and for all activity under your account.",
  },
  {
    title: "4. Subscription & Billing",
    body: "Plans are billed monthly or annually as selected. You may upgrade, downgrade, or cancel your subscription at any time through your account settings.",
  },
  {
    title: "5. Data Ownership",
    body: "You retain ownership of all data you input into Rihla. We do not claim ownership of your business or customer data.",
  },
  {
    title: "6. AI Features",
    body: "AI-generated drafts, suggestions, and content are provided as assistance and should be reviewed before use. Rihla is not responsible for AI outputs sent without review, where auto-send has been enabled by your team.",
  },
  {
    title: "7. Limitation of Liability",
    body: "Rihla is provided \"as is.\" To the extent permitted by law, we are not liable for indirect or consequential damages arising from use of the platform.",
  },
  {
    title: "8. Termination",
    body: "We may suspend or terminate accounts that violate these terms. You may cancel your account at any time.",
  },
  {
    title: "9. Changes to These Terms",
    body: "We may update these terms from time to time. Continued use of Rihla after changes constitutes acceptance of the updated terms.",
  },
  {
    title: "10. Contact",
    body: "Questions about these terms can be directed to our team through the Contact page.",
  },
];

export default function TermsPage() {
  return (
    <section className="section py-24 md:py-32">
      <Reveal className="mx-auto max-w-2xl text-center">
        <span className="eyebrow">Legal</span>
        <h1 className="mt-5 text-4xl font-semibold leading-tight md:text-5xl">Terms of Service</h1>
        <p className="mt-4 text-sm text-ink-faint">Last updated: [Month, Year]</p>
      </Reveal>

      <Reveal delay={0.1} className="mx-auto mt-14 max-w-2xl space-y-8">
        {sections.map((s) => (
          <div key={s.title}>
            <h2 className="font-display text-lg font-medium">{s.title}</h2>
            <p className="mt-2 text-sm text-ink-muted">{s.body}</p>
          </div>
        ))}
      </Reveal>
    </section>
  );
}
