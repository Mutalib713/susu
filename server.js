// Local demo server. Serves the app and relays signed notes onchain.
const http = require('http');
const fs = require('fs');
const path = require('path');
const { handle } = require('./lib/handler');

const PORT = process.env.PORT || 8099;
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml' };

const send = (res, code, body, type = 'application/json') => {
  res.writeHead(code, { 'content-type': type, 'cache-control': 'no-store' });
  res.end(typeof body === 'string' ? body : JSON.stringify(body));
};

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);

  if (url.pathname.startsWith('/api/')) {
    const action = url.pathname.slice(5);
    let body = {};
    if (req.method === 'POST') {
      const chunks = [];
      for await (const c of req) chunks.push(c);
      try {
        body = JSON.parse(Buffer.concat(chunks).toString() || '{}');
      } catch {
        return send(res, 400, { error: 'bad json' });
      }
    }
    try {
      return send(res, 200, await handle(action, body));
    } catch (e) {
      console.error(action, '->', e.shortMessage || e.message);
      return send(res, 400, { error: e.shortMessage || e.message });
    }
  }

  const file = url.pathname === '/' ? '/index.html' : url.pathname;
  const full = path.join(__dirname, 'public', path.normalize(file).replace(/^(\.\.[/\\])+/, ''));
  if (!fs.existsSync(full)) return send(res, 404, 'Not found', 'text/plain');
  send(res, 200, fs.readFileSync(full), TYPES[path.extname(full)] || 'text/plain');
});

server.listen(PORT, () => console.log(`susu on http://localhost:${PORT}`));
