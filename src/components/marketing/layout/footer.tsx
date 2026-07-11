import Link from "next/link";
import { Compass } from "lucide-react";
import { footer } from "@/lib/marketing/content";

export function Footer() {
  return (
    <footer className="border-t border-line bg-background">
      <div className="section grid grid-cols-2 gap-10 py-16 md:grid-cols-6">
        <div className="col-span-2">
          <Link href="/" className="flex items-center gap-2.5 font-display text-lg font-bold tracking-tight">
            <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-ink">
              <Compass className="text-white" size={16} />
            </span>
            Rihla
          </Link>
          <p className="mt-4 max-w-xs text-sm text-ink-muted">{footer.tagline}</p>
        </div>

        {footer.columns.map((col) => (
          <div key={col.title}>
            <h4 className="font-mono text-xs uppercase tracking-widest text-ink-faint">
              {col.title}
            </h4>
            <ul className="mt-4 space-y-3">
              {col.links.map((l) => (
                <li key={l.href}>
                  <Link href={l.href} className="text-sm text-ink-muted transition-colors hover:text-ink">
                    {l.label}
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>

      <div className="border-t border-line">
        <div className="section flex flex-col items-center justify-between gap-4 py-6 text-xs text-ink-faint md:flex-row">
          <p>&copy; {new Date().getFullYear()} Rihla by State AI. Made for travel businesses worldwide.</p>
          <div className="flex gap-6">
            <Link href="/privacy" className="transition-colors hover:text-ink-muted">Privacy Policy</Link>
            <Link href="/terms" className="transition-colors hover:text-ink-muted">Terms of Service</Link>
          </div>
        </div>
        <div className="border-t border-line/50">
          <div className="section py-4 text-center text-xs text-ink-faint">
            Powered by{" "}
            <a
              href="https://www.stateai.in"
              target="_blank"
              rel="noopener noreferrer"
              className="font-medium text-ink-muted transition-colors hover:text-ink"
            >
              State AI
            </a>
          </div>
        </div>
      </div>
    </footer>
  );
}
