"use client";

import { motion } from "framer-motion";
import {
  Users,
  BarChart3,
  FileText,
  Calendar,
  CreditCard,
  Sparkles,
  MessageCircle,
  Shield,
  TrendingUp,
  Globe,
  UserPlus,
  Phone,
  StickyNote,
  Handshake,
  ClipboardList,
  Plane,
  Package,
  Receipt,
  Wallet,
  BrainCircuit,
  Mail,
  Video,
  CalendarCheck,
  Lock,
  PieChart,
  Megaphone,
  Settings,
  Cloud,
  Smartphone,
  FolderOpen,
  Database,
  Code,
  ArrowDownToLine,
  Tag,
  Repeat,
  Layers,
} from "lucide-react";
import { Reveal } from "@/components/marketing/sections/reveal";

const features = [
  {
    icon: Users,
    title: "Lead Management",
    items: ["Lead Capture", "Lead Assignment", "Follow-ups", "Lead Source Tracking", "Activity Timeline"],
  },
  {
    icon: BarChart3,
    title: "Sales & CRM",
    items: ["Sales Pipeline", "Customer Management", "Notes", "Call Logs", "Team Collaboration"],
  },
  {
    icon: FileText,
    title: "Quotes & Proposals",
    items: ["Quotation Builder", "Proposal Builder", "Tour Itinerary Builder", "Package Management"],
  },
  {
    icon: ClipboardList,
    title: "Booking & Operations",
    items: ["Booking Management", "Visa Tracking", "Supplier Management", "Calendar", "Notifications"],
  },
  {
    icon: CreditCard,
    title: "Payments & Finance",
    items: ["Payments", "Invoices", "Accounting", "Payment Gateway"],
  },
  {
    icon: Sparkles,
    title: "AI Automation",
    items: ["AI Assistant", "AI Lead Qualification", "AI WhatsApp Replies", "AI Email Writer", "AI Follow-up Suggestions", "AI Proposal Generator"],
  },
  {
    icon: MessageCircle,
    title: "Communication Hub",
    items: ["WhatsApp Integration", "Email Integration", "Google Meet", "Google Calendar", "Customer Portal"],
  },
  {
    icon: Shield,
    title: "Team Management",
    items: ["Task Management", "Team Management", "Role Permissions", "Multi-user", "Multi-branch"],
  },
  {
    icon: PieChart,
    title: "Analytics & Marketing",
    items: ["Analytics Dashboard", "Reports", "Marketing Campaigns", "Custom Fields"],
  },
  {
    icon: Globe,
    title: "Platform & Integrations",
    items: ["Cloud Based", "Mobile Friendly", "Documents", "File Storage", "API", "Import & Export", "White Label"],
  },
];

const containerVariants = {
  hidden: {},
  visible: {
    transition: {
      staggerChildren: 0.06,
    },
  },
};

const cardVariants = {
  hidden: { opacity: 0, y: 32, scale: 0.97 },
  visible: {
    opacity: 1,
    y: 0,
    scale: 1,
    transition: { duration: 0.5, ease: [0.25, 0.46, 0.45, 0.94] as const },
  },
};

export function ProductOverview() {
  return (
    <section className="section py-20 md:py-28">
      <Reveal className="text-center">
        <span className="eyebrow">Product Overview</span>
        <h2 className="mx-auto mt-5 max-w-3xl text-3xl font-semibold leading-tight md:text-4xl">
          Everything your travel business needs
        </h2>
        <p className="mx-auto mt-5 max-w-2xl text-ink-muted">
          Manage leads, bookings, operations, finance, communication, and AI—all in one powerful platform.
        </p>
      </Reveal>

      <motion.div
        className="mx-auto mt-14 grid max-w-[1200px] grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-5"
        variants={containerVariants}
        initial="hidden"
        whileInView="visible"
        viewport={{ once: true, margin: "-100px" }}
      >
        {features.map((feature) => {
          const Icon = feature.icon;
          return (
            <motion.div
              key={feature.title}
              variants={cardVariants}
              whileHover={{
                y: -6,
                transition: { duration: 0.25, ease: "easeOut" },
              }}
              className="group relative flex flex-col overflow-hidden rounded-2xl border border-line bg-white p-5 shadow-card transition-shadow duration-300 hover:shadow-hero-card-hover"
            >
              {/* Hover glow */}
              <div className="pointer-events-none absolute inset-0 rounded-2xl opacity-0 transition-opacity duration-300 group-hover:opacity-100"
                style={{
                  background: "radial-gradient(400px circle at var(--mouse-x, 50%) var(--mouse-y, 0%), rgba(198,255,61,0.06), transparent 60%)",
                }}
              />

              {/* Icon */}
              <div
                className="mb-4 flex h-10 w-10 items-center justify-center rounded-xl"
                style={{ backgroundColor: "rgba(198,255,61,0.15)" }}
              >
                <Icon size={20} className="text-ink" strokeWidth={1.8} />
              </div>

              {/* Title */}
              <h3 className="text-sm font-bold text-ink">{feature.title}</h3>

              {/* Divider */}
              <div
                className="my-3 h-px w-full rounded-full"
                style={{ backgroundColor: "rgba(198,255,61,0.3)" }}
              />

              {/* Feature list */}
              <ul className="flex-1 space-y-1.5">
                {feature.items.map((item) => (
                  <li key={item} className="flex items-center gap-2 text-[13px] text-ink-muted">
                    <span
                      className="flex h-4 w-4 shrink-0 items-center justify-center rounded-full"
                      style={{ backgroundColor: "rgba(198,255,61,0.18)" }}
                    >
                      <svg
                        width="8"
                        height="8"
                        viewBox="0 0 8 8"
                        fill="none"
                        xmlns="http://www.w3.org/2000/svg"
                      >
                        <path
                          d="M1.5 4L3.5 6L6.5 2"
                          stroke="#111111"
                          strokeWidth="1.2"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                        />
                      </svg>
                    </span>
                    <span>{item}</span>
                  </li>
                ))}
              </ul>
            </motion.div>
          );
        })}
      </motion.div>
    </section>
  );
}
