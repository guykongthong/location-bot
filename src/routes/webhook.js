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
    const source = event.source || {};
    const recipientId = source.groupId || source.roomId || source.userId;
    if (!recipientId) continue;

    if (event.type === 'follow' || event.type === 'join') {
      queries.upsertRecipient.run(recipientId);
      console.log(`Recipient added: ${recipientId}`);
    } else if (event.type === 'unfollow' || event.type === 'leave') {
      queries.deactivateRecipient.run(recipientId);
      console.log(`Recipient deactivated: ${recipientId}`);
    }
  }

  res.json({ ok: true });
});

module.exports = router;
