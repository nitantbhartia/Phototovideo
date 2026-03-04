# ListingReel

> AI-powered real estate listing video platform. Turn listing photos into cinematic narrated videos in 5 minutes.

## Architecture (Railway-only)

```
[Browser]
    |
    v HTTPS
[Railway: web]  ─── Next.js 14 ──► [Anthropic API]
    |                               [ElevenLabs API]
    | Job Queue (Upstash QStash)
    v
[Railway: worker]  ─── ffmpeg pipeline ──► [Cloudflare R2]
    |
    └── Status callbacks ──► web ──► Browser (polling every 2s)
```

Both services run as Docker containers on Railway. No Vercel needed.

## Stack

| Layer | Technology |
|-------|-----------|
| Frontend | Next.js 14 (App Router, standalone output) |
| Styling | Tailwind CSS |
| Auth | Clerk |
| Payments | Stripe |
| Database | PostgreSQL (Neon serverless) + Drizzle ORM |
| Job Queue | Upstash Redis + QStash |
| Video Worker | Python 3.12 + ffmpeg 6 |
| File Storage | Cloudflare R2 |
| AI | Anthropic Claude (Vision + narration) |
| TTS | ElevenLabs Turbo v2.5 |
| Email | Resend |

## Deploy to Railway (5 minutes)

### 1. Install Railway CLI

```bash
npm install -g @railway/cli
railway login
```

### 2. Create project and link

```bash
cd /path/to/listingreel
railway init        # creates a new Railway project
railway link        # or link to existing project
```

### 3. Set environment variables

In the Railway dashboard → your project → each service → Variables, add all vars from `.env.example`.

Or via CLI (faster):

```bash
# Web service
railway variables set --service web \
  ANTHROPIC_API_KEY=sk-ant-... \
  CLERK_SECRET_KEY=sk_live_... \
  NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY=pk_live_... \
  STRIPE_SECRET_KEY=sk_live_... \
  STRIPE_WEBHOOK_SECRET=whsec_... \
  DATABASE_URL=postgresql://... \
  UPSTASH_REDIS_URL=https://... \
  UPSTASH_REDIS_TOKEN=... \
  QSTASH_TOKEN=... \
  QSTASH_CURRENT_SIGNING_KEY=sig_... \
  QSTASH_NEXT_SIGNING_KEY=sig_... \
  R2_ACCOUNT_ID=... \
  R2_ACCESS_KEY_ID=... \
  R2_SECRET_ACCESS_KEY=... \
  R2_BUCKET_NAME=listingreel-videos \
  R2_PUBLIC_URL=https://pub-xxx.r2.dev \
  WORKER_SECRET=$(openssl rand -hex 32) \
  RESEND_API_KEY=re_... \
  EMAIL_FROM=noreply@listingreel.com

# After web deploys, copy its Railway URL and set:
railway variables set --service web \
  NEXT_PUBLIC_APP_URL=https://web-xxxx.railway.app

# Worker service — copy WORKER_SECRET from above
railway variables set --service worker \
  ANTHROPIC_API_KEY=sk-ant-... \
  ELEVENLABS_API_KEY=... \
  DATABASE_URL=postgresql://... \
  UPSTASH_REDIS_URL=https://... \
  UPSTASH_REDIS_TOKEN=... \
  R2_ACCOUNT_ID=... \
  R2_ACCESS_KEY_ID=... \
  R2_SECRET_ACCESS_KEY=... \
  R2_BUCKET_NAME=listingreel-videos \
  R2_PUBLIC_URL=https://pub-xxx.r2.dev \
  WORKER_SECRET=<same-as-web> \
  NEXT_APP_URL=https://web-xxxx.railway.app \
  QSTASH_CURRENT_SIGNING_KEY=sig_... \
  QSTASH_NEXT_SIGNING_KEY=sig_...
```

### 4. Push database schema

```bash
cd apps/web
npm install
DATABASE_URL="postgresql://..." npm run db:push
```

### 5. Deploy

```bash
cd /path/to/listingreel
railway up
```

Railway builds both Dockerfiles and deploys them. You'll get two URLs — use the `web` service URL.

### 6. Configure webhooks

After deploy, set these in your third-party dashboards:

| Service | Webhook URL |
|---------|------------|
| Clerk | `https://web-xxxx.railway.app/api/webhooks/clerk` |
| Stripe | `https://web-xxxx.railway.app/api/webhooks/stripe` |
| QStash destination | `https://worker-xxxx.railway.app/process` |

---

## Video Pipeline (5 Stages)

1. **Classify & Sort** — Claude Vision labels rooms, orders exterior→living→kitchen→beds→baths
2. **Narrate** — Claude Vision writes 1–3 sentence narration per clip with tone control
3. **TTS** — ElevenLabs Turbo v2.5 (Rachel) generates per-clip MP3
4. **Clip Render** — ffmpeg Ken Burns zoom, warm color grade, vignette, 1920×1080
5. **Assemble** — ffmpeg xfade cross-dissolve + music mix (8%) + subtitles → MP4 → R2

## Cost Per Video

| Service | Cost |
|---------|------|
| Claude Vision (classify + narrate) | ~$0.12 |
| ElevenLabs TTS (~800 chars) | ~$0.10 |
| R2 storage | ~$0.002 |
| Railway compute (~6 min) | ~$0.04 |
| **Total COGS** | **~$0.26–0.35** |

At $49/video → ~99% gross margin.

## Environment Variables

See `.env.example` for the full list with descriptions.
