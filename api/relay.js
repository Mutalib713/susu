// Vercel serverless entry. Same logic as the local server, different wrapper.
const { handle } = require('../lib/handler');

// Webhook signatures are computed over the exact bytes, so read the stream ourselves rather
// than letting the platform parse and discard them.
module.exports.config = { api: { bodyParser: false } };

const readRaw = (req) =>
  new Promise((resolve) => {
    if (typeof req.body === 'string') return resolve(req.body);
    if (req.body && typeof req.body === 'object') return resolve(JSON.stringify(req.body));
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => resolve(Buffer.concat(chunks).toString()));
    req.on('error', () => resolve(''));
  });

module.exports = async (req, res) => {
  const action = (req.query && req.query.action) || '';
  try {
    const raw = await readRaw(req);
    let body = {};
    if (raw) {
      try {
        body = JSON.parse(raw);
      } catch {
        return res.status(400).json({ error: 'bad json' });
      }
    }
    res.setHeader('cache-control', 'no-store');
    res.status(200).json(await handle(action, body, { raw, headers: req.headers }));
  } catch (e) {
    res.status(400).json({ error: e.shortMessage || e.message });
  }
};
