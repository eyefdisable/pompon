/** Точка входа HTTP-сервера. */
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { env, assertEnv, migrate, getSettings, ensureOwner } from './core';
import { baseHeaders, requestOrigin } from './http';
import { handleApi } from './api';
import * as P from './pages';

const pub = path.join(env.root, 'dist/public');
const BUILD = fs.existsSync(path.join(pub, 'build.txt')) ? fs.readFileSync(path.join(pub, 'build.txt'), 'utf8').trim() : 'dev';
const TYPES: Record<string, string> = { '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png',
  '.glb': 'model/gltf-binary', '.json': 'application/json', '.webp': 'image/webp', '.txt': 'text/plain; charset=utf-8' };

const gzCache = new Map<string, Buffer>();
function serveStatic(req: http.IncomingMessage, res: http.ServerResponse, pathname: string) {
  const rel = pathname === '/sw.js' ? 'sw.js' : pathname.replace(/^\/+/, '');
  if (!/^(assets|icons|models)\/[\w./-]+$|^sw\.js$/.test(rel) || rel.includes('..')) return false;
  const file = path.join(pub, rel);
  if (!file.startsWith(pub) || !fs.existsSync(file) || !fs.statSync(file).isFile()) return false;
  const versioned = /[?&]v=/.test(req.url || '');
  const gz = /\bgzip\b/.test(String(req.headers['accept-encoding'] || '')) && /\.(js|css|svg|glb|json)$/.test(file);
  const headers: Record<string, string> = {
    'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream',
    'Cache-Control': rel === 'sw.js' ? 'no-cache' : versioned ? 'public, max-age=31536000, immutable' : 'public, max-age=3600',
    ...(rel === 'sw.js' ? { 'Service-Worker-Allowed': '/' } : {}), Vary: 'Accept-Encoding'
  };
  if (gz) {
    let body = gzCache.get(file);
    if (!body) { body = zlib.gzipSync(fs.readFileSync(file), { level: 9 }); gzCache.set(file, body); }
    res.writeHead(200, { ...headers, 'Content-Encoding': 'gzip', 'Content-Length': String(body.length) }); res.end(body); return true;
  }
  res.writeHead(200, headers);
  fs.createReadStream(file).pipe(res);
  return true;
}

function html(res: http.ServerResponse, status: number, body: string, cache: 'public' | 'private') {
  res.writeHead(status, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': cache === 'public' ? 'public, max-age=0, must-revalidate' : 'no-store' });
  res.end(body);
}

const server = http.createServer(async (req, res) => {
  baseHeaders(res);
  const url = new URL(req.url || '/', 'http://x');
  const p = url.pathname;
  try {
    if (p.startsWith('/api/')) return await handleApi(req, res, url);
    if (req.method !== 'GET' && req.method !== 'HEAD') { res.writeHead(405); return res.end(); }
    if (serveStatic(req, res, p)) return;
    const s = await getSettings();
    const ctx: P.PageCtx = { s, origin: requestOrigin(req), build: BUILD, path: p };
    switch (p) {
      case '/': return html(res, 200, P.render(P.homePage(ctx)), 'public');
      case '/uslugi': return html(res, 200, P.render(P.servicesPage(ctx)), 'public');
      case '/kontakty': return html(res, 200, P.render(P.contactsPage(ctx)), 'public');
      case '/privacy': return html(res, 200, P.render(P.privacyPage(ctx)), 'public');
      case '/atribuciya': return html(res, 200, P.render(P.attributionPage(ctx)), 'public');
      case '/offline': return html(res, 200, P.render(P.offlinePage(ctx)), 'public');
      case '/kabinet': return html(res, 200, P.render(P.adminShell(ctx)), 'private');
      case '/sitemap.xml': res.writeHead(200, { 'Content-Type': 'application/xml; charset=utf-8' }); return res.end(P.sitemap(ctx.origin));
      case '/robots.txt': res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' }); return res.end(P.robots(ctx.origin));
      case '/manifest.webmanifest': res.writeHead(200, { 'Content-Type': 'application/manifest+json', 'Cache-Control': 'public, max-age=3600' }); return res.end(P.manifest(s));
      case '/healthz': res.writeHead(200, { 'Content-Type': 'text/plain' }); return res.end('ok');
    }
    if (/^\/z\/[A-Za-z0-9_-]{30,60}$/.test(p)) { res.setHeader('Referrer-Policy', 'no-referrer'); return html(res, 200, P.render(P.orderShell(ctx)), 'private'); }
    return html(res, 404, P.render(P.notFoundPage(ctx)), 'public');
  } catch (e) {
    console.error('[http]', p, e);
    if (!res.headersSent) { res.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' }); res.end('Временная ошибка сервера'); }
  }
});

async function main() {
  assertEnv();
  await migrate();
  if (process.env.MIGRATE_ONLY === '1') { console.log('[pompon] миграции применены'); process.exit(0); }
  if (!(await ensureOwner())) console.warn('[pompon] Кабинет не настроен: задайте OWNER_INITIAL_PASSWORD (от 10 символов).');
  server.listen(env.port, () => console.log(`[pompon] http://localhost:${env.port}  build=${BUILD}`));
}
main().catch((e) => { console.error(e); process.exit(1); });
