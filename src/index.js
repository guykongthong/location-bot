require('dotenv').config();
const express = require('express');

const app = express();

// Webhook must be mounted before express.json() so LINE middleware
// receives the raw body for HMAC-SHA256 signature verification
app.use('/webhook', require('./routes/webhook'));

app.use(express.json());
app.use('/arrived-home', require('./routes/arrived'));
app.use('/recipients', require('./routes/recipients'));
app.use('/health', require('./routes/health'));

// Temporary: admin helpers
const auth = require('./middleware/auth');
const { queries } = require('./db');
app.post('/admin/reset-cooldown', auth, (req, res) => {
  queries.setConfig.run('last_trigger', '0');
  res.json({ ok: true });
});
app.post('/admin/add-recipient', auth, (req, res) => {
  const { userId } = req.body;
  if (!userId) return res.status(400).json({ error: 'userId required' });
  queries.upsertRecipient.run(userId);
  res.json({ ok: true, activeCount: queries.activeCount.get().count });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
