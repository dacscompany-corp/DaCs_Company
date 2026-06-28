# Nightly Project-Management Push — Setup

Daily at **11:59 PM Philippine time**, the admin gets a notification for a chosen
project: **Remaining cash receipt · Progress · Direct cost · Today's expenses ·
Revolving-fund running balance** — even when the app is closed.

Pieces: a service worker + bell toggle (already in the app) → `push_subscriptions`
table → this Cloudflare cron worker that computes the numbers and sends the push.

## 1. Generate VAPID keys (one keypair, once)
```bash
npx web-push generate-vapid-keys
```
Copy the **Public Key** and **Private Key** it prints.

## 2. Put the PUBLIC key in the app
Edit `js/push-notify.js`:
```js
const PM_VAPID_PUBLIC_KEY = 'PASTE_THE_PUBLIC_KEY_HERE';
```

## 3. Create the database table
In Supabase → SQL Editor, run the contents of
`supabase/migrations/0011_push_subscriptions.sql` (same as the revolving-fund step).

## 4. Configure & deploy the worker
```bash
cd cloudflare-worker-notify
# edit wrangler.toml → set SUPABASE_URL to your project URL
npx wrangler secret put SUPABASE_SERVICE_ROLE   # Supabase → Settings → API → service_role key
npx wrangler secret put VAPID_PUBLIC            # the public key from step 1
npx wrangler secret put VAPID_PRIVATE           # the private key from step 1
npx wrangler secret put VAPID_SUBJECT           # e.g. mailto:you@yourdomain.com
npx wrangler secret put TRIGGER_KEY             # any random string (for testing)
npx wrangler deploy
```
The cron is already set to `59 15 * * *` (15:59 UTC = 11:59 PM PHT).

## 5. Turn it on (per device)
Open the admin app on the phone/computer that should receive it → open a project →
**Project Management workspace** → tap **🔔 Notify me daily** in the top bar → Allow.
Repeat on each device/project you want.

## 6. Test without waiting for midnight
```
https://dacs-notify.<your-subdomain>.workers.dev/run?key=YOUR_TRIGGER_KEY
```
A notification should arrive within a few seconds on any subscribed device.

## Notes
- **HTTPS required.** Web Push only works on `https://` (your Vercel URL) — not on
  `http://127.0.0.1:5501`. Test the bell/permission on the deployed site.
- The service-role key bypasses RLS so the worker can read every project's numbers;
  keep it a **secret** (never in client code).
- Dead subscriptions (uninstalled/expired) are auto-removed when the push returns 404/410.
- Timezone: change the cron in `wrangler.toml` if you ever need a different time
  (Cloudflare crons are UTC; PHT = UTC+8).
