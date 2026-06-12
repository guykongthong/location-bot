const express = require('express');
const router = express.Router();
const { queries } = require('../db');
const auth = require('../middleware/auth');

router.get('/', auth, (req, res) => {
  const recipients = queries.getAllRecipients.all();
  res.json({ count: recipients.length, recipients });
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
