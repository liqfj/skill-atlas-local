import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { CatalogStore, acquireCatalogLock } from './src/store.mjs';

const directory = path.dirname(fileURLToPath(import.meta.url));
const releaseLock = await acquireCatalogLock(directory);
try {
	const store = await new CatalogStore(directory).initialize();
	const view = await store.scan();
	console.log(JSON.stringify({ lastScan: view.lastScan, roots: view.roots.map(root => ({ label: root.label, path: root.path, status: root.status, count: root.count, issues: root.issues })) }, null, 2));
} finally { await releaseLock(); }
