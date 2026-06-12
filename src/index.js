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

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
