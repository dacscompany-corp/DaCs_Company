# Firebase → Supabase migration runbook

One-time migration of **Firebase Auth + Firestore** into the Supabase Postgres
schema (`supabase/migrations/0001_init.sql` … `0003_auth_hooks.sql`).
Passwords are **preserved** (no forced reset).

## 0. Prerequisites
- A Supabase project created; note its **URL**, **anon key**, **service_role key**.
- Supabase CLI installed and linked: `supabase link --project-ref <ref>`.
- Node 18+.
- In **Supabase → Auth → Providers → Email**: turn **"Confirm email" OFF**
  (Firebase didn't gate on verification; this keeps signups working immediately).

## 1. Apply the schema
```bash
supabase db push          # runs supabase/migrations/*.sql in order
```
Verify in the SQL editor that ~35 tables + RLS policies exist.

Also create a **public Storage bucket named `uploads`** (Supabase → Storage → New bucket,
Public). The procurement-receipt upload in `pm-admin.js` uses `storage.ref(path).put()`,
which the shim maps to this bucket. (Most other images are stored inline as base64.)

## 2. Migrate AUTH (passwords kept) — firebase-to-supabase
The community tool imports Firebase users into `auth.users` and installs a
Postgres function that verifies **Firebase scrypt** hashes.

```bash
# a) Export Firebase auth users (also used by step 3 for the uid map)
firebase auth:export users.json --project dacs-building-design
# Put users.json in this folder (tools/migrate/).

# b) Clone + run the importer (one-time)
git clone https://github.com/supabase-community/firebase-to-supabase
cd firebase-to-supabase/auth
#   configure supabase-service.json (host, password, etc.) per its README, then:
node import_users.js ../../users.json
#   It also prints/installs the scrypt verify function + your Firebase hash params
#   (signer key, salt separator, rounds, mem cost) from the Firebase console
#   (Authentication → Users → ⋯ → Password hash parameters).
```
After this, every Firebase user exists in Supabase Auth and can log in with their
**existing password**.

## 3. Migrate DATA (Firestore → Postgres)
```bash
cd tools/migrate
npm install
# place service-account.json (Firebase Admin key) + users.json here
export SUPABASE_URL="https://<ref>.supabase.co"
export SUPABASE_SERVICE_ROLE_KEY="<service_role key>"

npm run migrate:dry      # dry run — prints counts, writes nothing
npm run migrate          # real migration (idempotent; safe to re-run)
```
What it does:
- builds `firebase uid → supabase uuid` by joining `users.json` emails to the
  already-imported Supabase auth users;
- merges `users`/`clientUsers`/`constructionClientUsers` → **`profiles`**;
- inserts every collection in dependency order, rewriting owner/uid fields,
  resolving cross-doc FKs (`folder_id`, `project_id`, `construction_project_id`,
  `batch_id`), normalising invoice/request line items into child tables, and
  flattening `notifications/{uid}/items` → `notifications`.

## 4. Deploy the Edge Function
```bash
supabase functions deploy admin-create-user
```
(Service role + URL are injected automatically as function env.)

## 5. Point the frontend at Supabase
Edit `js/supabase-config.js`:
```js
const SUPABASE_URL      = 'https://<ref>.supabase.co';
const SUPABASE_ANON_KEY = '<anon/publishable key>';
```
Also add your live origin to `ALLOWED_ORIGINS` in
`supabase/functions/admin-create-user/index.ts` and the Cloudflare worker.

## 6. Verify
See the **Verification** section of the plan
(`.claude/plans/sparkling-meandering-shamir.md`) — RLS role tests, app E2E per
role, and the realtime check.

---
### Files expected in this folder (gitignored — secrets)
```
service-account.json   # Firebase Admin SDK private key
users.json             # firebase auth:export output
```
