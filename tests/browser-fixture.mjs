import * as fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { CatalogStore } from '../src/store.mjs';
import { createApp } from '../src/http.mjs';

const project = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'skill-atlas-browser-'));
const root = path.join(directory, 'skills');
for (const [folder, name, description] of [
  ['archify', 'archify', 'Create architecture diagrams.'],
  ['research-helper', 'research-helper', 'Research evidence from papers.'],
  ['test-helper', 'test-helper', 'Test application behavior.'],
  ['demo-bundle', 'demo-bundle', 'Development workflow bundle.'],
  ['demo-bundle/skills/review', 'bundle-review', 'Review source changes.'],
  ['demo-bundle/skills/research', 'bundle-research', 'Research sources.'],
  ['demo-collection/plan', 'collection-plan', 'Plan implementation.'],
  ['demo-collection/test', 'collection-test', 'Test changes.'],
  ['uncertain/deep/first', 'uncertain-first', 'First nested member.'],
  ['uncertain/deep/second', 'uncertain-second', 'Second nested member.'],
]) {
  await fs.mkdir(path.join(root, folder), { recursive: true });
  const body = [
    `# ${name}`, '', '**Markdown preview** with *emphasis* and ~~removed text~~.', '',
    '[Example section](#example) | [External documentation](https://example.com/docs)', '',
    '- First item', '- Second item', '  - Nested item', '',
    '> A readable quotation.', '',
    '| Feature | State | Details |', '| --- | --- | --- |', '| Markdown | Ready | Tables and code |', '',
    '- [x] Completed', '- [ ] Pending', '',
    '## Example', '', '```javascript', `const message = "${'long-code-'.repeat(25)}";`, '```', '',
    '<script>window.markdownExecuted = true;</script>',
    '<img src="https://example.com/tracker.png" onerror="alert(1)" alt="External image">', '',
  ].join('\n');
  await fs.writeFile(path.join(root, folder, 'SKILL.md'), `---\nname: ${name}\ndescription: ${description}\n---\n${body}`, 'utf8');
}
await fs.writeFile(path.join(directory, 'config.json'), JSON.stringify({ roots: [{ id: 'fixture', label: 'Browser fixture', path: root, kind: 'project', enabled: true }], settings: { autoScan: false } }));
const store = await new CatalogStore(directory).initialize();
await store.scan();
const server = createApp(store, project);
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
console.log(`Browser fixture: http://127.0.0.1:${server.address().port}`);
console.log(`Temporary data: ${directory}`);
let stopping = false;
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, async () => {
  if (stopping) return;
  stopping = true;
  server.closeAllConnections();
  await new Promise(resolve => server.close(resolve));
  await store.pending;
  await fs.rm(directory, { recursive: true, force: true });
  console.log('Temporary browser fixture removed.');
  process.exit(0);
});
