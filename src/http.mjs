import http from 'node:http';
import * as fs from 'node:fs/promises';
import path from 'node:path';
import { randomBytes, timingSafeEqual } from 'node:crypto';
import { icons } from 'lucide';
import { AppError } from './store.mjs';
import { readEntry } from './catalog.mjs';
import { renderMarkdown } from './markdown.mjs';

const staticFiles = new Map([
  ['/', ['public/index.html', 'text/html; charset=utf-8']],
  ['/app.js', ['public/app.js', 'text/javascript; charset=utf-8']],
  ['/style.css', ['public/style.css', 'text/css; charset=utf-8']],
  ['/vendor/lucide.js', ['node_modules/lucide/dist/umd/lucide.min.js', 'text/javascript; charset=utf-8']],
]);

const brandMark = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="#246b59" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">${icons.LibraryBig.map(([tag, attributes]) => `<${tag} ${Object.entries(attributes).map(([name, value]) => `${name}="${value}"`).join(' ')}/>`).join('')}</svg>`;

async function bodyJson(request) {
  if (!request.headers['content-type']?.startsWith('application/json')) throw new AppError('JSON_REQUIRED', 415);
  const chunks = [];
  let length = 0;
  for await (const chunk of request) {
    length += chunk.length;
    if (length > 32768) throw new AppError('BODY_TOO_LARGE', 413);
    chunks.push(chunk);
  }
  try {
    const value = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('INVALID');
    return value;
  } catch { throw new AppError('INVALID_JSON'); }
}

export function createApp(store, directory) {
  const token = randomBytes(32).toString('hex');
  const tokenBytes = Buffer.from(token);
  const headers = {
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'no-referrer',
    'Cross-Origin-Resource-Policy': 'same-origin',
    'Content-Security-Policy': "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self'; font-src 'self'; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'",
  };
  const server = http.createServer(async (request, response) => {
    const json = (value, status = 200, extra = {}) => {
      response.writeHead(status, { ...headers, 'Content-Type': 'application/json; charset=utf-8', ...extra });
      response.end(JSON.stringify(value));
    };
    try {
      const port = server.address().port;
      const allowedHosts = [`127.0.0.1:${port}`, `localhost:${port}`];
      if (!allowedHosts.includes(request.headers.host)) throw new AppError('LOCAL_ONLY', 403);
      if ((request.headers.origin && !allowedHosts.some(host => request.headers.origin === `http://${host}`)) || request.headers['sec-fetch-site'] === 'cross-site') throw new AppError('ORIGIN_DENIED', 403);
      const url = new URL(request.url, `http://127.0.0.1:${port}`);
      if (request.method === 'GET' && url.pathname === '/assets/catalog-mark.svg') {
        response.writeHead(200, { ...headers, 'Content-Type': 'image/svg+xml' });
        return response.end(brandMark);
      }
      if (!['GET', 'HEAD'].includes(request.method)) {
        const supplied = Buffer.from(request.headers['x-catalog-token'] ?? '');
        if (supplied.length !== tokenBytes.length || !timingSafeEqual(supplied, tokenBytes)) throw new AppError('TOKEN_REQUIRED', 403);
      }
      if (request.method === 'GET' && url.pathname === '/api/catalog') return json({ ...store.view(), token });
      if (request.method === 'GET' && url.pathname === '/api/candidates') return json(await store.candidates());
      if (request.method === 'GET' && url.pathname === '/api/export') return json(store.view(), 200, { 'Content-Disposition': 'attachment; filename="skill-atlas.json"' });
      if (request.method === 'POST' && url.pathname === '/api/scan') {
        await bodyJson(request);
        return json(await store.scan());
      }
      if (request.method === 'POST' && url.pathname === '/api/roots') return json(await store.addRoot(await bodyJson(request)), 201);
      if (request.method === 'PATCH' && url.pathname === '/api/settings') return json(await store.updateSettings(await bodyJson(request)));
      if (request.method === 'PUT' && url.pathname === '/api/categories') return json(await store.updateTaxonomy(await bodyJson(request)));
      if (request.method === 'POST' && url.pathname === '/api/reclassify/preview') return json(await store.previewReclassification(await bodyJson(request)));
      if (request.method === 'POST' && url.pathname === '/api/reclassify/apply') return json(await store.applyReclassification(await bodyJson(request)));
      if (request.method === 'POST' && url.pathname === '/api/packages/structure') return json(await store.updatePackageStructure(await bodyJson(request)));
      const packageMatch = /^\/api\/packages\/(pkg-[a-f0-9]{24})\/category$/.exec(url.pathname);
      if (request.method === 'PATCH' && packageMatch) return json(await store.setPackageCategory(packageMatch[1], await bodyJson(request)));
      const rootMatch = /^\/api\/roots\/([a-zA-Z0-9-]+)$/.exec(url.pathname);
      if (request.method === 'PATCH' && rootMatch) return json(await store.updateRoot(rootMatch[1], await bodyJson(request)));
      const skillMatch = /^\/api\/skills\/([a-f0-9]{24})(\/document|\/category|\/introduction)?$/.exec(url.pathname);
      if (skillMatch) {
        if (request.method === 'PATCH' && !skillMatch[2]) return json(await store.updateSkill(skillMatch[1], await bodyJson(request)));
        if (request.method === 'PATCH' && skillMatch[2] === '/category') return json(await store.setSkillCategory(skillMatch[1], await bodyJson(request)));
        if (request.method === 'PATCH' && skillMatch[2] === '/introduction') return json(await store.updateIntroduction(skillMatch[1], await bodyJson(request)));
        if (request.method === 'GET' && skillMatch[2] === '/document') {
          const skill = store.catalog.skills.find(item => item.id === skillMatch[1]);
          if (!skill) throw new AppError('NOT_FOUND', 404);
          try {
            const { content } = await readEntry(skill.canonicalPath);
            return json({ content, html: renderMarkdown(content) });
          }
          catch { throw new AppError('DOCUMENT_UNAVAILABLE', 409); }
        }
      }
      const asset = staticFiles.get(url.pathname);
      if (asset && ['GET', 'HEAD'].includes(request.method)) {
        const content = await fs.readFile(path.join(directory, asset[0]));
        response.writeHead(200, { ...headers, 'Content-Type': asset[1] });
        return response.end(request.method === 'HEAD' ? undefined : content);
      }
      throw new AppError('NOT_FOUND', 404);
    } catch (error) {
      if (!response.headersSent) json({ error: error instanceof AppError ? error.code : 'INTERNAL_ERROR' }, error instanceof AppError ? error.status : 500);
      else response.end();
    }
  });
  server.requestTimeout = 15000;
  server.headersTimeout = 10000;
  return server;
}
