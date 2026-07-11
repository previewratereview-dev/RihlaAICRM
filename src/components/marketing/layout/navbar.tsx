"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Menu, X, Compass } from "lucide-react";
import { nav } from "@/lib/marketing/content";
import { Button } from "@/components/marketing/ui/button";
import { cn } from "@/lib/utils";

export function Navbar() {
  const [scrolled, setScrolled] = useState(false);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 8);
    onScroll();
    window.addEventListener("scroll", onScroll);
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  return (
    <header
      className={cn(
        "fixed top-0 z-50 w-full transition-all duration-300",
        scrolled
          ? "border-b border-line bg-background/90 shadow-sm backdrop-blur-xl"
          : "border-b border-transparent bg-transparent"
      )}
    >
      <nav className="section flex h-16 items-center justify-between md:h-18">
        <Link href="/" className="flex items-center gap-2.5 font-display text-lg font-bold tracking-tight">
          <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-ink">
            <Compass className="text-white" size={16} />
          </span>
          <span className="text-ink">{nav.logo}</span>
        </Link>

        <div className="hidden items-center gap-7 md:flex">
          {nav.links.map((link) => (
            <Link
              key={link.href}
              href={link.href}
              className="text-sm font-medium text-ink-muted transition-colors hover:text-ink"
            >
              {link.label}
            </Link>
          ))}
        </div>

        <div className="hidden items-center gap-3 md:flex">
          <Button href="/login" className="btn-secondary !py-2.5 !px-5 !text-sm">
            Log in
          </Button>
          <Button href={nav.cta.href} className="btn-primary !py-2.5 !px-5 !text-sm">
            {nav.cta.label}
          </Button>
        </div>

        <button
          aria-label={open ? "Close menu" : "Open menu"}
          className="text-ink md:hidden"
          onClick={() => setOpen((v) => !v)}
        >
          {open ? <X size={24} /> : <Menu size={24} />}
        </button>
      </nav>

      {open && (
        <div className="border-t border-line bg-background px-6 py-6 md:hidden">
          <div className="flex flex-col gap-4">
            {nav.links.map((link) => (
              <Link
                key={link.href}
                href={link.href}
                className="text-base font-medium text-ink-muted hover:text-ink"
                onClick={() => setOpen(false)}
              >
                {link.label}
              </Link>
            ))}
            <Button href={nav.cta.href} className="btn-primary mt-2 w-full">
              {nav.cta.label}
            </Button>
          </div>
        </div>
      )}
    </header>
  );
}
