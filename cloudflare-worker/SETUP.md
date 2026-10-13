# DAC's AI worker (`dacs-ai`) — setup

The portal's AI features call this Cloudflare Worker:

| Feature | Caller | Who may use it | Answer cap |
|---|---|---|---|
| `budget_summary` — Project Control AI budget summary | `js/ai-summary.js` | active **owner** accounts (module-focused: `expenses`) | 700 tokens, input 4,000 characters |
| `work_plan_draft` — Work Plan meeting drafts | `js/workplan-admin-core.js` | active **owner or staff** (module-focused: `workplan`) | 2,000 tokens, input 40,000 characters |
| `health_briefing` — Project Control AI health briefing | `js/ai-assistant.js` | active **owner** accounts (module-focused: `expenses`) | 600 tokens, input 12,000 characters |

All three features (`work_plan_draft`, `budget_summary`, `health_briefing`) use **Cloudflare Workers AI** model `@cf/meta/llama-3.3-70b-instruct-fp8-fast` (Llama 3.1 8B was retired on 30 May 2026). No external AI provider, no API key, no secret.

```
Portal (signed in) → dacs-ai worker → ai_authorize() in Supabase (as the caller) → Workers AI → answer
```

## How requests are checked

1. No `Authorization: Bearer <Supabase session>` header → refused (401).
2. Flood guard: 30 requests per 60 s per connecting address (`PREAUTH_LIMITER`).
3. Body ≤ 64 KB, 1–4 messages (`system`/`user`), input within the feature's size.
4. `ai_authorize()` (migration 0095), run as the caller: active account, allowed feature, size, and limits — per person drafts 10 per 10 minutes and 50 per rolling 24 hours, summaries 20 per 10 minutes and 100 per rolling 24 hours, briefings 20 per 10 minutes and 100 per rolling 24 hours; per company 300 per rolling 24 hours ("rolling" = the 24 hours before the request, not a calendar day). Each allowed request is recorded in `ai_requests` (never the text).

The worker chooses the model and the answer length; a `model` sent by the browser is ignored.

## Deploy

Order: **apply migration 0095 first** (without it every AI request is refused). In a terminal inside the `cloudflare-worker` folder:

```powershell
npx wrangler --version                                  # must be 4.36 or newer (rate-limit binding)
npx wrangler login                                      # first time only
npx wrangler ai models --json | findstr "llama-3.3-70b-instruct-fp8-fast"   # the model must be listed
npx wrangler deploy
```

The worker URL is `https://dacs-ai.dacsbuilding.workers.dev` (`AI_WORKER_URL` in `js/ai-summary.js`, `js/ai-assistant.js` and `js/workplan-admin-core.js`).

## Configuration

`wrangler.toml` (tracked in git): the `[ai]` binding, `[vars]` `SUPABASE_URL` / `SUPABASE_ANON_KEY` (public values, the same as `js/supabase-config.js`), and the `PREAUTH_LIMITER` binding. `ALLOWED_ORIGINS` in `worker.js` lists the local dev server and the live site; any `*.vercel.app` preview is also allowed.

## Privacy

Meeting notes sent for drafting go to Workers AI on Cloudflare (approved, WorkMate spec §15). The office reviews every draft before anything reaches workers.
