"use client";

import { motion } from "framer-motion";
import { ArrowRight, PlayCircle, TrendingUp, Users, Bot, Calendar, MessageCircle, BarChart3, Target } from "lucide-react";
import Image from "next/image";
import { hero } from "@/lib/marketing/content";
import { Button } from "@/components/marketing/ui/button";

function FloatingCard({
  children,
  className,
  delay = 0,
  animation = "float-slow",
}: {
  children: React.ReactNode;
  className?: string;
  delay?: number;
  animation?: string;
}) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 30, scale: 0.9 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      transition={{ duration: 0.8, delay, ease: "easeOut" }}
      className={`hero-card ${animation === "float-slow" ? "animate-float-slow" : animation === "float-medium" ? "animate-float-medium" : "animate-float-fast"} ${className}`}
    >
      {children}
    </motion.div>
  );
}

function StatCard({ icon: Icon, value, label, trend, delay }: { icon: React.ElementType; value: string; label: string; trend?: string; delay: number }) {
  return (
    <FloatingCard className="p-4 md:p-5" delay={delay}>
      <div className="flex items-center gap-3">
        <div className="flex h-10 w-10 items-center justify-center rounded-xl" style={{ backgroundColor: "rgba(198,255,61,0.15)" }}>
          <Icon size={18} style={{ color: "#111111" }} />
        </div>
        <div className="flex-1">
          <div className="flex items-center gap-2">
            <span className="font-display text-xl font-bold text-ink">{value}</span>
            {trend && (
              <span className="flex items-center gap-0.5 text-xs font-medium" style={{ color: "#111111" }}>
                <TrendingUp size={12} />
                {trend}
              </span>
            )}
          </div>
          <p className="text-xs text-ink-muted">{label}</p>
        </div>
      </div>
    </FloatingCard>
  );
}

function FeatureCard({ icon: Icon, title, delay, className }: { icon: React.ElementType; title: string; delay: number; className?: string }) {
  return (
    <FloatingCard className={`p-4 ${className}`} delay={delay} animation="float-medium">
      <div className="flex items-center gap-3">
        <div className="flex h-9 w-9 items-center justify-center rounded-lg" style={{ backgroundColor: "rgba(198,255,61,0.12)" }}>
          <Icon size={16} style={{ color: "#111111" }} />
        </div>
        <span className="text-sm font-medium text-ink">{title}</span>
      </div>
    </FloatingCard>
  );
}

function AIAssistantCard({ delay }: { delay: number }) {
  return (
    <FloatingCard className="p-4" delay={delay} animation="float-fast">
      <div className="flex items-start gap-3">
        <div className="flex h-10 w-10 items-center justify-center rounded-xl" style={{ backgroundColor: "#C6FF3D" }}>
          <Bot size={18} style={{ color: "#111111" }} />
        </div>
        <div>
          <p className="text-sm font-semibold text-ink">AI Assistant</p>
          <p className="mt-0.5 text-xs text-ink-muted">Drafting reply...</p>
          <div className="mt-2 flex items-center gap-1.5">
            <div className="h-1.5 w-1.5 rounded-full animate-pulse" style={{ backgroundColor: "#C6FF3D" }} />
            <span className="text-[10px] text-ink-faint">Processing</span>
          </div>
        </div>
      </div>
    </FloatingCard>
  );
}

function RevenueCard({ delay }: { delay: number }) {
  return (
    <FloatingCard className="p-5" delay={delay} animation="float-slow">
      <p className="text-xs font-medium text-ink-muted uppercase tracking-wider">Revenue</p>
      <div className="mt-2 flex items-baseline gap-2">
        <span className="font-display text-2xl font-bold text-ink">₹48,250</span>
        <span className="text-xs font-medium" style={{ color: "#111111" }}>+24.5%</span>
      </div>
      <div className="mt-3 flex items-end gap-1">
        {[40, 55, 45, 70, 60, 85, 75].map((h, i) => (
          <div
            key={i}
            className="flex-1 rounded-t"
            style={{ height: `${h}%`, backgroundColor: i % 2 === 0 ? "#C6FF3D" : "#E5E7EB" }}
          />
        ))}
      </div>
    </FloatingCard>
  );
}

export function Hero() {
  return (
    <section className="relative overflow-hidden bg-background">
      {/* Subtle lime radial glow */}
      <div
        className="pointer-events-none absolute inset-0"
        style={{ background: "radial-gradient(ellipse at 50% 0%, rgba(198,255,61,0.1) 0%, rgba(255,255,255,0) 60%)" }}
      />

      <div className="section relative pt-28 pb-20 md:pt-36 md:pb-28">
        {/* Center content */}
        <div className="relative z-10 mx-auto max-w-4xl text-center">
          <motion.div
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5 }}
          >
            <span className="eyebrow mx-auto">
              {hero.eyebrow}
            </span>
          </motion.div>

          <motion.h1
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6, delay: 0.1 }}
            className="mt-8 text-5xl font-bold leading-[1.08] tracking-tight text-ink md:text-7xl"
          >
            Run your travel business without losing{" "}
            <span className="relative inline-block">
              <span className="relative z-10">a single lead.</span>
              <span
                className="absolute inset-0 -z-0 translate-y-1 rounded-lg"
                style={{ backgroundColor: "rgba(198,255,61,0.35)" }}
              />
            </span>
          </motion.h1>

          <motion.p
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6, delay: 0.2 }}
            className="mx-auto mt-7 max-w-2xl text-lg leading-relaxed text-ink-muted"
          >
            {hero.subheading}
          </motion.p>

          <motion.div
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6, delay: 0.3 }}
            className="mt-10 flex flex-col items-center justify-center gap-4 sm:flex-row"
          >
            <Button href={hero.primaryCta.href} className="btn-lime">
              {hero.primaryCta.label}
              <ArrowRight size={16} />
            </Button>
            <Button href={hero.secondaryCta.href} className="btn-secondary">
              <PlayCircle size={16} />
              {hero.secondaryCta.label}
            </Button>
          </motion.div>

          <motion.p
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ duration: 0.6, delay: 0.4 }}
            className="mt-6 text-sm text-ink-faint"
          >
            {hero.trustLine}
          </motion.p>
        </div>

        {/* Floating dashboard cards */}
        <div className="pointer-events-none relative mx-auto mt-16 h-[420px] max-w-6xl md:mt-20 md:h-[480px]">
          {/* Far left — Analytics */}
          <div className="pointer-events-auto absolute left-0 top-8 hidden lg:block">
            <StatCard icon={BarChart3} value="32%" label="Conversion Rate" trend="+5.2%" delay={0.5} />
          </div>

          {/* Left — Leads */}
          <div className="pointer-events-auto absolute left-8 top-28 hidden md:block lg:left-24">
            <FeatureCard icon={Users} title="2,400+ Leads" delay={0.6} />
          </div>

          {/* Center — AI Assistant */}
          <div className="pointer-events-auto absolute left-1/2 top-0 -translate-x-1/2">
            <AIAssistantCard delay={0.55} />
          </div>

          {/* Center — Main dashboard image */}
          <motion.div
            initial={{ opacity: 0, y: 40, scale: 0.95 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            transition={{ duration: 0.8, delay: 0.4, ease: "easeOut" }}
            className="pointer-events-auto absolute left-1/2 top-12 -translate-x-1/2 overflow-hidden rounded-2xl border border-line bg-card shadow-float-lg"
          >
            <Image
              src="/dashboard-ref.png"
              alt="Rihla CRM Dashboard"
              width={700}
              height={400}
              priority
              className="h-auto w-[340px] md:w-[520px] lg:w-[600px]"
            />
          </motion.div>

          {/* Right — Calendar */}
          <div className="pointer-events-auto absolute right-8 top-28 hidden md:block lg:right-24">
            <FeatureCard icon={Calendar} title="Smart Calendar" delay={0.7} />
          </div>

          {/* Far right — Revenue */}
          <div className="pointer-events-auto absolute right-0 top-8 hidden lg:block">
            <RevenueCard delay={0.6} />
          </div>

          {/* Bottom left — WhatsApp */}
          <div className="pointer-events-auto absolute bottom-4 left-12 hidden md:block lg:left-32">
            <FeatureCard icon={MessageCircle} title="WhatsApp Inbox" delay={0.75} />
          </div>

          {/* Bottom right — Pipeline */}
          <div className="pointer-events-auto absolute bottom-4 right-12 hidden md:block lg:right-32">
            <FeatureCard icon={Target} title="Lead Pipeline" delay={0.8} />
          </div>
        </div>
      </div>

      {/* Bottom fade */}
      <div className="pointer-events-none absolute inset-x-0 bottom-0 h-24 bg-gradient-to-b from-transparent to-background" />
    </section>
  );
}
