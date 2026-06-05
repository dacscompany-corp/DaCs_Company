# AI Budget Summary — Setup (free tools only)

This adds a **✨ AI summary** button to each project-folder card. It uses:

- **Groq** — free, fast LLM API (runs `llama-3.3-70b-versatile`)
- **Cloudflare Worker** — free proxy that hides your Groq API key

```
Portal (admin.html) → Cloudflare Worker (holds key) → Groq → summary
```

Everything below is **100% free** and needs **no credit card**.

---

## STEP 1 — Get a free Groq API key

1. Go to https://console.groq.com and sign in (Google/GitHub — free).
2. Left menu → **API Keys** → **Create API Key**.
3. Name it `dacs-portal`, click **Submit**, and **copy the key** (starts with `gsk_...`).
   You only see it once — copy it now.

---

## STEP 2 — Create a free Cloudflare account

1. Go to https://dash.cloudflare.com/sign-up and create a free account.
2. Verify your email.

---

## STEP 3 — Deploy the Worker

You can deploy from the command line. In a terminal **inside the `cloudflare-worker` folder**:

```powershell
cd "cloudflare-worker"
npx wrangler login          # opens a browser, click "Allow"
npx wrangler secret put GROQ_API_KEY
#   ↑ paste your gsk_... key when prompted, press Enter
npx wrangler deploy
```

After `deploy`, Wrangler prints your worker URL, e.g.:

```
https://dacs-ai.YOURNAME.workers.dev
```

**Copy that URL** — you need it in Step 4.

> No command line? Use the dashboard instead:
> Cloudflare dashboard → **Workers & Pages** → **Create** → **Create Worker** →
> paste the contents of `worker.js` → **Deploy**. Then open the worker →
> **Settings → Variables → Add variable**, name `GROQ_API_KEY`, paste your key,
> check **Encrypt**, **Save**.

---

## STEP 4 — Point the portal at your Worker

1. Open `js/ai-summary.js`.
2. Find this line near the top:
   ```js
   const AI_WORKER_URL = 'PASTE_YOUR_WORKER_URL_HERE';
   ```
3. Replace it with your worker URL from Step 3:
   ```js
   const AI_WORKER_URL = 'https://dacs-ai.YOURNAME.workers.dev';
   ```
4. Save.

---

## STEP 5 — (When you go live) allow your real domain

In `worker.js`, add your deployed site URL to `ALLOWED_ORIGINS`, e.g.:

```js
const ALLOWED_ORIGINS = [
  'http://127.0.0.1:5501',
  'http://localhost:5501',
  'https://your-app.web.app',   // ← your Firebase Hosting URL
];
```
Then re-run `npx wrangler deploy`.

---

## Done — test it

1. Hard-refresh the portal: **Ctrl + Shift + R**
2. Go to **Project Control → Overview**
3. Hover a project card → click the **✨** button (top-right, next to ✏️ / 🗑️)
4. A modal opens and writes a budget summary in a few seconds.

### Troubleshooting
- **"AI is not configured yet"** → you skipped Step 4 (worker URL not set).
- **CORS error in console** → add your current site origin to `ALLOWED_ORIGINS` in `worker.js`, redeploy.
- **"GROQ_API_KEY secret not set"** → re-run `npx wrangler secret put GROQ_API_KEY`.
- **Free limits:** Groq free tier is ~30 requests/min, plenty for this. If you hit a limit, wait a minute.
