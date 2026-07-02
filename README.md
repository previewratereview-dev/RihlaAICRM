# State AI CRM (WanderBot AI Travel CRM)

Multi-tenant travel CRM with AI lead scoring, FAQ chatbot, pipeline management, and Supabase persistence.

## Features

| Module | Status |
|--------|--------|
| Travelers & Bookings (Leads) | Full CRUD, CSV import/export, AI scoring |
| Booking Pipeline | Drag-and-drop kanban |
| Conversations + AI Assistant | Live messaging + FAQ/AI chatbot |
| Tasks & Calendar | Full task CRUD + meeting scheduling |
| Team Management | User CRUD (admin) |
| Past Travelers | Closed-won client directory + re-book |
| Reports & Analytics | Live charts from lead data |
| Team Performance | Computed leaderboard |
| System Settings | Agency, AI, integrations, audit log |
| Super Admin | Agency management, global analytics, platform settings |
| AI Governance | Budget guard, usage logging, spend dashboard |

## Quick Start

```bash
npm install
cp .env.local.example .env.local
# Add Supabase URL + anon key (optional — works in local sandbox mode without)
npm run dev
```

Open [http://localhost:3000](http://localhost:3000)

### Local sandbox login (no Supabase)

| Email | Password | Role |
|-------|----------|------|
| user@stateai.com | password123 | admin |
| setter@stateai.com | password123 | specialist |

### Supabase setup

1. Create a Supabase project
2. Run `supabase_schema.sql` in the SQL Editor
3. Set `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_ANON_KEY` in `.env.local`
4. Create auth users in Supabase Dashboard; profiles are auto-created via trigger

## Architecture

- **UI:** Next.js 16 App Router, React 19, Tailwind, shadcn/ui
- **State:** Zustand (`use-crm-store.ts`)
- **Data:** `db-service.ts` — Supabase with localStorage fallback
- **Auth:** Supabase Auth + session cookie; proxy enforces routes
- **AI:** Rule-based lead scoring, FAQ engine, budget-guarded OpenAI/Anthropic
- **Multi-tenant:** Tenant resolution via subdomain/header; RLS isolation in Supabase

## API Routes

| Route | Purpose |
|-------|---------|
| `POST /api/ai/complete` | AI chat completions with budget guard |
| `POST /api/ai/usage` | Log AI usage to Supabase |
| `GET /api/tenant/branding` | Tenant branding + settings |
| `GET /api/tenant/keys` | Server-only API key retrieval |
| `POST /api/webhooks/stripe` | Stripe payment webhooks |
| `POST /api/webhooks/whatsapp` | WhatsApp/Twilio inbound |

## Optional Integrations

Configure in `.env.local`:

- **Resend** — transactional email (`RESEND_API_KEY`)
- **Stripe** — deposits (`STRIPE_SECRET_KEY`, webhook secret)
- **Twilio** — WhatsApp/SMS (`TWILIO_*`)
- **OpenAI / Anthropic** — AI fallback (`OPENAI_API_KEY`)

## Project Structure

```
src/
├── app/              # Pages + API routes
├── components/       # View components + super-admin
├── hooks/            # use-crm-store, use-chatbot, use-tenant
├── lib/
│   ├── ai/           # Scoring, guard, providers
│   ├── chatbot/      # FAQ engine
│   ├── integrations/ # Email, webhooks
│   └── tenant/       # Multi-tenant resolution
└── proxy.ts          # Auth + tenant headers (Next.js 16 proxy)
```

## Scripts.

```bash
npm run dev      # Development server
npm run build    # Production build
npm run lint     # ESLint
```
