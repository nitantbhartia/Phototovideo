# ListingReel

> AI-powered real estate listing video platform. Turn listing photos into cinematic narrated videos in 5 minutes.

## Architecture

```
[Browser / Agent]
      |
      v HTTPS
[Vercel / Next.js]  ─── API Routes ──► [Anthropic Claude]
      |                                [ElevenLabs TTS]
      | Job Queue (Upstash QStash)
      v
[Railway Worker]  ─── ffmpeg pipeline ──► [Cloudflare R2]
      |
      └── Status updates ──► Vercel (polling) ──► Browser
```

### Stack

| Layer | Technology |
|-------|-----------|
| Frontend | Next.js 14 (App Router) |
| Styling | Tailwind CSS + custom components |
| Auth | Clerk |
| Payments | Stripe |
| Database | PostgreSQL (Neon) + Drizzle ORM |
| Job Queue | Upstash Redis + QStash |
| Video Worker | Railway (Python + ffmpeg) |
| File Storage | Cloudflare R2 |
| AI Vision | Anthropic Claude Opus |
| TTS | ElevenLabs Turbo v2.5 |
| Email | Resend |

## Project Structure

```
listingreel/
├── apps/
│   ├── web/                    # Next.js 14 app (Vercel)
│   │   ├── app/
│   │   │   ├── (marketing)/    # Landing, Pricing
│   │   │   ├── (app)/          # Dashboard, Generate, Video
│   │   │   └── api/            # API routes
│   │   ├── components/         # UI components
│   │   └── lib/                # DB, R2, Stripe, queue utils
│   └── worker/                 # Python ffmpeg worker (Railway)
│       ├── pipeline.py         # Core 5-stage video pipeline
│       ├── worker.py           # FastAPI QStash job consumer
│       └── Dockerfile
└── railway.toml                # Railway deployment config
```

## Video Pipeline (5 Stages)

1. **Image Classification & Sort** — Claude Vision labels each image by room type, orders exterior → living → kitchen → beds → baths → outdoor
2. **Narration Generation** — Claude Vision generates 1–3 sentences per image with property intro and CTA
3. **Text-to-Speech** — ElevenLabs Turbo v2.5 (Rachel voice) generates MP3 per clip
4. **Clip Rendering** — ffmpeg zoompan (Ken Burns), warm color grade, vignette, 1920×1080 output
5. **Final Assembly** — ffmpeg xfade cross-dissolve, voiceover + music mix (8%), subtitle burn-in, web-optimized MP4

## Setup

### Prerequisites

- Node.js 20+
- Python 3.12+
- ffmpeg 6.x
- Accounts: Clerk, Stripe, Neon, Cloudflare R2, Upstash, ElevenLabs, Resend

### Next.js App (Vercel)

```bash
cd apps/web
cp ../../.env.example .env.local
npm install
npm run db:push    # Push schema to Neon
npm run dev
```

### Python Worker (Railway)

```bash
cd apps/worker
cp ../../.env.example .env
python -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
python worker.py
```

## Environment Variables

See `.env.example` for all required variables.

### Key Variables

| Variable | Where | Notes |
|----------|-------|-------|
| `ANTHROPIC_API_KEY` | Vercel + Railway | Room classification + narration |
| `ELEVENLABS_API_KEY` | Railway | TTS (worker only) |
| `CLERK_SECRET_KEY` | Vercel | Auth |
| `STRIPE_SECRET_KEY` | Vercel | Payments |
| `DATABASE_URL` | Vercel + Railway | Neon PostgreSQL |
| `QSTASH_TOKEN` | Vercel | Job dispatch |
| `R2_*` | Vercel + Railway | File storage |
| `WORKER_SECRET` | Vercel + Railway | Worker auth |

## API Routes

| Method | Route | Description |
|--------|-------|-------------|
| `POST` | `/api/upload/presign` | Generate presigned R2 upload URLs |
| `POST` | `/api/videos` | Create video record + dispatch job |
| `GET` | `/api/videos/[id]` | Poll video status (every 2s) |
| `GET` | `/api/videos/[id]/download` | Download MP4 (requires payment) |
| `GET` | `/api/checkout` | Stripe checkout redirect |
| `POST` | `/api/webhooks/stripe` | Payment success handler |
| `POST` | `/api/webhooks/clerk` | User creation handler |
| `POST` | `/api/worker/status` | Worker → Vercel status updates |

## Upload Flow

Photos upload directly to R2 (not via Vercel) to avoid the 4.5MB function payload limit:

1. Browser → `POST /api/upload/presign` (get presigned URLs)
2. Browser → R2 directly (PUT each file)
3. Browser → `POST /api/videos` (dispatch job)
4. QStash → Railway worker
5. Worker → processes → uploads MP4 to R2
6. Worker → `POST /api/worker/status` (updates DB)
7. Frontend polls `/api/videos/[id]` every 2s

## Pricing

| Tier | Price | Credits |
|------|-------|---------|
| Pay-per-video | $49 | 1 video |
| Starter | $99/mo | 10 videos/mo |
| Pro | $249/mo | Unlimited |

COGS: ~$0.30–0.55/video (Claude + ElevenLabs). Gross margin: ~99%.

## Deployment

### Vercel

```bash
cd apps/web
vercel deploy --prod
```

Set all environment variables in the Vercel dashboard.

### Railway

Railway auto-deploys from the `railway.toml` config. Set all environment variables in the Railway service settings.

## Development Costs (Monthly)

| Service | Cost |
|---------|------|
| Vercel Pro | $20 |
| Railway Hobby | $5 |
| Neon | $0 (free tier) |
| Cloudflare R2 | $0–2 |
| Upstash | $0 (free tier) |
| Clerk | $0 (free tier) |
| Resend | $0 (free tier) |
| **Total** | **~$25/mo** |

Breakeven at 1 pay-per-video sale.
