# location-bot

A LINE push notification bot that sends a message to all active recipients when you arrive home (or at uni). Trigger it automatically via an iOS Shortcut or manually via HTTP. Runs entirely on Supabase Edge Functions + Postgres.

## How it works

```
iPhone joins home Wi-Fi
        |
iOS Shortcut automation  --POST + X-Secret-->  arrived-home edge function
                                                      |
                                       reads active recipients from Postgres
                                                      |
                                       LINE Messaging API push to each one
```

People get added automatically: anyone who follows the bot, or any group the bot is invited to, is saved as a recipient by the LINE webhook. Each trigger has its own 30-minute cooldown so a flaky Wi-Fi connection does not send duplicates.

## Tech stack

- Supabase Edge Functions (Deno, TypeScript)
- Supabase Postgres for recipients and message counts
- LINE Messaging API for push messages and the follow/join webhook
- iOS Shortcuts for the Wi-Fi arrival trigger

## Project structure

```
supabase/
  functions/
    arrived-home/  arrived-uni/   trigger endpoints
    webhook/                      LINE follow, unfollow, join, leave events
    recipients/                   list and remove recipients
    health/                       recipient and monthly push counts
    _shared/                      auth, LINE client, database access, and their tests
  migrations/                     database schema
```

## Testing

```bash
deno test supabase/functions/_shared/
```

## Setup

### 1. Create a LINE channel

1. Go to the [LINE Developers Console](https://developers.line.biz/console/) and create a **Messaging API** channel.
2. **Basic settings** tab → copy the **Channel secret** (a 32-character hex string — NOT the Channel ID number at the top).
3. **Messaging API** tab → scroll to **Channel access token** → click **Issue** → copy the token (it's a very long string, 150+ characters).
4. **Messaging API** tab → scroll to **LINE Official Account features** → set **Group and multi-person chats** to **Allow** (required for group chat support).

### 2. Deploy to Supabase

1. Create a project at [supabase.com](https://supabase.com) and note its **Project Reference** (`<PROJECT_REF>`).
2. Link this repo to the project:
   ```bash
   supabase init
   supabase link --project-ref <PROJECT_REF>
   ```
3. Push the database schema:
   ```bash
   supabase db push
   ```
4. Set the required secrets (see [Environment Variables](#environment-variables) below):
   ```bash
   supabase secrets set LINE_CHANNEL_ACCESS_TOKEN=your_channel_access_token_here
   supabase secrets set LINE_CHANNEL_SECRET=your_channel_secret_here
   supabase secrets set TRIGGER_SECRET=your_shared_secret_here
   supabase secrets set HOME_MESSAGE="I just got home! 🏠"
   supabase secrets set UNI_MESSAGE="I just got to uni!"
   ```
5. Deploy the edge functions:
   ```bash
   supabase functions deploy webhook
   supabase functions deploy arrived-home
   supabase functions deploy arrived-uni
   supabase functions deploy recipients
   supabase functions deploy health
   ```
6. Each function is now live at `https://<PROJECT_REF>.supabase.co/functions/v1/<name>`.

### 3. Configure the LINE webhook

1. LINE Developers Console → **Messaging API** tab → set **Webhook URL** to `https://<PROJECT_REF>.supabase.co/functions/v1/webhook`.
2. Enable the **Use webhook** toggle (easy to miss — it must be ON).
3. Click **Verify** — should return a green checkmark.

### 4. Add recipients

**Individual users:** Anyone who follows the bot on LINE is automatically saved as a recipient.

> **Already friends with the bot?** If you added the bot before the webhook was configured, the follow event was never received. Fix it by removing the bot as a friend and re-adding it — that fires a fresh follow event.

**Group chats:** Invite the bot to a group. It joins automatically and the group is saved as a recipient. The message will be sent to the entire group when triggered.

You can verify recipients at any time:
```bash
curl https://<PROJECT_REF>.supabase.co/functions/v1/recipients -H "X-Secret: your_trigger_secret"
```

### 5. Set up iOS Shortcut (Wi-Fi trigger — recommended)

The Wi-Fi trigger fires the moment your phone connects to a network — more reliable than GPS and works without special location permissions.

1. Open **Shortcuts** → **Automation** tab → **+** → **Personal Automation**
2. Choose **Wi-Fi** → enter your home (or uni) network name → set to trigger on **Connect**
3. Add a **Get Contents of URL** action:
   - URL: `https://<PROJECT_REF>.supabase.co/functions/v1/arrived-home` (or `arrived-uni`)
   - Method: `POST`
   - Header: `X-Secret` = `your_trigger_secret`
4. Turn off **Ask Before Running**
5. Save

## Environment Variables

Set these with `supabase secrets set <KEY>=<value>` (see [Deploy to Supabase](#2-deploy-to-supabase)).

| Variable | Required | Default | Description |
|---|---|---|---|
| `LINE_CHANNEL_ACCESS_TOKEN` | Yes | — | Long-lived access token from LINE Developers Console → Messaging API tab (150+ character string) |
| `LINE_CHANNEL_SECRET` | Yes | — | Found under Basic settings tab (32-char hex string — not the Channel ID) |
| `TRIGGER_SECRET` | Yes | — | Shared secret sent as `X-Secret` header to protect trigger/admin endpoints. Generate with: `openssl rand -hex 32` |
| `HOME_MESSAGE` | No | `I just got home! 🏠` | Text pushed to all recipients when `/arrived-home` is triggered |
| `UNI_MESSAGE` | No | `คุณกายถึงมหาลัยแล้ว` | Text pushed to all recipients when `/arrived-uni` is triggered |
| `SUPABASE_URL` | Yes | — | Auto-available to edge functions at runtime |
| `SUPABASE_SERVICE_ROLE_KEY` | Yes | — | Auto-available to edge functions at runtime |

## API Endpoints

All endpoints are served from `https://<PROJECT_REF>.supabase.co/functions/v1/<name>`.

### `POST /arrived-home`
Protected by `X-Secret` header. Pushes `HOME_MESSAGE` to all active recipients. Has a 30-minute cooldown to prevent duplicate triggers.

```bash
curl -X POST https://<PROJECT_REF>.supabase.co/functions/v1/arrived-home -H "X-Secret: your_trigger_secret"
```

**Response:**
```json
{ "sent": 2, "failed": 0, "details": { "sent": ["Uabc...", "Cabc..."], "failed": [] } }
```

Returns `429` with `remainingMinutes` if the cooldown is still active.

### `POST /arrived-uni`
Same as `/arrived-home`, but pushes `UNI_MESSAGE` and tracks its own independent cooldown.

```bash
curl -X POST https://<PROJECT_REF>.supabase.co/functions/v1/arrived-uni -H "X-Secret: your_trigger_secret"
```

### `POST /webhook`
LINE webhook endpoint. Verifies `X-Line-Signature` automatically. Handles `follow`/`unfollow` (1:1) and `join`/`leave` (group) events.

### `GET /recipients`
Protected. Returns all active recipients with their display names.

```bash
curl https://<PROJECT_REF>.supabase.co/functions/v1/recipients -H "X-Secret: your_trigger_secret"
```

### `DELETE /recipients/:userId`
Protected. Removes a recipient by user ID or group ID.

```bash
curl -X DELETE https://<PROJECT_REF>.supabase.co/functions/v1/recipients/Uabc123 -H "X-Secret: your_trigger_secret"
```

### `GET /health`
Returns active recipient count and monthly push count (no auth required).

```bash
curl https://<PROJECT_REF>.supabase.co/functions/v1/health
```

**Response:**
```json
{ "status": "ok", "activeRecipients": 2, "monthlyMessageCount": 12 }
```

## Rate Limits

The LINE free tier allows **500 push messages per month**. Monitor `GET /health` to track the current `monthlyMessageCount`.
