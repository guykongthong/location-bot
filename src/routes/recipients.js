const express = require('express');
const router = express.Router();
const { messagingApi } = require('@line/bot-sdk');
const { queries } = require('../db');
const auth = require('../middleware/auth');

async function resolveName(client, id) {
  try {
    if (id.startsWith('C')) {
      const group = await client.getGroupSummary(id);
      return group.groupName;
    }
    const profile = await client.getProfile(id);
    return profile.displayName;
  } catch {
    return null;
  }
}

router.get('/', auth, async (req, res) => {
  const recipients = queries.getAllRecipients.all();
  const client = new messagingApi.MessagingApiClient({
    channelAccessToken: process.env.LINE_CHANNEL_ACCESS_TOKEN,
  });

  const enriched = await Promise.all(
    recipients.map(async (r) => ({
      ...r,
      name: await resolveName(client, r.userId),
    }))
  );

  res.json({ count: enriched.length, recipients: enriched });
});

router.delete('/:userId', auth, (req, res) => {
  const { userId } = req.params;
  const result = queries.deleteRecipient.run(userId);
  if (result.changes === 0) {
    return res.status(404).json({ error: 'Recipient not found' });
  }
  res.json({ ok: true, userId });
});

module.exports = router;
