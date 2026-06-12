# location-bot

A LINE push notification bot that sends a message to all active recipients when you arrive home. Trigger it automatically via an iOS Shortcut or manually via HTTP.

## Setup

### 1. Create a LINE channel

1. Go to the [LINE Developers Console](https://developers.line.biz/console/) and create a **Messaging API** channel.
2. **Basic settings** tab → copy the **Channel secret** (a 32-character hex string — NOT the Channel ID number at the top).
3. **Messaging API** tab → scroll to **Channel access token** → click **Issue** → copy the token (it's a very long string, 150+ characters).
4. **Messaging API** tab → scroll to **LINE Official Account features** → set **Group and multi-person chats** to **Allow** (required for group chat support).

### 2. Deploy to Railway

1. Push this repo to GitHub.
2. Go to [railway.app](https://railway.app) → **New Project** → **Deploy from GitHub repo** → select this repo.
3. Go to **Variables** and add all keys from `.env.example` with your real values.
4. In your service, add a **Volume** mounted at `/app/data` to persist the SQLite database across deploys.
5. Once deployed, copy your Railway public domain (e.g. `https://location-bot-production.up.railway.app`).

### 3. Configure the LINE webhook

1. LINE Developers Console → **Messaging API** tab → set **Webhook URL** to `https://<your-railway-domain>/webhook`.
2. Enable the **Use webhook** toggle (easy to miss — it must be ON).
3. Click **Verify** — should return a green checkmark.

### 4. Add recipients

**Individual users:** Anyone who follows the bot on LINE is automatically saved as a recipient.

> **Already friends with the bot?** If you added the bot before the webhook was configured, the follow event was never received. Fix it by removing the bot as a friend and re-adding it — that fires a fresh follow event.

**Group chats:** Invite the bot to a group. It joins automatically and the group is saved as a recipient. The message will be sent to the entire group when triggered.

You can verify recipients at any time:
```bash
curl https://<your-railway-domain>/recipients -H "X-Secret: your_trigger_secret"
```

### 5. Set up iOS Shortcut (Wi-Fi trigger — recommended)

The Wi-Fi trigger fires the moment your phone connects to your home network — more reliable than GPS and works without special location permissions.

1. Open **Shortcuts** → **Automation** tab → **+** → **Personal Automation**
2. Choose **Wi-Fi** → enter your home network name → set to trigger on **Connect**
3. Add a **Get Contents of URL** action:
   - URL: `https://<your-railway-domain>/arrived-home`
   - Method: `POST`
   - Header: `X-Secret` = `your_trigger_secret`
4. Turn off **Ask Before Running**
5. Save

## Environment Variables

| Variable | Required | Default | Description |
|---|---|---|---|
| `LINE_CHANNEL_ACCESS_TOKEN` | Yes | — | Long-lived access token from LINE Developers Console → Messaging API tab (150+ character string) |
| `LINE_CHANNEL_SECRET` | Yes | — | Found under Basic settings tab (32-char hex string — not the Channel ID) |
| `TRIGGER_SECRET` | Yes | — | Shared secret sent as `X-Secret` header to protect trigger/admin endpoints. Generate with: `openssl rand -hex 32` |
| `HOME_MESSAGE` | No | `I just got home! 🏠` | Text pushed to all recipients when triggered |
| `PORT` | No | `3000` | Port the Express server listens on (Railway sets this automatically) |

## API Endpoints

### `POST /arrived-home`
Protected by `X-Secret` header. Pushes `HOME_MESSAGE` to all active recipients. Has a 30-minute cooldown to prevent duplicate triggers.

```bash
curl -X POST https://<host>/arrived-home -H "X-Secret: your_trigger_secret"
```

**Response:**
```json
{ "sent": 2, "failed": 0, "details": { "sent": ["Uabc...", "Cabc..."], "failed": [] } }
```

Returns `429` with `remainingMinutes` if the cooldown is still active.

### `POST /webhook`
LINE webhook endpoint. Verifies `X-Line-Signature` automatically. Handles `follow`/`unfollow` (1:1) and `join`/`leave` (group) events.

### `GET /recipients`
Protected. Returns all active recipients with their display names.

```bash
curl https://<host>/recipients -H "X-Secret: your_trigger_secret"
```

### `DELETE /recipients/:userId`
Protected. Removes a recipient by user ID or group ID.

```bash
curl -X DELETE https://<host>/recipients/Uabc123 -H "X-Secret: your_trigger_secret"
```

### `GET /health`
Returns server uptime, active recipient count, and monthly push count (no auth required).

## Rate Limits

The LINE free tier allows **500 push messages per month**. The bot logs a warning when the monthly count reaches **400** (80%). Monitor `GET /health` to track usage.
