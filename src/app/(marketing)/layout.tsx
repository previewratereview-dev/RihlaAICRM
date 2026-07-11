import { Navbar } from "@/components/marketing/layout/navbar";
import { Footer } from "@/components/marketing/layout/footer";

export const metadata = {
  title: {
    default: "Rihla by State AI — AI-Powered CRM for Travel Agencies",
    template: "%s | Rihla by State AI",
  },
  description:
    "Stop losing leads to spreadsheets and slow follow-ups. Rihla is the AI CRM built for travel agencies, tour operators, DMCs & visa consultants. Book a free demo.",
  openGraph: {
    title: "Rihla by State AI — AI-Powered CRM for Travel Agencies",
    description:
      "The AI-powered CRM built for travel agencies, tour operators, DMCs, and visa consultants.",
    siteName: "Rihla by State AI",
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
    title: "Rihla by State AI — AI-Powered CRM for Travel Agencies",
    description:
      "The AI-powered CRM built for travel agencies, tour operators, DMCs, and visa consultants.",
  },
};

export default function MarketingLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="font-[family-name:var(--font-dm-sans)]">
      <Navbar />
      <main>{children}</main>
      <Footer />
    </div>
  );
}
