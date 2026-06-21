require('dotenv').config();
const express = require('express');

const app = express();

// Webhook must be mounted before express.json() so LINE middleware
// receives the raw body for HMAC-SHA256 signature verification
app.use('/webhook', require('./routes/webhook'));

app.use(express.json());
const createArrivedRouter = require('./routes/arrived');
app.use('/arrived-home', createArrivedRouter(process.env.HOME_MESSAGE || 'I just got home! 🏠', 'last_trigger_home'));
app.use('/arrived-uni', createArrivedRouter(process.env.UNI_MESSAGE || 'คุณกายถึงมหาลัยแล้ว', 'last_trigger_uni'));
app.use('/recipients', require('./routes/recipients'));
app.use('/health', require('./routes/health'));

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
