const auth = (req, res, next) => {
  const secret = req.headers['x-secret'];
  if (!secret || secret !== process.env.TRIGGER_SECRET) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  next();
};

module.exports = auth;
