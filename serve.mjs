// Minimal static dev server for the "Simple Structure" ESEM web app.
// Usage: node serve.mjs   ->   serves the project root at http://localhost:3000
import { createServer } from 'node:http';
import { readFile, stat, writeFile } from 'node:fs/promises';
import { extname, join, normalize, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT || process.argv[2] || 3000);

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.csv': 'text/csv; charset=utf-8',
  '.dat': 'text/plain; charset=utf-8',
  '.out': 'text/plain; charset=utf-8',
  '.inp': 'text/plain; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.woff2': 'font/woff2',
};

const server = createServer(async (req, res) => {
  try {
    // POST /save?name=<file> — write request body to disk (dev validation helper)
    if (req.method === 'POST') {
      const name = new URL(req.url, `http://localhost:${PORT}`).searchParams.get('name');
      if (!name || !/^[\w.\-]+$/.test(name)) { res.writeHead(400).end('bad name'); return; }
      const chunks = []; for await (const c of req) chunks.push(c);
      await writeFile(join(ROOT, name), Buffer.concat(chunks));
      res.setHeader('Access-Control-Allow-Origin', '*');
      res.writeHead(200).end('saved'); return;
    }
    let urlPath = decodeURIComponent(new URL(req.url, `http://localhost:${PORT}`).pathname);
    if (urlPath === '/') urlPath = '/index.html';
    const filePath = normalize(join(ROOT, urlPath));
    if (!filePath.startsWith(ROOT)) { res.writeHead(403).end('Forbidden'); return; }
    const info = await stat(filePath).catch(() => null);
    if (!info || !info.isFile()) { res.writeHead(404).end('Not found'); return; }
    const data = await readFile(filePath);
    res.setHeader('Cache-Control', 'no-store');
    res.writeHead(200, { 'Content-Type': MIME[extname(filePath)] || 'application/octet-stream' });
    res.end(data);
  } catch (err) {
    res.writeHead(500).end('Server error: ' + err.message);
  }
});

server.listen(PORT, () => {
  console.log(`Simple Structure dev server -> http://localhost:${PORT}`);
});
