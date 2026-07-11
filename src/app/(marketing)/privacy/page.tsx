import { Reveal } from "@/components/marketing/sections/reveal";

export const metadata = {
  title: "Privacy Policy",
  description: "How Rihla collects, uses, and protects your data.",
};

const sections = [
  {
    title: "1. Information We Collect",
    body: "We collect information you provide directly — such as your name, email, and business details when you book a demo or create an account — along with usage data generated as you use Rihla.",
  },
  {
    title: "2. How We Use Information",
    body: "We use your information to provide and improve the Rihla platform, communicate with you about your account, and, where you've opted in, share relevant product updates.",
  },
  {
    title: "3. Data Storage & Security",
    body: "Your data is encrypted in transit and at rest, stored on secure cloud infrastructure, and backed up regularly. Access is restricted to authorized personnel only.",
  },
  {
    title: "4. Data Sharing",
    body: "We do not sell your data. We share information only with service providers necessary to operate Rihla (such as payment processors) or when required by law.",
  },
  {
    title: "5. Your Rights",
    body: "You can request access to, correction of, or deletion of your personal data at any time by contacting our support team.",
  },
  {
    title: "6. Cookies",
    body: "We use cookies to keep you logged in and understand how our website is used, so we can improve it over time.",
  },
  {
    title: "7. Changes to This Policy",
    body: "We may update this policy periodically. We'll notify active customers of material changes.",
  },
  {
    title: "8. Contact Us",
    body: "Questions about this policy can be directed to our team through the Contact page.",
  },
];

export default function PrivacyPage() {
  return (
    <section className="section py-24 md:py-32">
      <Reveal className="mx-auto max-w-2xl text-center">
        <span className="eyebrow">Legal</span>
        <h1 className="mt-5 text-4xl font-semibold leading-tight md:text-5xl">Privacy Policy</h1>
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
