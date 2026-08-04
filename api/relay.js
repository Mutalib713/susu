// Vercel serverless entry. Same logic as the local server, different wrapper.
const { handle } = require('../lib/handler');

module.exports = async (req, res) => {
  const action = (req.query && req.query.action) || '';
  try {
    const body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : req.body || {};
    res.setHeader('cache-control', 'no-store');
    res.status(200).json(await handle(action, body));
  } catch (e) {
    res.status(400).json({ error: e.shortMessage || e.message });
  }
};
