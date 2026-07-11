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
  Globe,
} from "lucide-react";

const features = [
  { icon: Users, label: "Lead Management" },
  { icon: BarChart3, label: "Sales Pipeline" },
  { icon: FileText, label: "Quotation Builder" },
  { icon: Calendar, label: "Booking Calendar" },
  { icon: CreditCard, label: "Payment Tracking" },
  { icon: Sparkles, label: "AI Assistant" },
  { icon: MessageCircle, label: "WhatsApp Inbox" },
  { icon: Globe, label: "Customer Portal" },
];

const stats = [
  { value: "3x", label: "Faster follow-ups" },
  { value: "50%", label: "Less time quoting" },
  { value: "1", label: "System replacing 5+ apps" },
  { value: "24/7", label: "AI-powered pipeline" },
];

function MarqueeRow({
  items,
  reverse = false,
  speed = 30,
}: {
  items: typeof features;
  reverse?: boolean;
  speed?: number;
}) {
  const doubled = [...items, ...items];
  return (
    <div className="relative overflow-hidden py-3">
      <motion.div
        className="flex w-max gap-4"
        animate={{
          x: reverse ? ["0%", "-50%"] : ["-50%", "0%"],
        }}
        transition={{
          x: {
            duration: speed,
            repeat: Infinity,
            ease: "linear",
          },
        }}
      >
        {doubled.map((item, i) => {
          const Icon = item.icon;
          return (
            <div
              key={`${item.label}-${i}`}
              className="flex items-center gap-3 rounded-xl border border-line bg-white px-5 py-3 shadow-sm transition-shadow duration-300 hover:shadow-md"
            >
              <div
                className="flex h-9 w-9 items-center justify-center rounded-lg"
                style={{ backgroundColor: "rgba(198,255,61,0.15)" }}
              >
                <Icon size={18} className="text-ink" strokeWidth={1.8} />
              </div>
              <span className="whitespace-nowrap text-sm font-medium text-ink">
                {item.label}
              </span>
            </div>
          );
        })}
      </motion.div>
      {/* Fade edges */}
      <div className="pointer-events-none absolute inset-y-0 left-0 w-24 bg-gradient-to-r from-white to-transparent" />
      <div className="pointer-events-none absolute inset-y-0 right-0 w-24 bg-gradient-to-l from-white to-transparent" />
    </div>
  );
}

export function TrustedBy() {
  return (
    <section className="section py-16 md:py-20">
      {/* Stats row */}
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        whileInView={{ opacity: 1, y: 0 }}
        viewport={{ once: true, margin: "-60px" }}
        transition={{ duration: 0.5 }}
        className="mb-12 flex flex-wrap items-center justify-center gap-8 md:gap-16"
      >
        {stats.map((stat, i) => (
          <div key={stat.label} className="text-center">
            <p className="text-3xl font-semibold text-ink md:text-4xl">{stat.value}</p>
            <p className="mt-1 text-xs text-ink-faint">{stat.label}</p>
          </div>
        ))}
      </motion.div>

      {/* Label */}
      <motion.p
        initial={{ opacity: 0 }}
        whileInView={{ opacity: 1 }}
        viewport={{ once: true }}
        transition={{ duration: 0.5, delay: 0.15 }}
        className="mb-8 text-center text-xs font-mono uppercase tracking-widest text-ink-faint"
      >
        Built for every part of your travel business
      </motion.p>

      {/* Scrolling rows */}
      <div className="space-y-3">
        <MarqueeRow items={features} speed={35} />
        <MarqueeRow items={[...features].reverse()} reverse speed={40} />
      </div>
    </section>
  );
}
