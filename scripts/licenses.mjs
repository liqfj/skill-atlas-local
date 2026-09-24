import * as fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';

const supportedLicenses = new Set(['MIT', 'ISC', 'BSD-2-Clause', 'BSD-3-Clause', 'BlueOak-1.0.0']);
const licenseFilePattern = /^(?:licen[cs]e|copying|notice)(?:[.-].*)?$/i;
const normalizedText = value => value.replace(/\r\n/g, '\n').trimEnd();
const declarations = {
  'launder@1.7.1': {
    integrity: 'sha512-mU6WRz5EusL9ZZuiZ5SO4Y6C0P9PAUR9iwdb6bzj4KDihm28DiHFw+/yk9DBH4f+Pv1wuzQ4e2jV3oQ7mkIqvw==',
    author: 'Apostrophe Technologies, Inc.',
    license: 'MIT',
    source: 'https://github.com/apostrophecms/apostrophe/blob/e9b0ab0849a5dfea0f75335fbdf99b5c6bf9e4b3/packages/launder/package.json',
  },
};

export async function collectDependencyNotices(directory) {
  const lock = JSON.parse(await fs.readFile(path.join(directory, 'package-lock.json'), 'utf8'));
  if (lock.lockfileVersion !== 3 || !lock.packages) throw new Error('UNSUPPORTED_LOCKFILE');
  const entries = [];
  for (const [location, locked] of Object.entries(lock.packages)) {
    if (!location) continue;
    if (!/^node_modules\/(?:[@a-zA-Z0-9_.-]+\/)*[@a-zA-Z0-9_.-]+$/.test(location) || location.split('/').includes('..') || locked.link) throw new Error('UNSUPPORTED_DEPENDENCY_PATH');
    const packageDirectory = path.join(directory, location);
    if ((await fs.lstat(packageDirectory)).isSymbolicLink()) throw new Error('LINKED_DEPENDENCY');
    const manifest = JSON.parse(await fs.readFile(path.join(packageDirectory, 'package.json'), 'utf8'));
    if (manifest.version !== locked.version || manifest.license !== locked.license) throw new Error(`DEPENDENCY_METADATA_MISMATCH: ${location}`);
    if (!supportedLicenses.has(manifest.license)) throw new Error(`LICENSE_REVIEW_REQUIRED: ${manifest.name}`);
    const names = (await fs.readdir(packageDirectory)).filter(name => licenseFilePattern.test(name)).sort();
    const texts = [];
    for (const name of names) {
      const target = path.join(packageDirectory, name);
      const stat = await fs.lstat(target);
      if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 512 * 1024) throw new Error(`INVALID_LICENSE_FILE: ${manifest.name}`);
      const content = normalizedText(await fs.readFile(target, 'utf8'));
      if (!content) throw new Error(`EMPTY_LICENSE_FILE: ${manifest.name}`);
      texts.push({ name, content });
    }
    if (!texts.length) {
      const declaration = declarations[`${manifest.name}@${manifest.version}`];
      if (!declaration || declaration.integrity !== locked.integrity || declaration.license !== manifest.license || declaration.author !== manifest.author) throw new Error(`MISSING_DEPENDENCY_LICENSE: ${manifest.name}@${manifest.version}`);
      texts.push({ name: 'Upstream metadata declaration (no standalone license file)', content: [
        `Package: ${manifest.name}@${manifest.version}`,
        `Declared license: ${manifest.license}`,
        `Declared author: ${declaration.author}`,
        `Pinned source: ${declaration.source}`,
        `npm artifact integrity: ${declaration.integrity}`,
        '',
        'The published npm artifact and the pinned package directory do not contain a standalone license file.',
        'This section records upstream metadata, not a reproduced copyright notice or a legal clearance.',
        'No launder implementation is bundled in the Skill Atlas source release.',
        'Before distributing a build containing its implementation, review the upstream declaration and applicable notice requirements.',
      ].join('\n') });
    }
    entries.push({ name: manifest.name, version: manifest.version, license: manifest.license, texts });
  }
  return entries.sort((left, right) => `${left.name}@${left.version}`.localeCompare(`${right.name}@${right.version}`, 'en'));
}

export async function generateNotices(directory) {
  const entries = await collectDependencyNotices(directory);
  const sections = entries.map(entry => [
    `## ${entry.name} ${entry.version}`,
    '',
    `Declared license: ${entry.license}.`,
    '',
    ...entry.texts.flatMap(text => [
      `### ${text.name}`,
      '',
      `SHA-256 (normalized text): ${createHash('sha256').update(text.content).digest('hex')}`,
      '',
      ...text.content.split('\n').map(line => `    ${line}`.trimEnd()),
      '',
    ]),
  ].join('\n'));
  return [
    '# Third-Party Notices',
    '',
    'Generated from the exact versions in package-lock.json and their installed license files, with explicitly identified metadata-only exceptions.',
    'Runtime and development dependencies are included. Do not edit this generated file manually.',
    'Regenerate with `npm run licenses:write`; verify with `npm run licenses:check`.',
    '',
    'Installed user skills, source documents and private catalog data are not distributed with this project.',
    'Their names in built-in reference summaries do not imply endorsement or transfer their licenses.',
    '',
    ...sections,
  ].join('\n').trimEnd() + '\n';
}

export async function verifyNotices(directory) {
  const expected = await generateNotices(directory);
  const actual = await fs.readFile(path.join(directory, 'THIRD_PARTY_NOTICES.md'), 'utf8');
  if (actual.replace(/\r\n/g, '\n') !== expected) throw new Error('THIRD_PARTY_NOTICES_OUTDATED');
  return expected;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const directory = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
  try {
    if (process.argv[2] === '--write') {
      await fs.writeFile(path.join(directory, 'THIRD_PARTY_NOTICES.md'), await generateNotices(directory), 'utf8');
      console.log('Third-party notices generated from locked dependency licenses.');
    } else {
      await verifyNotices(directory);
      console.log('Third-party notices match all locked dependency licenses.');
    }
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}
