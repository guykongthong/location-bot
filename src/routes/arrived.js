const express = require('express');
const { messagingApi } = require('@line/bot-sdk');
const { queries } = require('../db');
const auth = require('../middleware/auth');

const COOLDOWN_MS = 30 * 60 * 1000;
const MONTHLY_WARN_THRESHOLD = 400;

function currentYearMonth() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
}

function createArrivedRouter(text, cooldownKey) {
  const router = express.Router();

  router.post('/', auth, async (req, res) => {
    const lastTrigger = queries.getConfig.get(cooldownKey);
    if (lastTrigger) {
      const elapsed = Date.now() - parseInt(lastTrigger.value, 10);
      if (elapsed < COOLDOWN_MS) {
        const remainingMinutes = Math.ceil((COOLDOWN_MS - elapsed) / 60000);
        return res.status(429).json({ error: 'Cooldown active', remainingMinutes });
      }
    }

    queries.setConfig.run(cooldownKey, String(Date.now()));

    const recipients = queries.getActiveRecipients.all();
    if (recipients.length === 0) {
      return res.json({ sent: 0, failed: 0, details: { sent: [], failed: [] } });
    }

    const client = new messagingApi.MessagingApiClient({
      channelAccessToken: process.env.LINE_CHANNEL_ACCESS_TOKEN,
    });

    const results = { sent: [], failed: [] };

    for (const { userId } of recipients) {
      try {
        await client.pushMessage({ to: userId, messages: [{ type: 'text', text }] });
        queries.logMessage.run(userId);
        results.sent.push(userId);
      } catch (err) {
        console.error(`Failed to push to ${userId}:`, err.message);
        results.failed.push({ userId, error: err.message });
      }
    }

    const monthlyCount = queries.monthlyCount.get(currentYearMonth()).count;
    if (monthlyCount >= MONTHLY_WARN_THRESHOLD) {
      console.warn(
        `Warning: Monthly push count is ${monthlyCount} — approaching LINE free tier limit (500/month)`
      );
    }

    res.json({ sent: results.sent.length, failed: results.failed.length, details: results });
  });

  return router;
}

module.exports = createArrivedRouter;
