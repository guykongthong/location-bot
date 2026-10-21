# location-bot: Railway → Supabase Edge Functions Migration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the Railway-deployed Express/SQLite LINE bot with Supabase Edge Functions (Deno) backed by Supabase Postgres, with zero loss of existing recipients/config data.

**Architecture:** Five independent Supabase Edge Functions (`webhook`, `arrived-home`, `arrived-uni`, `recipients`, `health`) share code via `supabase/functions/_shared/` (db access, shared-secret auth check, LINE REST calls, arrived-trigger logic). Postgres replaces SQLite via three tables (`recipients`, `message_log`, `config`) created by a migration file. A one-off Node script migrates existing SQLite data into Postgres.

**Tech Stack:** Deno + TypeScript (Edge Functions runtime), Supabase Postgres, Supabase CLI, `@supabase/supabase-js` (both in Deno edge functions via `npm:` specifier, and in the one-off Node migration script), Node.js + `better-sqlite3` (migration script only).

## Global Constraints

- No `@line/bot-sdk`, no Express, no Docker, no `railway.toml` in the final state — spec requires the Node SDK be dropped entirely in favor of direct LINE REST calls (`docs/superpowers/specs/2026-07-22-supabase-migration-design.md`).
- Preserve exact existing behavior: 30-minute cooldown (`COOLDOWN_MS = 30 * 60 * 1000`) on `arrived-home`/`arrived-uni`; monthly-push warning logged at `>= 400` (LINE free tier is 500/month); `x-secret` header shared-secret auth on `arrived-home`, `arrived-uni`, `recipients`; LINE `x-line-signature` HMAC-SHA256 verification on `webhook`; `follow`/`join` → active recipient, `unfollow`/`leave` → inactive recipient.
- `health` drops `uptimeSeconds` (not meaningful for stateless edge functions) — response becomes `{ status, activeRecipients, monthlyMessageCount }` per the approved spec.
- All 5 edge functions need `verify_jwt = false` in `supabase/config.toml` — none of the callers (LINE, iOS Shortcuts, curl) send a Supabase JWT.
- `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` are auto-injected into edge functions by the Supabase runtime — never set these manually as secrets.
- Custom secrets needed in both local dev and production: `LINE_CHANNEL_ACCESS_TOKEN`, `LINE_CHANNEL_SECRET`, `TRIGGER_SECRET`, `HOME_MESSAGE` (optional, defaults to `'I just got home! 🏠'`), `UNI_MESSAGE` (optional, defaults to `'คุณกายถึงมหาลัยแล้ว'`).

---

### Task 1: Install prerequisites and scaffold the Supabase project

**Files:**
- Create: `supabase/config.toml` (via `supabase init`)
- Create: `supabase/.gitignore` entry for `supabase/.env` (local secrets file)

**Interfaces:**
- Produces: a linked Supabase project that later tasks push migrations and deploy functions to; a local `supabase/.env` file (gitignored) holding `LINE_CHANNEL_ACCESS_TOKEN`, `LINE_CHANNEL_SECRET`, `TRIGGER_SECRET`, `HOME_MESSAGE`, `UNI_MESSAGE` for local dev.

- [ ] **Step 1: Install the Supabase CLI and Deno**

```bash
brew install supabase/tap/supabase
brew install deno
```

Expected: `supabase --version` and `deno --version` both print version numbers.

- [ ] **Step 2: Log in to Supabase**

```bash
supabase login
```

This opens a browser to authorize the CLI. Expected: `Finished supabase login.`

- [ ] **Step 3: Create the Supabase project**

Go to https://supabase.com/dashboard → **New Project** → name it `location-bot`, pick a region, set a database password (save it somewhere safe — you won't need it for this plan, but you'll want it later). Wait for provisioning to finish (a couple of minutes).

Once ready, go to **Project Settings → General** and copy the **Reference ID** (a short alphanumeric string). This is `<PROJECT_REF>` for all remaining steps in this plan — substitute your real value.

- [ ] **Step 4: Initialize the Supabase scaffold in the repo**

```bash
cd /Users/guykongthong/Desktop/software-engineering/code/personal/projects/location-bot
supabase init
```

Expected: creates `supabase/config.toml` and `supabase/functions/` (may be empty or contain a sample function — delete any sample function directory it creates).

- [ ] **Step 5: Link the repo to the Supabase project**

```bash
supabase link --project-ref <PROJECT_REF>
```

Expected: `Finished supabase link.`

- [ ] **Step 6: Create the local secrets file for `supabase functions serve`**

Create `supabase/.env` (do NOT commit this):

```
LINE_CHANNEL_ACCESS_TOKEN=your_channel_access_token_here
LINE_CHANNEL_SECRET=your_channel_secret_here
TRIGGER_SECRET=your_shared_secret_here
HOME_MESSAGE=I just got home! 🏠
UNI_MESSAGE=คุณกายถึงมหาลัยแล้ว
```

Use the same real values from your existing `.env` (Railway/LINE credentials don't change).

- [ ] **Step 7: Add `supabase/.env` to `.gitignore`**

Edit `.gitignore`:

```
node_modules/
.env
data/*.db
supabase/.env
```

- [ ] **Step 8: Commit the scaffold**

```bash
git add supabase/config.toml .gitignore
git commit -m "chore: scaffold Supabase project for edge functions migration"
```

(If `supabase init` created other files like `supabase/.gitignore` or `supabase/seed.sql`, add those too.)

---

### Task 2: Database schema migration

**Files:**
- Create: `supabase/migrations/0001_init.sql`

**Interfaces:**
- Produces: `recipients(user_id text primary key, active boolean, created_at timestamptz)`, `message_log(id bigint identity, user_id text, sent_at timestamptz)`, `config(key text primary key, value text)` — the exact tables `_shared/db.ts` (Task 6) queries against.

- [ ] **Step 1: Write the migration**

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

Save this as `supabase/migrations/0001_init.sql`.

- [ ] **Step 2: Start the local Supabase stack**

```bash
supabase start
```

Expected: after Docker pulls images (first run takes a few minutes), prints a table including `API URL`, `DB URL`, `service_role key`, etc. Keep this running for the rest of the plan's local testing.

- [ ] **Step 3: Apply the migration locally**

```bash
supabase db reset
```

Expected: `Applying migration 0001_init.sql...` followed by success output.

- [ ] **Step 4: Verify the tables exist**

```bash
psql "$(supabase status -o env | grep DB_URL | cut -d= -f2 | tr -d '\"')" -c '\dt'
```

Expected: lists `recipients`, `message_log`, `config` (plus Supabase's own internal tables).

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/0001_init.sql
git commit -m "feat: add recipients/message_log/config schema migration"
```

---

### Task 3: Shared auth check

**Files:**
- Create: `supabase/functions/_shared/auth.ts`
- Test: `supabase/functions/_shared/auth.test.ts`

**Interfaces:**
- Produces: `checkSecret(req: Request, expected: string): boolean` — used by Tasks 9, 10, 11 (`arrived-home`, `arrived-uni`, `recipients`).

- [ ] **Step 1: Write the failing test**

Create `supabase/functions/_shared/auth.test.ts`:

```typescript
import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { checkSecret } from "./auth.ts";

Deno.test("checkSecret returns true when header matches", () => {
  const req = new Request("https://example.com", {
    headers: { "x-secret": "correct-secret" },
  });
  assertEquals(checkSecret(req, "correct-secret"), true);
});

Deno.test("checkSecret returns false when header does not match", () => {
  const req = new Request("https://example.com", {
    headers: { "x-secret": "wrong-secret" },
  });
  assertEquals(checkSecret(req, "correct-secret"), false);
});

Deno.test("checkSecret returns false when header is missing", () => {
  const req = new Request("https://example.com");
  assertEquals(checkSecret(req, "correct-secret"), false);
});
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
deno test supabase/functions/_shared/auth.test.ts
```

Expected: FAIL — `Module not found "./auth.ts"`.

- [ ] **Step 3: Write the implementation**

Create `supabase/functions/_shared/auth.ts`:

```typescript
export function checkSecret(req: Request, expected: string): boolean {
  const secret = req.headers.get("x-secret");
  return !!secret && secret === expected;
}
```

- [ ] **Step 4: Run the test to verify it passes**

```bash
deno test supabase/functions/_shared/auth.test.ts
```

Expected: `ok | 3 passed | 0 failed`.

- [ ] **Step 5: Commit**

```bash
git add supabase/functions/_shared/auth.ts supabase/functions/_shared/auth.test.ts
git commit -m "feat: add shared-secret auth check for edge functions"
```

---

### Task 4: LINE webhook signature verification

**Files:**
- Create: `supabase/functions/_shared/line.ts`
- Test: `supabase/functions/_shared/line.test.ts`

**Interfaces:**
- Produces: `verifySignature(rawBody: string, signature: string | null, channelSecret: string): Promise<boolean>` — used by Task 8 (`webhook`).

- [ ] **Step 1: Write the failing test**

Create `supabase/functions/_shared/line.test.ts`:

```typescript
import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { verifySignature } from "./line.ts";

// Precomputed: printf '%s' '{"events":[]}' | openssl dgst -sha256 -hmac "testsecret" -binary | base64
const BODY = '{"events":[]}';
const SECRET = "testsecret";
const VALID_SIGNATURE = "7/zjpxmsANrs8ptIk/KkFoHlDrLSXUZV+eHj+1N7Rdg=";

Deno.test("verifySignature accepts a correct signature", async () => {
  assertEquals(await verifySignature(BODY, VALID_SIGNATURE, SECRET), true);
});

Deno.test("verifySignature rejects an incorrect signature", async () => {
  assertEquals(await verifySignature(BODY, "wrong-signature==", SECRET), false);
});

Deno.test("verifySignature rejects a missing signature", async () => {
  assertEquals(await verifySignature(BODY, null, SECRET), false);
});
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
deno test supabase/functions/_shared/line.test.ts
```

Expected: FAIL — `Module not found "./line.ts"`.

- [ ] **Step 3: Write the implementation (signature verification only for now)**

Create `supabase/functions/_shared/line.ts`:

```typescript
export async function verifySignature(
  rawBody: string,
  signature: string | null,
  channelSecret: string,
): Promise<boolean> {
  if (!signature) return false;

  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(channelSecret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sigBuffer = await crypto.subtle.sign(
    "HMAC",
    key,
    new TextEncoder().encode(rawBody),
  );
  const computed = btoa(String.fromCharCode(...new Uint8Array(sigBuffer)));
  return computed === signature;
}
```

- [ ] **Step 4: Run the test to verify it passes**

```bash
deno test supabase/functions/_shared/line.test.ts
```

Expected: `ok | 3 passed | 0 failed`.

- [ ] **Step 5: Commit**

```bash
git add supabase/functions/_shared/line.ts supabase/functions/_shared/line.test.ts
git commit -m "feat: add LINE webhook signature verification"
```

---

### Task 5: LINE push message and profile/group name resolution

**Files:**
- Modify: `supabase/functions/_shared/line.ts`
- Modify: `supabase/functions/_shared/line.test.ts`

**Interfaces:**
- Consumes: nothing new.
- Produces: `pushMessage(accessToken: string, to: string, text: string): Promise<void>` (used by Task 7 `arrivedHandler.ts`), `resolveName(accessToken: string, id: string): Promise<string | null>` (used by Task 10 `recipients`).

- [ ] **Step 1: Write the failing tests**

Append to `supabase/functions/_shared/line.test.ts`:

```typescript
import { pushMessage, resolveName } from "./line.ts";

function withMockedFetch(
  impl: (input: string | URL | Request, init?: RequestInit) => Promise<Response>,
  fn: () => Promise<void>,
) {
  const original = globalThis.fetch;
  globalThis.fetch = impl as typeof fetch;
  return fn().finally(() => {
    globalThis.fetch = original;
  });
}

Deno.test("pushMessage posts to the LINE push endpoint with the bearer token", async () => {
  let capturedUrl = "";
  let capturedInit: RequestInit | undefined;

  await withMockedFetch(
    (url, init) => {
      capturedUrl = url.toString();
      capturedInit = init;
      return Promise.resolve(new Response("{}", { status: 200 }));
    },
    async () => {
      await pushMessage("token-123", "Uabc", "hello");
    },
  );

  assertEquals(capturedUrl, "https://api.line.me/v2/bot/message/push");
  assertEquals(
    (capturedInit?.headers as Record<string, string>)["Authorization"],
    "Bearer token-123",
  );
  assertEquals(
    JSON.parse(capturedInit?.body as string),
    { to: "Uabc", messages: [{ type: "text", text: "hello" }] },
  );
});

Deno.test("pushMessage throws on a non-ok response", async () => {
  await withMockedFetch(
    () => Promise.resolve(new Response("bad request", { status: 400 })),
    async () => {
      let threw = false;
      try {
        await pushMessage("token-123", "Uabc", "hello");
      } catch {
        threw = true;
      }
      assertEquals(threw, true);
    },
  );
});

Deno.test("resolveName fetches a user profile for a user id", async () => {
  await withMockedFetch(
    (url) => {
      assertEquals(url.toString(), "https://api.line.me/v2/bot/profile/Uabc");
      return Promise.resolve(
        new Response(JSON.stringify({ displayName: "Guy" }), { status: 200 }),
      );
    },
    async () => {
      const name = await resolveName("token-123", "Uabc");
      assertEquals(name, "Guy");
    },
  );
});

Deno.test("resolveName fetches a group summary for a group id", async () => {
  await withMockedFetch(
    (url) => {
      assertEquals(url.toString(), "https://api.line.me/v2/bot/group/Cabc/summary");
      return Promise.resolve(
        new Response(JSON.stringify({ groupName: "Family" }), { status: 200 }),
      );
    },
    async () => {
      const name = await resolveName("token-123", "Cabc");
      assertEquals(name, "Family");
    },
  );
});

Deno.test("resolveName returns null on a failed lookup", async () => {
  await withMockedFetch(
    () => Promise.resolve(new Response("not found", { status: 404 })),
    async () => {
      const name = await resolveName("token-123", "Uabc");
      assertEquals(name, null);
    },
  );
});
```

- [ ] **Step 2: Run the tests to verify the new ones fail**

```bash
deno test supabase/functions/_shared/line.test.ts
```

Expected: the 3 existing `verifySignature` tests pass, the 5 new ones FAIL — `pushMessage is not a function` / `resolveName is not a function`.

- [ ] **Step 3: Add the implementation**

Append to `supabase/functions/_shared/line.ts`:

```typescript
export async function pushMessage(
  accessToken: string,
  to: string,
  text: string,
): Promise<void> {
  const res = await fetch("https://api.line.me/v2/bot/message/push", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${accessToken}`,
    },
    body: JSON.stringify({ to, messages: [{ type: "text", text }] }),
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`LINE push failed (${res.status}): ${body}`);
  }
}

export async function resolveName(
  accessToken: string,
  id: string,
): Promise<string | null> {
  const url = id.startsWith("C")
    ? `https://api.line.me/v2/bot/group/${id}/summary`
    : `https://api.line.me/v2/bot/profile/${id}`;

  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) return null;

  const data = await res.json();
  return id.startsWith("C") ? data.groupName : data.displayName;
}
```

- [ ] **Step 4: Run the tests to verify they all pass**

```bash
deno test supabase/functions/_shared/line.test.ts
```

Expected: `ok | 8 passed | 0 failed`.

- [ ] **Step 5: Commit**

```bash
git add supabase/functions/_shared/line.ts supabase/functions/_shared/line.test.ts
git commit -m "feat: add LINE push message and name resolution helpers"
```

---

### Task 6: Postgres-backed data access layer

**Files:**
- Create: `supabase/functions/_shared/db.ts`
- Test: `supabase/functions/_shared/db.test.ts`

**Interfaces:**
- Consumes: `supabase/migrations/0001_init.sql` tables (Task 2), local stack from `supabase start`.
- Produces: `createDb(supabaseUrl: string, serviceRoleKey: string)` returning an object with `getActiveRecipients(): Promise<string[]>`, `getAllRecipients(): Promise<{user_id: string, created_at: string}[]>`, `upsertRecipient(userId: string): Promise<void>`, `deactivateRecipient(userId: string): Promise<void>`, `deleteRecipient(userId: string): Promise<number>` (returns rows deleted), `activeCount(): Promise<number>`, `logMessage(userId: string): Promise<void>`, `monthlyCount(yearMonth: string): Promise<number>` (yearMonth like `"2026-07"`), `getConfig(key: string): Promise<string | null>`, `setConfig(key: string, value: string): Promise<void>`. Used by Tasks 7–11.

This is an integration test against the real local Postgres instance (via `supabase start`), since mocking `supabase-js`'s query builder would just re-test the mock. Requires `supabase start` running (Task 2, Step 2) and a clean schema (`supabase db reset`).

- [ ] **Step 1: Reset the local database to a clean state**

```bash
supabase db reset
```

Expected: migration reapplies, all tables empty.

- [ ] **Step 2: Get the local API URL and service role key**

```bash
supabase status
```

Note the `API URL` (e.g. `http://127.0.0.1:54321`) and `service_role key` — you'll pass these into the test.

- [ ] **Step 3: Write the failing test**

Create `supabase/functions/_shared/db.test.ts`:

```typescript
import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { createDb } from "./db.ts";

const SUPABASE_URL = Deno.env.get("TEST_SUPABASE_URL") ?? "http://127.0.0.1:54321";
const SERVICE_ROLE_KEY = Deno.env.get("TEST_SUPABASE_SERVICE_ROLE_KEY");

if (!SERVICE_ROLE_KEY) {
  throw new Error(
    "Set TEST_SUPABASE_SERVICE_ROLE_KEY (from `supabase status`) to run db.test.ts",
  );
}

Deno.test("recipient lifecycle: upsert, list, deactivate, delete", async () => {
  const db = createDb(SUPABASE_URL, SERVICE_ROLE_KEY!);

  await db.upsertRecipient("Utest1");
  assertEquals(await db.getActiveRecipients(), ["Utest1"]);
  assertEquals((await db.getAllRecipients()).map((r) => r.user_id), ["Utest1"]);
  assertEquals(await db.activeCount(), 1);

  await db.deactivateRecipient("Utest1");
  assertEquals(await db.getActiveRecipients(), []);
  assertEquals(await db.activeCount(), 0);

  await db.upsertRecipient("Utest1");
  const deleted = await db.deleteRecipient("Utest1");
  assertEquals(deleted, 1);
  assertEquals(await db.getActiveRecipients(), []);

  const deletedAgain = await db.deleteRecipient("Utest1");
  assertEquals(deletedAgain, 0);
});

Deno.test("message log and monthly count", async () => {
  const db = createDb(SUPABASE_URL, SERVICE_ROLE_KEY!);

  await db.logMessage("Utest2");
  await db.logMessage("Utest2");

  const now = new Date();
  const yearMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
  const count = await db.monthlyCount(yearMonth);
  assertEquals(count >= 2, true);

  const farFuture = "2099-01";
  assertEquals(await db.monthlyCount(farFuture), 0);
});

Deno.test("config get/set", async () => {
  const db = createDb(SUPABASE_URL, SERVICE_ROLE_KEY!);

  assertEquals(await db.getConfig("nonexistent_key"), null);

  await db.setConfig("last_trigger_home", "1234567890");
  assertEquals(await db.getConfig("last_trigger_home"), "1234567890");

  await db.setConfig("last_trigger_home", "9999999999");
  assertEquals(await db.getConfig("last_trigger_home"), "9999999999");
});
```

- [ ] **Step 4: Run the test to verify it fails**

```bash
supabase status  # copy the service_role key into the next command
TEST_SUPABASE_SERVICE_ROLE_KEY=<service_role_key> deno test --allow-net --allow-env supabase/functions/_shared/db.test.ts
```

Expected: FAIL — `Module not found "./db.ts"`.

- [ ] **Step 5: Write the implementation**

Create `supabase/functions/_shared/db.ts`:

```typescript
import { createClient } from "npm:@supabase/supabase-js@2";

export function createDb(supabaseUrl: string, serviceRoleKey: string) {
  const client = createClient(supabaseUrl, serviceRoleKey);

  return {
    async getActiveRecipients(): Promise<string[]> {
      const { data, error } = await client
        .from("recipients")
        .select("user_id")
        .eq("active", true);
      if (error) throw error;
      return data.map((r: { user_id: string }) => r.user_id);
    },

    async getAllRecipients(): Promise<{ user_id: string; created_at: string }[]> {
      const { data, error } = await client
        .from("recipients")
        .select("user_id, created_at")
        .eq("active", true);
      if (error) throw error;
      return data;
    },

    async upsertRecipient(userId: string): Promise<void> {
      const { error } = await client
        .from("recipients")
        .upsert({ user_id: userId, active: true });
      if (error) throw error;
    },

    async deactivateRecipient(userId: string): Promise<void> {
      const { error } = await client
        .from("recipients")
        .update({ active: false })
        .eq("user_id", userId);
      if (error) throw error;
    },

    async deleteRecipient(userId: string): Promise<number> {
      const { error, count } = await client
        .from("recipients")
        .delete({ count: "exact" })
        .eq("user_id", userId);
      if (error) throw error;
      return count ?? 0;
    },

    async activeCount(): Promise<number> {
      const { count, error } = await client
        .from("recipients")
        .select("*", { count: "exact", head: true })
        .eq("active", true);
      if (error) throw error;
      return count ?? 0;
    },

    async logMessage(userId: string): Promise<void> {
      const { error } = await client
        .from("message_log")
        .insert({ user_id: userId });
      if (error) throw error;
    },

    async monthlyCount(yearMonth: string): Promise<number> {
      const [y, m] = yearMonth.split("-").map(Number);
      const start = `${yearMonth}-01T00:00:00Z`;
      const end = m === 12
        ? `${y + 1}-01-01T00:00:00Z`
        : `${y}-${String(m + 1).padStart(2, "0")}-01T00:00:00Z`;

      const { count, error } = await client
        .from("message_log")
        .select("*", { count: "exact", head: true })
        .gte("sent_at", start)
        .lt("sent_at", end);
      if (error) throw error;
      return count ?? 0;
    },

    async getConfig(key: string): Promise<string | null> {
      const { data, error } = await client
        .from("config")
        .select("value")
        .eq("key", key)
        .maybeSingle();
      if (error) throw error;
      return data?.value ?? null;
    },

    async setConfig(key: string, value: string): Promise<void> {
      const { error } = await client.from("config").upsert({ key, value });
      if (error) throw error;
    },
  };
}
```

- [ ] **Step 6: Run the test to verify it passes**

```bash
TEST_SUPABASE_SERVICE_ROLE_KEY=<service_role_key> deno test --allow-net --allow-env supabase/functions/_shared/db.test.ts
```

Expected: `ok | 3 passed | 0 failed`.

- [ ] **Step 7: Commit**

```bash
git add supabase/functions/_shared/db.ts supabase/functions/_shared/db.test.ts
git commit -m "feat: add Postgres-backed data access layer for edge functions"
```

---

### Task 7: Shared arrived-trigger handler

**Files:**
- Create: `supabase/functions/_shared/arrivedHandler.ts`
- Test: `supabase/functions/_shared/arrivedHandler.test.ts`

**Interfaces:**
- Consumes: the `db` shape from Task 6 (`getConfig`, `setConfig`, `getActiveRecipients`, `logMessage`, `monthlyCount`) and `pushMessage` shape from Task 5 — injected as dependencies so this is testable without network or a live database.
- Produces: `handleArrived(deps: ArrivedDeps, text: string, cooldownKey: string): Promise<{status: number, body: unknown}>` — used by Task 9 (`arrived-home`, `arrived-uni`).

- [ ] **Step 1: Write the failing test**

Create `supabase/functions/_shared/arrivedHandler.test.ts`:

```typescript
import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { handleArrived } from "./arrivedHandler.ts";

function fakeDeps(overrides: Partial<{
  config: Record<string, string>;
  recipients: string[];
  monthlyCount: number;
  now: number;
  pushFailFor: Set<string>;
}> = {}) {
  const config: Record<string, string> = { ...(overrides.config ?? {}) };
  const recipients = overrides.recipients ?? ["Uabc"];
  const monthlyCount = overrides.monthlyCount ?? 1;
  const now = overrides.now ?? 1_000_000;
  const pushFailFor = overrides.pushFailFor ?? new Set<string>();
  const logged: string[] = [];
  const pushed: string[] = [];

  return {
    deps: {
      db: {
        getConfig: (key: string) => Promise.resolve(config[key] ?? null),
        setConfig: (key: string, value: string) => {
          config[key] = value;
          return Promise.resolve();
        },
        getActiveRecipients: () => Promise.resolve(recipients),
        logMessage: (userId: string) => {
          logged.push(userId);
          return Promise.resolve();
        },
        monthlyCount: () => Promise.resolve(monthlyCount),
      },
      pushMessage: (_token: string, to: string, _text: string) => {
        pushed.push(to);
        if (pushFailFor.has(to)) return Promise.reject(new Error("push failed"));
        return Promise.resolve();
      },
      accessToken: "token-123",
      now: () => now,
    },
    logged,
    pushed,
    config,
  };
}

Deno.test("sends to all active recipients and logs each send", async () => {
  const { deps, logged, pushed } = fakeDeps({ recipients: ["Uabc", "Cxyz"] });

  const result = await handleArrived(deps, "hello", "last_trigger_home");

  assertEquals(result.status, 200);
  assertEquals(result.body, {
    sent: 2,
    failed: 0,
    details: { sent: ["Uabc", "Cxyz"], failed: [] },
  });
  assertEquals(logged, ["Uabc", "Cxyz"]);
  assertEquals(pushed, ["Uabc", "Cxyz"]);
});

Deno.test("returns 429 when cooldown is active", async () => {
  const { deps } = fakeDeps({
    config: { last_trigger_home: String(1_000_000 - 5 * 60 * 1000) }, // 5 min ago
    now: 1_000_000,
  });

  const result = await handleArrived(deps, "hello", "last_trigger_home");

  assertEquals(result.status, 429);
  assertEquals((result.body as { error: string }).error, "Cooldown active");
  assertEquals((result.body as { remainingMinutes: number }).remainingMinutes, 25);
});

Deno.test("allows trigger once cooldown has elapsed", async () => {
  const { deps } = fakeDeps({
    config: { last_trigger_home: String(1_000_000 - 31 * 60 * 1000) }, // 31 min ago
    now: 1_000_000,
  });

  const result = await handleArrived(deps, "hello", "last_trigger_home");

  assertEquals(result.status, 200);
});

Deno.test("records failed pushes separately from successful ones", async () => {
  const { deps } = fakeDeps({
    recipients: ["Uabc", "Ubad"],
    pushFailFor: new Set(["Ubad"]),
  });

  const result = await handleArrived(deps, "hello", "last_trigger_home");

  assertEquals(result.body, {
    sent: 1,
    failed: 1,
    details: {
      sent: ["Uabc"],
      failed: [{ userId: "Ubad", error: "push failed" }],
    },
  });
});

Deno.test("returns sent:0 immediately when there are no active recipients", async () => {
  const { deps, pushed } = fakeDeps({ recipients: [] });

  const result = await handleArrived(deps, "hello", "last_trigger_home");

  assertEquals(result.body, { sent: 0, failed: 0, details: { sent: [], failed: [] } });
  assertEquals(pushed, []);
});
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
deno test supabase/functions/_shared/arrivedHandler.test.ts
```

Expected: FAIL — `Module not found "./arrivedHandler.ts"`.

- [ ] **Step 3: Write the implementation**

Create `supabase/functions/_shared/arrivedHandler.ts`:

```typescript
export interface ArrivedDb {
  getConfig(key: string): Promise<string | null>;
  setConfig(key: string, value: string): Promise<void>;
  getActiveRecipients(): Promise<string[]>;
  logMessage(userId: string): Promise<void>;
  monthlyCount(yearMonth: string): Promise<number>;
}

export interface ArrivedDeps {
  db: ArrivedDb;
  pushMessage: (accessToken: string, to: string, text: string) => Promise<void>;
  accessToken: string;
  now: () => number;
}

const COOLDOWN_MS = 30 * 60 * 1000;
const MONTHLY_WARN_THRESHOLD = 400;

export async function handleArrived(
  deps: ArrivedDeps,
  text: string,
  cooldownKey: string,
): Promise<{ status: number; body: unknown }> {
  const lastTrigger = await deps.db.getConfig(cooldownKey);
  if (lastTrigger) {
    const elapsed = deps.now() - parseInt(lastTrigger, 10);
    if (elapsed < COOLDOWN_MS) {
      const remainingMinutes = Math.ceil((COOLDOWN_MS - elapsed) / 60000);
      return { status: 429, body: { error: "Cooldown active", remainingMinutes } };
    }
  }

  await deps.db.setConfig(cooldownKey, String(deps.now()));

  const recipients = await deps.db.getActiveRecipients();
  if (recipients.length === 0) {
    return { status: 200, body: { sent: 0, failed: 0, details: { sent: [], failed: [] } } };
  }

  const results = {
    sent: [] as string[],
    failed: [] as { userId: string; error: string }[],
  };

  for (const userId of recipients) {
    try {
      await deps.pushMessage(deps.accessToken, userId, text);
      await deps.db.logMessage(userId);
      results.sent.push(userId);
    } catch (err) {
      results.failed.push({
        userId,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  const now = new Date(deps.now());
  const yearMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
  const monthlyCount = await deps.db.monthlyCount(yearMonth);
  if (monthlyCount >= MONTHLY_WARN_THRESHOLD) {
    console.warn(
      `Warning: Monthly push count is ${monthlyCount} — approaching LINE free tier limit (500/month)`,
    );
  }

  return {
    status: 200,
    body: { sent: results.sent.length, failed: results.failed.length, details: results },
  };
}
```

- [ ] **Step 4: Run the test to verify it passes**

```bash
deno test supabase/functions/_shared/arrivedHandler.test.ts
```

Expected: `ok | 5 passed | 0 failed`.

- [ ] **Step 5: Commit**

```bash
git add supabase/functions/_shared/arrivedHandler.ts supabase/functions/_shared/arrivedHandler.test.ts
git commit -m "feat: add shared arrived-trigger handler with cooldown and push logging"
```

---

### Task 8: `webhook` edge function

**Files:**
- Create: `supabase/functions/webhook/index.ts`
- Modify: `supabase/config.toml`

**Interfaces:**
- Consumes: `verifySignature` (Task 4), `createDb` (Task 6).

- [ ] **Step 1: Write the function**

Create `supabase/functions/webhook/index.ts`:

```typescript
import { verifySignature } from "../_shared/line.ts";
import { createDb } from "../_shared/db.ts";

const LINE_CHANNEL_SECRET = Deno.env.get("LINE_CHANNEL_SECRET")!;
const db = createDb(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
);

Deno.serve(async (req) => {
  if (req.method !== "POST") {
    return new Response("Method Not Allowed", { status: 405 });
  }

  const rawBody = await req.text();
  const signature = req.headers.get("x-line-signature");
  const valid = await verifySignature(rawBody, signature, LINE_CHANNEL_SECRET);
  if (!valid) {
    return new Response(JSON.stringify({ error: "Invalid signature" }), {
      status: 401,
      headers: { "Content-Type": "application/json" },
    });
  }

  const payload = JSON.parse(rawBody);
  const events = payload.events || [];

  for (const event of events) {
    const source = event.source || {};
    const recipientId = source.groupId || source.roomId || source.userId;
    if (!recipientId) continue;

    if (event.type === "follow" || event.type === "join") {
      await db.upsertRecipient(recipientId);
      console.log(`Recipient added: ${recipientId}`);
    } else if (event.type === "unfollow" || event.type === "leave") {
      await db.deactivateRecipient(recipientId);
      console.log(`Recipient deactivated: ${recipientId}`);
    }
  }

  return new Response(JSON.stringify({ ok: true }), {
    headers: { "Content-Type": "application/json" },
  });
});
```

- [ ] **Step 2: Disable JWT verification for this function**

Add to `supabase/config.toml`:

```toml
[functions.webhook]
verify_jwt = false
```

- [ ] **Step 3: Serve locally and test with a real signature**

In one terminal:

```bash
supabase functions serve webhook --env-file supabase/.env
```

In another terminal, compute a valid signature and send it (replace `your_channel_secret_here` with the real value from `supabase/.env`):

```bash
BODY='{"events":[{"type":"follow","source":{"userId":"Utest123"}}]}'
SIG=$(printf '%s' "$BODY" | openssl dgst -sha256 -hmac "your_channel_secret_here" -binary | base64)
curl -X POST http://127.0.0.1:54321/functions/v1/webhook \
  -H "Content-Type: application/json" \
  -H "x-line-signature: $SIG" \
  -d "$BODY"
```

Expected: `{"ok":true}`, and the terminal running `supabase functions serve` logs `Recipient added: Utest123`.

- [ ] **Step 4: Verify signature rejection**

```bash
curl -X POST http://127.0.0.1:54321/functions/v1/webhook \
  -H "Content-Type: application/json" \
  -H "x-line-signature: bogus" \
  -d "$BODY"
```

Expected: `{"error":"Invalid signature"}` with a 401 status.

- [ ] **Step 5: Commit**

```bash
git add supabase/functions/webhook/index.ts supabase/config.toml
git commit -m "feat: add webhook edge function"
```

---

### Task 9: `arrived-home` and `arrived-uni` edge functions

**Files:**
- Create: `supabase/functions/arrived-home/index.ts`
- Create: `supabase/functions/arrived-uni/index.ts`
- Modify: `supabase/config.toml`

**Interfaces:**
- Consumes: `handleArrived` (Task 7), `createDb` (Task 6), `checkSecret` (Task 3), `pushMessage` (Task 5).

- [ ] **Step 1: Write `arrived-home`**

Create `supabase/functions/arrived-home/index.ts`:

```typescript
import { handleArrived } from "../_shared/arrivedHandler.ts";
import { createDb } from "../_shared/db.ts";
import { checkSecret } from "../_shared/auth.ts";
import { pushMessage } from "../_shared/line.ts";

const TRIGGER_SECRET = Deno.env.get("TRIGGER_SECRET")!;
const LINE_CHANNEL_ACCESS_TOKEN = Deno.env.get("LINE_CHANNEL_ACCESS_TOKEN")!;
const HOME_MESSAGE = Deno.env.get("HOME_MESSAGE") || "I just got home! 🏠";
const db = createDb(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
);

Deno.serve(async (req) => {
  if (req.method !== "POST") {
    return new Response("Method Not Allowed", { status: 405 });
  }
  if (!checkSecret(req, TRIGGER_SECRET)) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401,
      headers: { "Content-Type": "application/json" },
    });
  }

  const result = await handleArrived(
    { db, pushMessage, accessToken: LINE_CHANNEL_ACCESS_TOKEN, now: () => Date.now() },
    HOME_MESSAGE,
    "last_trigger_home",
  );

  return new Response(JSON.stringify(result.body), {
    status: result.status,
    headers: { "Content-Type": "application/json" },
  });
});
```

- [ ] **Step 2: Write `arrived-uni`**

Create `supabase/functions/arrived-uni/index.ts` (identical shape, different message/env var/cooldown key):

```typescript
import { handleArrived } from "../_shared/arrivedHandler.ts";
import { createDb } from "../_shared/db.ts";
import { checkSecret } from "../_shared/auth.ts";
import { pushMessage } from "../_shared/line.ts";

const TRIGGER_SECRET = Deno.env.get("TRIGGER_SECRET")!;
const LINE_CHANNEL_ACCESS_TOKEN = Deno.env.get("LINE_CHANNEL_ACCESS_TOKEN")!;
const UNI_MESSAGE = Deno.env.get("UNI_MESSAGE") || "คุณกายถึงมหาลัยแล้ว";
const db = createDb(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
);

Deno.serve(async (req) => {
  if (req.method !== "POST") {
    return new Response("Method Not Allowed", { status: 405 });
  }
  if (!checkSecret(req, TRIGGER_SECRET)) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401,
      headers: { "Content-Type": "application/json" },
    });
  }

  const result = await handleArrived(
    { db, pushMessage, accessToken: LINE_CHANNEL_ACCESS_TOKEN, now: () => Date.now() },
    UNI_MESSAGE,
    "last_trigger_uni",
  );

  return new Response(JSON.stringify(result.body), {
    status: result.status,
    headers: { "Content-Type": "application/json" },
  });
});
```

- [ ] **Step 3: Disable JWT verification for both**

Add to `supabase/config.toml`:

```toml
[functions.arrived-home]
verify_jwt = false

[functions.arrived-uni]
verify_jwt = false
```

- [ ] **Step 4: Serve locally and add a test recipient**

```bash
supabase functions serve --env-file supabase/.env
```

In another terminal, insert a test recipient directly (reuse the `db.test.ts` approach, or via `psql`):

```bash
psql "$(supabase status -o env | grep DB_URL | cut -d= -f2 | tr -d '\"')" \
  -c "insert into recipients (user_id) values ('Utest123') on conflict do nothing;"
```

- [ ] **Step 5: Trigger `arrived-home` and verify the response**

```bash
curl -X POST http://127.0.0.1:54321/functions/v1/arrived-home \
  -H "x-secret: your_shared_secret_here"
```

Expected: `{"sent":1,"failed":1,"details":{"sent":[],"failed":[{"userId":"Utest123","error":"..."}]}}` — the push itself will fail against the real LINE API for a fake test user ID, which is expected; what matters is the request is accepted, cooldown is set, and the response shape matches. Confirm the failure reason in `details.failed[0].error` is a LINE API error (e.g. 400), not a crash/500.

- [ ] **Step 6: Verify the cooldown**

```bash
curl -X POST http://127.0.0.1:54321/functions/v1/arrived-home \
  -H "x-secret: your_shared_secret_here"
```

Expected: `{"error":"Cooldown active","remainingMinutes":30}` with a 429 status.

- [ ] **Step 7: Verify unauthorized rejection**

```bash
curl -X POST http://127.0.0.1:54321/functions/v1/arrived-home
```

Expected: `{"error":"Unauthorized"}` with a 401 status.

- [ ] **Step 8: Commit**

```bash
git add supabase/functions/arrived-home/index.ts supabase/functions/arrived-uni/index.ts supabase/config.toml
git commit -m "feat: add arrived-home and arrived-uni edge functions"
```

---

### Task 10: `recipients` edge function

**Files:**
- Create: `supabase/functions/recipients/index.ts`
- Modify: `supabase/config.toml`

**Interfaces:**
- Consumes: `createDb` (Task 6), `checkSecret` (Task 3), `resolveName` (Task 5).

- [ ] **Step 1: Write the function**

Create `supabase/functions/recipients/index.ts`:

```typescript
import { createDb } from "../_shared/db.ts";
import { checkSecret } from "../_shared/auth.ts";
import { resolveName } from "../_shared/line.ts";

const TRIGGER_SECRET = Deno.env.get("TRIGGER_SECRET")!;
const LINE_CHANNEL_ACCESS_TOKEN = Deno.env.get("LINE_CHANNEL_ACCESS_TOKEN")!;
const db = createDb(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
);

Deno.serve(async (req) => {
  if (!checkSecret(req, TRIGGER_SECRET)) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401,
      headers: { "Content-Type": "application/json" },
    });
  }

  if (req.method === "GET") {
    const recipients = await db.getAllRecipients();
    const enriched = await Promise.all(
      recipients.map(async (r) => ({
        ...r,
        name: await resolveName(LINE_CHANNEL_ACCESS_TOKEN, r.user_id),
      })),
    );
    return new Response(JSON.stringify({ count: enriched.length, recipients: enriched }), {
      headers: { "Content-Type": "application/json" },
    });
  }

  if (req.method === "DELETE") {
    const url = new URL(req.url);
    const userId = url.pathname.split("/").filter(Boolean).pop();
    if (!userId || userId === "recipients") {
      return new Response(JSON.stringify({ error: "userId required" }), {
        status: 400,
        headers: { "Content-Type": "application/json" },
      });
    }
    const deleted = await db.deleteRecipient(userId);
    if (deleted === 0) {
      return new Response(JSON.stringify({ error: "Recipient not found" }), {
        status: 404,
        headers: { "Content-Type": "application/json" },
      });
    }
    return new Response(JSON.stringify({ ok: true, userId }), {
      headers: { "Content-Type": "application/json" },
    });
  }

  return new Response("Method Not Allowed", { status: 405 });
});
```

- [ ] **Step 2: Disable JWT verification**

Add to `supabase/config.toml`:

```toml
[functions.recipients]
verify_jwt = false
```

- [ ] **Step 3: Serve locally and verify GET**

```bash
supabase functions serve recipients --env-file supabase/.env
curl http://127.0.0.1:54321/functions/v1/recipients -H "x-secret: your_shared_secret_here"
```

Expected: `{"count":1,"recipients":[{"user_id":"Utest123","created_at":"...","name":null}]}` (`name` is `null` because `Utest123` isn't a real LINE user — expected).

- [ ] **Step 4: Verify DELETE**

```bash
curl -X DELETE http://127.0.0.1:54321/functions/v1/recipients/Utest123 \
  -H "x-secret: your_shared_secret_here"
```

Expected: `{"ok":true,"userId":"Utest123"}`.

```bash
curl -X DELETE http://127.0.0.1:54321/functions/v1/recipients/Utest123 \
  -H "x-secret: your_shared_secret_here"
```

Expected: `{"error":"Recipient not found"}` with a 404 status.

- [ ] **Step 5: Commit**

```bash
git add supabase/functions/recipients/index.ts supabase/config.toml
git commit -m "feat: add recipients edge function"
```

---

### Task 11: `health` edge function

**Files:**
- Create: `supabase/functions/health/index.ts`
- Modify: `supabase/config.toml`

**Interfaces:**
- Consumes: `createDb` (Task 6).

- [ ] **Step 1: Write the function**

Create `supabase/functions/health/index.ts`:

```typescript
import { createDb } from "../_shared/db.ts";

const db = createDb(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
);

Deno.serve(async (_req) => {
  const now = new Date();
  const yearMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;

  const [activeRecipients, monthlyMessageCount] = await Promise.all([
    db.activeCount(),
    db.monthlyCount(yearMonth),
  ]);

  return new Response(
    JSON.stringify({ status: "ok", activeRecipients, monthlyMessageCount }),
    { headers: { "Content-Type": "application/json" } },
  );
});
```

- [ ] **Step 2: Disable JWT verification**

Add to `supabase/config.toml`:

```toml
[functions.health]
verify_jwt = false
```

- [ ] **Step 3: Serve locally and verify**

```bash
supabase functions serve health --env-file supabase/.env
curl http://127.0.0.1:54321/functions/v1/health
```

Expected: `{"status":"ok","activeRecipients":0,"monthlyMessageCount":2}` (no auth header needed, numbers reflect whatever test data is left in the local DB at this point).

- [ ] **Step 4: Commit**

```bash
git add supabase/functions/health/index.ts supabase/config.toml
git commit -m "feat: add health edge function"
```

---

### Task 12: One-off data migration script

**Files:**
- Create: `scripts/migrate-to-supabase.js`
- Modify: `package.json` (temporarily add `@supabase/supabase-js` as a dependency for this script)

**Interfaces:**
- Consumes: `data/bot.db` (existing SQLite file), `SUPABASE_URL` / `SUPABASE_SERVICE_ROLE_KEY` env vars (from a local `.env`, not `supabase/.env` — this runs as a plain Node script, not an edge function).

- [ ] **Step 1: Add the Supabase JS dependency**

```bash
cd /Users/guykongthong/Desktop/software-engineering/code/personal/projects/location-bot
npm install @supabase/supabase-js
```

- [ ] **Step 2: Write the migration script**

Create `scripts/migrate-to-supabase.js`:

```javascript
require('dotenv').config();
const Database = require('better-sqlite3');
const path = require('path');
const { createClient } = require('@supabase/supabase-js');

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  console.error('Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in .env before running this script.');
  process.exit(1);
}

const db = new Database(path.join(__dirname, '..', 'data', 'bot.db'), { readonly: true });
const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

async function migrate() {
  const recipients = db.prepare('SELECT userId, active, createdAt FROM recipients').all();
  const messageLog = db.prepare('SELECT userId, sentAt FROM message_log').all();
  const config = db.prepare('SELECT key, value FROM config').all();

  if (recipients.length > 0) {
    const { error } = await supabase.from('recipients').upsert(
      recipients.map((r) => ({ user_id: r.userId, active: !!r.active, created_at: r.createdAt }))
    );
    if (error) throw error;
    console.log(`Migrated ${recipients.length} recipients`);
  }

  if (messageLog.length > 0) {
    const { error } = await supabase.from('message_log').insert(
      messageLog.map((m) => ({ user_id: m.userId, sent_at: m.sentAt }))
    );
    if (error) throw error;
    console.log(`Migrated ${messageLog.length} message_log rows`);
  }

  if (config.length > 0) {
    const { error } = await supabase.from('config').upsert(config);
    if (error) throw error;
    console.log(`Migrated ${config.length} config rows`);
  }

  console.log('Migration complete.');
}

migrate().catch((err) => {
  console.error('Migration failed:', err);
  process.exit(1);
});
```

- [ ] **Step 3: Dry-run against the local Supabase stack**

Temporarily add the local stack's URL/key to `.env` (the existing root `.env`, already gitignored):

```
SUPABASE_URL=http://127.0.0.1:54321
SUPABASE_SERVICE_ROLE_KEY=<service_role_key from `supabase status`>
```

```bash
supabase db reset   # start from an empty local schema
node scripts/migrate-to-supabase.js
```

Expected: prints migrated row counts matching what's in `data/bot.db` (check with `sqlite3 data/bot.db "select count(*) from recipients;"` beforehand if you want an exact number to compare against).

- [ ] **Step 4: Verify via the `recipients` edge function**

```bash
supabase functions serve recipients --env-file supabase/.env
curl http://127.0.0.1:54321/functions/v1/recipients -H "x-secret: your_shared_secret_here"
```

Expected: the real recipients from your production SQLite file now show up (with real display names, since these are real LINE user/group IDs this time).

- [ ] **Step 5: Commit**

```bash
git add scripts/migrate-to-supabase.js package.json package-lock.json
git commit -m "feat: add one-off SQLite to Supabase data migration script"
```

---

### Task 13: Deploy to the production Supabase project

**Files:** none (deployment/config actions only).

- [ ] **Step 1: Push the schema migration to production**

```bash
supabase db push
```

Expected: applies `0001_init.sql` to the linked production project. Confirm via **Table Editor** in the Supabase dashboard that `recipients`, `message_log`, `config` exist and are empty.

- [ ] **Step 2: Set production secrets**

```bash
supabase secrets set \
  LINE_CHANNEL_ACCESS_TOKEN=your_channel_access_token_here \
  LINE_CHANNEL_SECRET=your_channel_secret_here \
  TRIGGER_SECRET=your_shared_secret_here \
  HOME_MESSAGE="I just got home! 🏠" \
  UNI_MESSAGE="คุณกายถึงมหาลัยแล้ว"
```

(Do not set `SUPABASE_URL` / `SUPABASE_SERVICE_ROLE_KEY` — those are auto-injected.)

- [ ] **Step 3: Deploy all five functions**

```bash
supabase functions deploy webhook
supabase functions deploy arrived-home
supabase functions deploy arrived-uni
supabase functions deploy recipients
supabase functions deploy health
```

Expected: each prints a deployed function URL of the form `https://<PROJECT_REF>.supabase.co/functions/v1/<name>`.

- [ ] **Step 4: Smoke-test `health` in production**

```bash
curl https://<PROJECT_REF>.supabase.co/functions/v1/health
```

Expected: `{"status":"ok","activeRecipients":0,"monthlyMessageCount":0}` (no data migrated yet).

---

### Task 14: Migrate production data and cut over

**Files:** none (data + external config actions only).

- [ ] **Step 1: Point the migration script at production**

Update the root `.env`:

```
SUPABASE_URL=https://<PROJECT_REF>.supabase.co
SUPABASE_SERVICE_ROLE_KEY=<production service_role key from Project Settings → API>
```

- [ ] **Step 2: Run the migration against production**

```bash
node scripts/migrate-to-supabase.js
```

Expected: prints migrated row counts. Double check against the original SQLite file: `sqlite3 data/bot.db "select count(*) from recipients where active = 1;"` should match `activeRecipients` from the next step.

- [ ] **Step 3: Verify via production `health` and `recipients`**

```bash
curl https://<PROJECT_REF>.supabase.co/functions/v1/health
curl https://<PROJECT_REF>.supabase.co/functions/v1/recipients -H "x-secret: your_shared_secret_here"
```

Expected: `activeRecipients` matches your real recipient count, and `recipients` lists real display names.

- [ ] **Step 4: Update the LINE webhook URL**

LINE Developers Console → your channel → **Messaging API** tab → **Webhook URL** → set to `https://<PROJECT_REF>.supabase.co/functions/v1/webhook` → click **Verify** → expect a green checkmark.

- [ ] **Step 5: Update the iOS Shortcut**

Open the existing "arrived home" Shortcut → update the **Get Contents of URL** action's URL to `https://<PROJECT_REF>.supabase.co/functions/v1/arrived-home` (and similarly for any "arrived uni" shortcut → `.../arrived-uni`). Keep the `X-Secret` header as-is.

- [ ] **Step 6: End-to-end verification**

Trigger the Shortcut for real (or `curl` the production `arrived-home` URL with the real secret) and confirm you receive the LINE push message on your phone.

---

### Task 15: Remove the old Railway/Express/SQLite stack

**Files:**
- Delete: `Dockerfile`, `railway.toml`, `.dockerignore`, `src/`, `data/`
- Delete: `scripts/migrate-to-supabase.js` (one-off, no longer needed post-cutover)
- Modify: `package.json`
- Modify: `README.md`
- Modify: `.gitignore`

- [ ] **Step 1: Remove Railway/Docker/Express files**

```bash
git rm -r Dockerfile railway.toml .dockerignore src/ data/
git rm scripts/migrate-to-supabase.js
```

- [ ] **Step 2: Trim `package.json`**

Remove `express`, `@line/bot-sdk`, `dotenv`, `nodemon`, `better-sqlite3`, `@supabase/supabase-js`, and the `main`/`scripts.start`/`scripts.dev` fields (nothing runs via `node` anymore — the app is entirely edge functions + Supabase CLI). Resulting `package.json`:

```json
{
  "name": "location-bot",
  "version": "2.0.0",
  "description": "LINE Home Arrival Notification Bot (Supabase Edge Functions)",
  "private": true
}
```

```bash
npm install   # regenerates package-lock.json with the trimmed deps (should end up empty/minimal)
```

- [ ] **Step 3: Remove the now-unused `supabase/.env` gitignore entry note and `data/*.db` line**

Edit `.gitignore` — remove `data/*.db` (no `data/` dir left) and keep `supabase/.env`:

```
node_modules/
.env
supabase/.env
```

- [ ] **Step 4: Rewrite `README.md`**

Replace the "Deploy to Railway" section and endpoint URLs with Supabase equivalents. Key changes: step 2 becomes "Deploy to Supabase" (`supabase init`/`link`/`db push`/`secrets set`/`functions deploy`, as done in Tasks 1, 13), all example URLs change from `https://<your-railway-domain>` to `https://<PROJECT_REF>.supabase.co/functions/v1/<name>`, and the `GET /health` response example drops `uptimeSeconds`. Keep the LINE channel setup steps, iOS Shortcut steps, and API endpoint documentation structurally the same — just update the base URLs and the health response shape.

- [ ] **Step 5: Commit**

```bash
git add package.json package-lock.json README.md .gitignore
git commit -m "chore: remove Railway/Docker/Express stack, now fully on Supabase Edge Functions"
```

- [ ] **Step 6: Final check — confirm production is unaffected by local cleanup**

```bash
curl https://<PROJECT_REF>.supabase.co/functions/v1/health
```

Expected: still returns `{"status":"ok",...}` — deleting local files/deps doesn't touch the already-deployed edge functions.
