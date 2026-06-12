# location-bot

A LINE push notification bot that sends a message to all active recipients when you arrive home. Trigger it with an iOS Shortcut (or any HTTP client).

## Setup

### 1. LINE Channel

1. Go to the [LINE Developers Console](https://developers.line.biz/console/) and create a **Messaging API** channel.
2. Copy the **Channel Secret** and issue a **Channel Access Token**.
3. Under **Webhook settings**, enable webhooks and set the URL to `https://<your-host>/webhook`.

### 2. Install and configure

```bash
# Install dependencies
npm install

# Copy the example env and fill in your values
cp .env.example .env
```

Edit `.env` with your credentials (see [Environment Variables](#environment-variables)).

### 3. Run the server

```bash
# Production
npm start

# Development (auto-reloads on file changes)
npm run dev
```

The server creates a `data/bot.db` SQLite file automatically on first run.

## Environment Variables

| Variable | Required | Default | Description |
|---|---|---|---|
| `LINE_CHANNEL_ACCESS_TOKEN` | Yes | — | Long-lived access token from LINE Developers Console |
| `LINE_CHANNEL_SECRET` | Yes | — | Channel secret, used to verify webhook signatures |
| `TRIGGER_SECRET` | Yes | — | Shared secret sent as `X-Secret` header to protect trigger/admin endpoints |
| `HOME_MESSAGE` | No | `I just got home! 🏠` | Text pushed to all recipients when triggered |
| `PORT` | No | `3000` | Port the Express server listens on |

## API Endpoints

### `POST /arrived-home`
Protected by `X-Secret` header. Pushes `HOME_MESSAGE` to all active recipients. Has a 30-minute cooldown.

```bash
curl -X POST https://<host>/arrived-home \
  -H "X-Secret: your_trigger_secret"
```

**Response:**
```json
{ "sent": 2, "failed": 0, "details": { "sent": ["Uabc...", "Uxyz..."], "failed": [] } }
```

Returns `429` with `remainingMinutes` if the cooldown is still active.

### `POST /webhook`
LINE webhook endpoint. Verifies `X-Line-Signature` automatically. Saves users who follow the channel to the DB; marks them inactive on unfollow.

### `GET /recipients`
Protected. Returns all active recipient user IDs.

```bash
curl https://<host>/recipients -H "X-Secret: your_trigger_secret"
```

### `DELETE /recipients/:userId`
Protected. Permanently removes a recipient.

```bash
curl -X DELETE https://<host>/recipients/Uabc123 \
  -H "X-Secret: your_trigger_secret"
```

### `GET /health`
Returns server uptime, active recipient count, and monthly push count (no auth required).

```json
{ "status": "ok", "uptimeSeconds": 3600, "activeRecipients": 2, "monthlyMessageCount": 12 }
```

## iOS Shortcuts Setup

iOS Shortcuts can call the `/arrived-home` endpoint automatically when you arrive at a specific location (geofence trigger).

1. **Create the Shortcut:**
   - Open the **Shortcuts** app → tap **+** to create a new shortcut.
   - Add a **Get Contents of URL** action.
   - Set the URL to `https://<your-host>/arrived-home`.
   - Set **Method** to `POST`.
   - Add a header: `X-Secret` = `your_trigger_secret`.

2. **Add an Automation (geofence trigger):**
   - Tap the **Automation** tab → **+** → **Personal Automation**.
   - Choose **Arrive** → set your home location and a radius.
   - Select **Run Immediately** (disable "Ask Before Running").
   - Add a **Run Shortcut** action pointing to the shortcut from step 1.

The bot will fire once when you arrive and then respect the 30-minute cooldown to prevent duplicate notifications.

## Deploying to Railway

Railway is the easiest hosting option — it detects the `Dockerfile` automatically and gives you a free public HTTPS URL.

1. Push this repo to GitHub.
2. Go to [railway.app](https://railway.app) → **New Project** → **Deploy from GitHub repo** → select this repo.
3. In your service settings, add a **Volume** mounted at `/app/data` (this keeps the SQLite DB across deploys and restarts).
4. Go to **Variables** and add all keys from `.env.example` with your real values.
5. Railway will build and deploy automatically. Once live, copy the generated domain (e.g. `https://location-bot-production.up.railway.app`).
6. Paste that URL into LINE Developers Console as your Webhook URL: `https://<your-railway-domain>/webhook`.

Re-deploys trigger automatically on every push to your connected branch.

## Hosting

Any always-on server with a public HTTPS URL works (Railway, Fly.io, Render, VPS, etc.). LINE requires a valid TLS certificate on the webhook URL.

## Rate Limits

The LINE free tier allows **500 push messages per month**. The bot logs a warning when the monthly count reaches **400** (80%). Monitor `GET /health` to track usage.
