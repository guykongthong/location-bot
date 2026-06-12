const express = require('express');
const router = express.Router();
const { middleware } = require('@line/bot-sdk');
const { queries } = require('../db');

const lineConfig = {
  channelSecret: process.env.LINE_CHANNEL_SECRET,
  channelAccessToken: process.env.LINE_CHANNEL_ACCESS_TOKEN,
};

// LINE middleware verifies X-Line-Signature and parses body
router.post('/', middleware(lineConfig), (req, res) => {
  const events = req.body.events || [];

  for (const event of events) {
    const userId = event.source && event.source.userId;
    if (!userId) continue;

    console.log(`Webhook event: type=${event.type} userId=${userId}`);

    if (event.type === 'follow') {
      queries.upsertRecipient.run(userId);
      console.log(`Recipient added: ${userId}`);
    } else if (event.type === 'unfollow') {
      queries.deactivateRecipient.run(userId);
      console.log(`Recipient deactivated: ${userId}`);
    }
  }

  res.json({ ok: true });
});

module.exports = router;
