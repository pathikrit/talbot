// Strict static server for tests: deliberately mounted at a GitHub Pages-style
// subpath. There is no SPA rewrite to disguise missing assets or bad URLs.
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, resolve, sep } from 'node:path';
const root = resolve('dist');
const mime = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.wasm': 'application/wasm', '.json': 'application/json', '.txt': 'text/plain' };
createServer(async (request, response) => {
  try {
    const url = new URL(request.url, 'http://127.0.0.1');
    if (!url.pathname.startsWith('/talbot/')) throw new Error('not found');
    const suffix = decodeURIComponent(url.pathname.slice('/talbot/'.length)) || 'index.html';
    const path = resolve(root, suffix);
    if (!path.startsWith(root + sep)) throw new Error('not found');
    const body = await readFile(path);
    response.writeHead(200, { 'Content-Type': mime[extname(path)] ?? 'application/octet-stream' });
    response.end(body);
  } catch { response.writeHead(404); response.end('Not found'); }
}).listen(4173, '127.0.0.1', () => console.log('Static test site: http://127.0.0.1:4173/talbot/'));
