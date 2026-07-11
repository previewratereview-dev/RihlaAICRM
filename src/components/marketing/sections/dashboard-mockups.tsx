import { MessageCircle, MapPin, TrendingUp, Sparkles, CheckCircle2, User, MessageSquare, CreditCard, Calendar } from "lucide-react";

function DeviceFrame({ children }: { children: React.ReactNode }) {
  return (
    <div className="rounded-2xl border border-line bg-white shadow-hero-card overflow-hidden">
      <div className="flex items-center gap-2 border-b border-line px-5 py-3.5">
        <span className="h-3 w-3 rounded-full bg-red-400" />
        <span className="h-3 w-3 rounded-full bg-amber-400" />
        <span className="h-3 w-3 rounded-full" style={{ backgroundColor: "#C6FF3D" }} />
      </div>
      <div className="p-5 md:p-7">{children}</div>
    </div>
  );
}

const stages = [
  {
    label: "NEW LEAD",
    icon: User,
    items: [
      { name: "Aarav — Bali, 4 pax", time: "Added 2h ago" },
      { name: "Priya — Paris honeymoon", time: "Added 5h ago" },
    ],
  },
  {
    label: "QUOTED",
    icon: MessageSquare,
    items: [
      { name: "Rohan — Kerala backwaters", time: "Quoted 1d ago" },
      { name: "The Mehras — Euro tour", time: "Quoted 2d ago" },
    ],
  },
  {
    label: "DEPOSIT PAID",
    icon: CreditCard,
    items: [
      { name: "Sana — Dubai family trip", time: "Paid 3d ago" },
    ],
  },
  {
    label: "BOOKED",
    icon: Calendar,
    items: [
      { name: "Team Offsite — Bangkok", time: "Booked 5d ago" },
    ],
  },
];

export function PipelineMockup() {
  return (
    <DeviceFrame>
      {/* Header */}
      <div className="mb-6 flex items-center justify-between">
        <h3 className="text-lg font-bold text-ink">Lead Pipeline</h3>
        <span className="inline-flex items-center gap-2 rounded-full border border-line bg-white px-4 py-1.5 text-xs font-semibold text-ink shadow-sm">
          <span className="h-2 w-2 rounded-full" style={{ backgroundColor: "#C6FF3D" }} />
          LIVE
        </span>
      </div>

      {/* Pipeline columns */}
      <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
        {stages.map((stage) => {
          const Icon = stage.icon;
          return (
            <div key={stage.label} className="rounded-xl border border-line bg-white p-4 transition-shadow hover:shadow-md">
              {/* Column header */}
              <div className="mb-1 flex items-center justify-between">
                <div className="flex items-center gap-2.5">
                  <div
                    className="flex h-9 w-9 items-center justify-center rounded-lg"
                    style={{ backgroundColor: "rgba(198,255,61,0.25)" }}
                  >
                    <Icon size={16} className="text-ink" />
                  </div>
                  <span className="text-xs font-bold uppercase tracking-wider text-ink">
                    {stage.label}
                  </span>
                </div>
                <span
                  className="flex h-6 min-w-[24px] items-center justify-center rounded-full px-1.5 text-[10px] font-bold text-ink"
                  style={{ backgroundColor: "rgba(198,255,61,0.3)" }}
                >
                  {stage.items.length}
                </span>
              </div>

              {/* Lime divider */}
              <div className="mb-3 mt-2 h-0.5 rounded-full" style={{ backgroundColor: "#C6FF3D" }} />

              {/* Lead cards */}
              <div className="space-y-2.5">
                {stage.items.map((item) => (
                  <div
                    key={item.name}
                    className="rounded-lg border border-line bg-white p-3 transition-all duration-200 hover:border-ink/15 hover:shadow-sm"
                  >
                    <div className="flex items-start gap-2">
                      <span
                        className="mt-1.5 h-2 w-2 shrink-0 rounded-full"
                        style={{ backgroundColor: "#C6FF3D" }}
                      />
                      <div className="min-w-0">
                        <p className="text-sm font-semibold text-ink leading-snug">
                          {item.name}
                        </p>
                        <p className="mt-0.5 text-xs text-ink-faint">
                          {item.time}
                        </p>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          );
        })}
      </div>
    </DeviceFrame>
  );
}

export function InboxMockup() {
  return (
    <DeviceFrame>
      <div className="mb-4 flex items-center gap-2">
        <MessageCircle size={16} className="text-accent" />
        <span className="text-sm font-medium text-ink">WhatsApp Inbox</span>
      </div>
      <div className="space-y-3">
        <div className="flex items-start gap-3 rounded-xl border border-line bg-white p-3">
          <div className="h-8 w-8 shrink-0 rounded-full bg-ink" />
          <div>
            <p className="text-xs text-ink-muted">
              &ldquo;Hi, is the Bali package available for 4 people in December?&rdquo;
            </p>
          </div>
        </div>
        <div className="ml-6 flex items-start gap-2 rounded-xl border border-line bg-white p-3">
          <Sparkles size={14} className="mt-0.5 shrink-0 text-accent" />
          <p className="text-xs text-ink-muted">
            <span className="font-medium text-ink">AI draft:</span> &ldquo;Yes! December has
            availability for 4 travelers — sending you the itinerary and pricing now.&rdquo;
          </p>
        </div>
      </div>
    </DeviceFrame>
  );
}

export function ItineraryMockup() {
  return (
    <DeviceFrame>
      <div className="mb-4 flex items-center gap-2">
        <MapPin size={16} className="text-accent" />
        <span className="text-sm font-medium text-ink">Bali, 5 Days — Draft Itinerary</span>
      </div>
      <div className="space-y-2">
        {["Day 1 — Arrival & Seminyak", "Day 2 — Ubud rice terraces", "Day 3 — Nusa Penida day trip"].map(
          (d) => (
            <div
              key={d}
              className="flex items-center justify-between rounded-lg border border-line bg-white px-3 py-2 text-xs text-ink-muted"
            >
              <span>{d}</span>
              <CheckCircle2 size={14} className="text-accent" />
            </div>
          )
        )}
      </div>
      <div className="mt-4 flex items-center justify-between rounded-lg border border-line bg-white px-3 py-2 text-xs">
        <span className="text-ink-muted">Total (4 pax)</span>
        <span className="font-mono font-medium text-ink">$3,240</span>
      </div>
    </DeviceFrame>
  );
}

export function AnalyticsMockup() {
  const bars = [40, 65, 50, 80, 60, 95, 70];
  return (
    <DeviceFrame>
      <div className="mb-4 flex items-center gap-2">
        <TrendingUp size={16} className="text-accent" />
        <span className="text-sm font-medium text-ink">Revenue — Last 7 Weeks</span>
      </div>
      <div className="flex h-32 items-end gap-2">
        {bars.map((h, i) => (
          <div key={i} className="flex-1 rounded-t-md bg-accent opacity-80" style={{ height: `${h}%` }} />
        ))}
      </div>
      <div className="mt-4 grid grid-cols-3 gap-3 text-center">
        <div>
          <p className="font-mono text-lg font-semibold text-ink">32%</p>
          <p className="text-[10px] text-ink-faint">Conversion rate</p>
        </div>
        <div>
          <p className="font-mono text-lg font-semibold text-ink">184</p>
          <p className="text-[10px] text-ink-faint">Active leads</p>
        </div>
        <div>
          <p className="font-mono text-lg font-semibold text-ink">$48K</p>
          <p className="text-[10px] text-ink-faint">Pipeline value</p>
        </div>
      </div>
    </DeviceFrame>
  );
}
