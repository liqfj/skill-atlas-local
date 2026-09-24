import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { CatalogStore, acquireCatalogLock } from './src/store.mjs';
import { createApp } from './src/http.mjs';

const directory = path.dirname(fileURLToPath(import.meta.url));
const releaseLock = await acquireCatalogLock(directory);
const store = await new CatalogStore(directory).initialize();
const server = createApp(store, directory);
const preferredPort = Number(process.env.PORT || 4317);
if (!Number.isInteger(preferredPort) || preferredPort < 1024 || preferredPort > 65515) throw new Error('Invalid PORT');

async function listen(port) {
  return new Promise((resolve, reject) => {
    const failure = error => { server.off('listening', success); reject(error); };
    const success = () => { server.off('error', failure); resolve(); };
    server.once('error', failure);
    server.once('listening', success);
    server.listen(port, '127.0.0.1');
  });
}

for (let offset = 0; offset < 20; offset += 1) {
  try { await listen(preferredPort + offset); break; }
  catch (error) { if (error.code !== 'EADDRINUSE' || offset === 19) throw error; }
}
console.log(`Skill Atlas: http://127.0.0.1:${server.address().port}`);
console.log('Local only. Source skill directories are read-only.');
store.scan().then(view => console.log(`Indexed ${view.lastScan.discovered} skills; ${view.lastScan.issues} scan issues.`)).catch(() => console.error('Initial scan failed; existing catalog preserved.'));
const timer = setInterval(() => {
  if (store.config.settings.autoScan) store.scan().catch(() => console.error('Scheduled scan failed; existing catalog preserved.'));
}, 5 * 60 * 1000);
timer.unref();
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => {
  clearInterval(timer);
  server.close(() => store.pending.finally(async () => { await releaseLock(); process.exit(0); }));
});
