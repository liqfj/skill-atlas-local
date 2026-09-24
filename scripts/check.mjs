import * as fs from 'node:fs/promises';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const directory = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const files = ['server.mjs', 'cli.mjs'];
for (const folder of ['src', 'public', 'scripts', 'tests']) {
  for (const entry of await fs.readdir(path.join(directory, folder), { withFileTypes: true })) {
    if (entry.isFile() && /\.(?:mjs|js)$/.test(entry.name)) files.push(`${folder}/${entry.name}`);
  }
}
for (const file of files) {
  const result = spawnSync(process.execPath, ['--check', path.join(directory, file)], { encoding: 'utf8', windowsHide: true });
  if (result.status !== 0) {
    console.error(`Syntax validation failed: ${file}`);
    console.error(result.stderr || result.error?.message || 'Unknown validation error');
    process.exit(1);
  }
}
console.log(`Syntax validation passed for ${files.length} JavaScript files.`);
