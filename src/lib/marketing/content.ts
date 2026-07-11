// Central copy source. Components read from here so design and content
// stay decoupled — update messaging in one place without touching JSX.

export const nav = {
  logo: "Rihla by State AI",
  links: [
    { label: "Home", href: "/" },
    { label: "Product Overview", href: "/#product-overview" },
    { label: "Pricing", href: "/pricing" },
    { label: "About", href: "/about" },
  ],
  cta: { label: "Book a Demo", href: "/pricing" },
};

export const hero = {
  eyebrow: "AI-Powered CRM for Travel Businesses",
  headline: "Run your travel business without losing a single lead.",
  subheading:
    "Rihla is the AI-powered CRM built for travel agencies, tour operators, DMCs, and visa consultants. It captures every lead, drafts every follow-up, and keeps bookings, payments, and visas organized — so your team spends less time on admin and more time closing trips.",
  primaryCta: { label: "Book a Free Demo", href: "/pricing" },
  secondaryCta: { label: "See How It Works", href: "/#product-overview" },
  trustLine: "No credit card required · Live in a day · Built specifically for travel businesses",
};

export const trustedBy = {
  label: "Trusted by travel businesses that book more, chase less",
  stat: "Agencies using Rihla follow up with more leads, in less time, without adding headcount.",
  logos: ["Aurora Travel", "Northstar DMC", "Fernway Tours", "Bluepeak Holidays", "Meridian Visas", "Coastline Group"],
};

export const problem = {
  headline: "Your business isn't losing to competitors. It's losing to its own systems.",
  body: "A quote request lands on WhatsApp at 11pm and sits unread until morning. A hot lead gets forgotten between two team members. A visa case goes quiet for a week because no one owns it. None of this happens because your team isn't good at their jobs. It happens because leads, bookings, payments, and conversations live in five different places — and nothing connects them.",
  cards: [
    {
      title: "Leads go cold",
      body: "Inquiries come in from WhatsApp, email, and your website. Without one place to track them, follow-ups get missed and leads book elsewhere.",
    },
    {
      title: "Quoting takes too long",
      body: "Every itinerary and price quote gets rebuilt from scratch. What should take minutes takes hours — and slower quotes lose to faster ones.",
    },
    {
      title: "Nothing is tracked in one place",
      body: "Payments, supplier costs, visa stages, and client history live across spreadsheets, inboxes, and someone's memory. Nothing adds up until it's too late.",
    },
  ],
};

export const solution = {
  headline: "One system for every lead, quote, booking, and follow-up.",
  body: "Rihla brings your entire sales and operations process into a single, connected system. Every inquiry becomes a tracked lead. Every quote gets built in minutes, not hours. Every booking, payment, and visa case stays visible — to your whole team, in real time.",
};

export const dashboards = [
  { key: "pipeline", label: "Lead Pipeline", caption: "Every lead, staged from first contact to booked trip." },
  { key: "inbox", label: "WhatsApp Inbox", caption: "Every conversation in one place, with AI-drafted replies." },
  { key: "itinerary", label: "Itinerary Builder", caption: "Branded, priced itineraries built in minutes." },
  { key: "analytics", label: "Analytics Dashboard", caption: "Revenue, conversion, and team performance, live." },
];

export const features = [
  { title: "Lead Management", body: "Every inquiry tracked, owned, and never lost." },
  { title: "Sales Pipeline", body: "See exactly where every deal stands, at a glance." },
  { title: "Booking & Package Management", body: "Manage trips, packages, and suppliers together." },
  { title: "Tour Itinerary Builder", body: "Build polished, branded itineraries fast." },
  { title: "Payments & Invoicing", body: "Track what's paid, pending, and owed." },
  { title: "WhatsApp & Email Integration", body: "Every conversation in one inbox." },
];

export const aiFeatures = [
  {
    title: "AI Lead Qualification",
    body: "The moment an inquiry arrives, Rihla scores it and routes it to the right person — so your team spends time on travelers ready to book.",
  },
  {
    title: "AI Email & WhatsApp Replies",
    body: "Drafts a reply to common questions in seconds. Your team reviews, edits if needed, and sends.",
  },
  {
    title: "AI Proposal Generation",
    body: "Turns a short brief into a complete, branded itinerary and quote — ready to send.",
  },
  {
    title: "AI Follow-Up Suggestions",
    body: "Tells you exactly who to follow up with today, and what to say.",
  },
];

export const benefits = [
  { title: "Convert more inquiries into bookings", body: "Every lead is tracked, owned, and followed up on time." },
  { title: "Quote in minutes", body: "Build branded proposals and itineraries from templates and past trips." },
  { title: "See your numbers without asking anyone", body: "Real-time visibility into pipeline, revenue, and team performance." },
  { title: "Free up your team's time", body: "AI drafts replies and follow-ups so your team reviews instead of retypes." },
  { title: "Keep every visa and payment on track", body: "Nothing depends on memory or a sticky note." },
  { title: "Look professional at every touchpoint", body: "Branded proposals, fast replies, and a client portal your travelers notice." },
];

export const industries = [
  { title: "Travel Agencies", body: "Manage every client relationship and booking in one place." },
  { title: "Tour Operators", body: "Run packages, suppliers, and group logistics without the spreadsheet juggling." },
  { title: "DMCs", body: "Coordinate ground operations, suppliers, and multi-party bookings at scale." },
  { title: "Visa Consultants", body: "Track every application's stage and document without losing a case." },
  { title: "Holiday Package Companies", body: "Sell, customize, and fulfill packages faster." },
  { title: "Corporate & Group Travel", body: "Manage complex, multi-traveler bookings without losing detail." },
];

export const howItWorks = [
  { step: "Capture", body: "Every lead from WhatsApp, email, calls, and your website lands in one pipeline." },
  { step: "Qualify & quote", body: "AI-assisted scoring and proposal generation move leads forward automatically." },
  { step: "Book & manage", body: "Payments, suppliers, visas, and documents stay in one record." },
  { step: "Grow", body: "Dashboards show where revenue is coming from — and where it's leaking." },
];

export const integrations = [
  "WhatsApp Business",
  "Gmail",
  "Outlook",
  "Google Calendar",
  "Google Meet",
  "Razorpay",
  "Stripe",
  "Open API",
];

export const testimonials = [
  {
    quote: "We stopped losing quotes in WhatsApp threads. Every lead has an owner and a next step now.",
    name: "Founder",
    company: "Aurora Travel",
  },
  {
    quote: "The AI-drafted replies alone gave our team back two hours a day.",
    name: "Operations Manager",
    company: "Fernway Tours",
  },
  {
    quote: "Visa tracking used to keep me up at night. Now I see every case in one screen.",
    name: "Visa Consultant",
    company: "Meridian Visas",
  },
];

export const stats = [
  { value: 3, suffix: "x", label: "Faster lead follow-up" },
  { value: 50, suffix: "%", label: "Less time spent building quotes" },
  { value: 1, suffix: "", label: "System replacing 5+ spreadsheets & apps" },
];

export const faqHome = [
  {
    q: "Is Rihla only for travel agencies?",
    a: "Travel is our core focus, but Rihla works for any service business managing leads, quotes, bookings, and payments.",
  },
  {
    q: "Do I need technical skills to set it up?",
    a: "No. Most teams are fully running their pipeline within a day of onboarding.",
  },
  {
    q: "Can my whole team use it?",
    a: "Yes. Role-based permissions let you control exactly what agents, managers, and accounts can see and do.",
  },
  {
    q: "Does it work with WhatsApp?",
    a: "Yes, natively — including AI-drafted replies inside the same inbox.",
  },
  {
    q: "What happens to my existing leads and bookings?",
    a: "Import them from spreadsheets or your current CRM in one step, with support from our onboarding team.",
  },
  {
    q: "Is there a free trial?",
    a: "Book a demo to see Rihla running your actual workflow, then choose the plan that fits your team.",
  },
];

export const finalCta = {
  headline: "Stop running your business from memory and messages.",
  subheading: "See how Rihla brings your leads, bookings, payments, and team into one system — built for travel, powered by AI.",
  primaryCta: { label: "Book a Free Demo", href: "/pricing" },
  secondaryCta: { label: "Log in", href: "/login" },
};

export const footer = {
  tagline: "The AI-powered CRM built for travel businesses. By State AI.",
  columns: [
    {
      title: "Product",
      links: [
        { label: "Product Overview", href: "/#product-overview" },
        { label: "Pricing", href: "/pricing" },
      ],
    },
    {
      title: "Company",
      links: [
        { label: "About", href: "/about" },
        { label: "Book a Demo", href: "/pricing" },
      ],
    },
    {
      title: "Legal",
      links: [
        { label: "Privacy Policy", href: "/privacy" },
        { label: "Terms of Service", href: "/terms" },
      ],
    },
  ],
};
