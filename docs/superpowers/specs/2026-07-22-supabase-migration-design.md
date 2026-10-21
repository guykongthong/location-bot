# Migrate location-bot from Railway to Supabase Edge Functions

## Context

`location-bot` is a LINE push-notification bot: an always-on Express server
(Dockerfile + `railway.toml`) using `better-sqlite3` for local file storage,
deployed to Railway. The user is no longer using Railway and wants to move
deployment to Supabase.

Supabase is not a drop-in container host — it provides Postgres, Auth,
Storage, and Deno-based serverless Edge Functions rather than long-running
Docker processes. This is a full rewrite: the Express app becomes a set of
Supabase Edge Functions, and `better-sqlite3` becomes Supabase Postgres.

## Architecture

Five independent Supabase Edge Functions (Deno + TypeScript), replacing the
five current Express routes, sharing common code via `_shared/`:

```
supabase/
  functions/
    _shared/
      db.ts               — supabase-js client (service role) + query helpers
      auth.ts             — x-secret header check
      line.ts             — LINE REST calls (push message, profile/group
                             lookup) + webhook signature verification
      arrivedHandler.ts   — shared logic for arrived-home / arrived-uni
    webhook/index.ts
    arrived-home/index.ts
    arrived-uni/index.ts
    recipients/index.ts
    health/index.ts
  migrations/
    0001_init.sql
scripts/
  migrate-to-supabase.js  — one-off: copies data/bot.db rows into Supabase
```

`Dockerfile`, `railway.toml`, `.dockerignore`, `src/`, `data/`, and the
`better-sqlite3`/`express`/`@line/bot-sdk`/`dotenv`/`nodemon` dependencies are
removed. `README.md` is rewritten for the new deploy flow.

## LINE integration (no SDK)

`@line/bot-sdk` is a Node package and not reliably supported on Deno's edge
runtime. Instead of attempting an `npm:` import, `_shared/line.ts`
reimplements the pieces used by this app directly:

- **Webhook signature verification**: compute HMAC-SHA256 over the raw
  request body using `LINE_CHANNEL_SECRET` via `crypto.subtle`, base64-encode,
  compare against the `x-line-signature` header. Deno's edge runtime gives
  the raw body naturally — no raw-body-before-`express.json()` ordering
  hack needed, unlike the current Express setup.
- **Push messages**: `fetch POST https://api.line.me/v2/bot/message/push`
  with `Authorization: Bearer <LINE_CHANNEL_ACCESS_TOKEN>`.
- **Name resolution**: `fetch GET https://api.line.me/v2/bot/profile/{userId}`
  or `.../group/{groupId}/summary`, matching the current `resolveName` logic.

## Data model

Same three tables, translated to Postgres (`supabase/migrations/0001_init.sql`):

```sql
create table recipients (
  user_id    text primary key,
  active     boolean not null default true,
  created_at timestamptz not null default now()
);

create table message_log (
  id      bigint generated always as identity primary key,
  user_id text not null,
  sent_at timestamptz not null default now()
);

create table config (
  key   text primary key,
  value text not null
);
```

`_shared/db.ts` exposes the same query shapes the routes already rely on:
`getActiveRecipients`, `getAllRecipients`, `upsertRecipient`,
`deactivateRecipient`, `deleteRecipient`, `activeCount`, `logMessage`,
`monthlyCount` (via `sent_at`), `getConfig`/`setConfig`. Uses the Supabase
**service role key** — safe here since edge functions run server-side only,
same trust boundary as the current SQLite file.

## Function behavior & auth

- **`webhook`** — public (no `x-secret`); LINE calls this directly.
  Verifies `x-line-signature` (see above). On `follow`/`join` →
  `upsertRecipient`; on `unfollow`/`leave` → `deactivateRecipient`.
  `verify_jwt = false` in `supabase/config.toml` (LINE doesn't send a
  Supabase JWT).
- **`arrived-home`** / **`arrived-uni`** — thin wrappers around
  `_shared/arrivedHandler.ts`, parameterized by message text + cooldown key
  (mirrors current `createArrivedRouter(text, cooldownKey)`). Checks
  `x-secret` via `_shared/auth.ts`. Enforces the existing 30-minute cooldown
  via the `config` table. Pushes to all active recipients via
  `line.ts#pushMessage`, logs each send, warns in logs at 400/month (LINE
  free tier is 500/month). `verify_jwt = false`.
- **`recipients`** — `GET` (list recipients + resolve display names) and
  `DELETE` (remove by `userId`, taken from the request URL path). Same
  `x-secret` check. `verify_jwt = false`.
- **`health`** — public, no auth. Returns
  `{ status, activeRecipients, monthlyMessageCount }`. `uptimeSeconds` is
  dropped — edge functions are stateless/serverless, so process uptime is
  not a meaningful concept here (this is an intentional behavior change,
  not an oversight).

## Data migration

A one-off Node script, `scripts/migrate-to-supabase.js` (not deployed, run
once locally, safe to delete after use):

- Opens `data/bot.db` with `better-sqlite3`.
- Reads all rows from `recipients`, `message_log`, `config`.
- Inserts them into the corresponding Supabase tables using `supabase-js`
  with the service role key (loaded from a local `.env`, never committed).

## Deployment

- `supabase link` to the target Supabase project.
- `supabase db push` to apply `0001_init.sql`.
- `node scripts/migrate-to-supabase.js` to carry over existing recipients.
- `supabase secrets set LINE_CHANNEL_ACCESS_TOKEN=... LINE_CHANNEL_SECRET=...
  TRIGGER_SECRET=... HOME_MESSAGE=... UNI_MESSAGE=...`
- `supabase functions deploy` (all functions, or one at a time).
- Endpoints move to `https://<project-ref>.supabase.co/functions/v1/<name>`.
  Update the LINE Developers Console webhook URL and the iOS Shortcut URL
  after cutover.

## Testing

- Local dev/testing via `supabase functions serve` against a local or linked
  Supabase Postgres instance, using `curl` the same way the current README
  demonstrates (`X-Secret` header, etc.).
- Manually verify: LINE webhook signature acceptance/rejection, follow/unfollow
  recipient tracking, cooldown enforcement on `arrived-home`/`arrived-uni`,
  recipient list/delete, health response shape.
