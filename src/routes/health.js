const express = require('express');
const router = express.Router();
const { queries } = require('../db');

const startTime = Date.now();

router.get('/', (req, res) => {
  const now = new Date();
  const yearMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;

  res.json({
    status: 'ok',
    uptimeSeconds: Math.floor((Date.now() - startTime) / 1000),
    activeRecipients: queries.activeCount.get().count,
    monthlyMessageCount: queries.monthlyCount.get(yearMonth).count,
  });
});

module.exports = router;
