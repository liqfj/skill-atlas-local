import * as fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { create as createArchive, list as listArchive } from 'tar';
import { generateNotices } from './licenses.mjs';

const requiredFiles = ['LICENSE', 'README.md', 'SECURITY.md', 'CONTRIBUTING.md', 'THIRD_PARTY_NOTICES.md', 'package.json', 'package-lock.json', 'config.json', 'server.mjs', 'cli.mjs'];
const blockedSegments = new Set(['data', 'node_modules', 'artifacts', 'coverage', '.git', '.vscode', '.idea', '.trellis', '.agents', '.copilot', '.codex']);
const hash = value => createHash('sha256').update(value).digest('hex');
const sensitivePatterns = [
  ['PRIVATE_KEY', /-----BEGIN (?:RSA |EC |DSA |OPENSSH )?PRIVATE KEY-----/],
  ['ACCESS_TOKEN', /\b(?:gh[pousr]_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{40,}|sk-(?:proj-)?[A-Za-z0-9_-]{30,}|AKIA[0-9A-Z]{16})\b/],
  ['PERSONAL_PATH', /(?:[A-Za-z]:[\\/]{1,2}(?:Users|My_Code|develops)[\\/]{1,2}|\/(?:Users|home)\/)[^\s'"`<>]+/],
];

function fail(code, file = '') { throw new Error(file ? `${code}: ${file}` : code); }

export function validateReleasePath(file) {
  if (typeof file !== 'string' || !/^[a-zA-Z0-9_.-]+(?:\/[a-zA-Z0-9_.-]+)*$/.test(file) || file.split('/').some(part => ['.', '..'].includes(part) || blockedSegments.has(part.toLowerCase())) || /(?:^|\/)\.env(?:\.|$)|\.local\.json$|\.(?:log|tgz|zip|pem|key|p12|pfx|sqlite|db)$/i.test(file)) fail('PRIVATE_OR_INVALID_RELEASE_PATH');
  return file;
}

async function readPublicFile(directory, file) {
  const segments = validateReleasePath(file).split('/');
  let current = directory;
  for (const [index, segment] of segments.entries()) {
    current = path.join(current, segment);
    const stat = await fs.lstat(current);
    if (stat.isSymbolicLink() || (index < segments.length - 1 ? !stat.isDirectory() : !stat.isFile())) fail('RELEASE_LINK_OR_SPECIAL_FILE', file);
    if (index === segments.length - 1 && stat.size > 4 * 1024 * 1024) fail('RELEASE_FILE_TOO_LARGE', file);
  }
  const bytes = await fs.readFile(current);
  if (file.endsWith('.png')) {
    if (!bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) fail('INVALID_SCREENSHOT', file);
  } else {
    let text;
    try { text = new TextDecoder('utf-8', { fatal: true }).decode(bytes); }
    catch { fail('NON_TEXT_PUBLIC_FILE', file); }
    for (const [code, pattern] of sensitivePatterns) if (pattern.test(text)) fail(code, file);
  }
  return { path: file, bytes, size: bytes.length, sha256: hash(bytes) };
}

export async function inspectReleaseFiles(directory) {
  const manifest = JSON.parse(await fs.readFile(path.join(directory, 'package.json'), 'utf8'));
  if (manifest.private !== true || manifest.license !== 'MIT' || !/^[a-z0-9][a-z0-9-]+$/.test(manifest.name) || !/^\d+\.\d+\.\d+(?:-[a-zA-Z0-9.-]+)?$/.test(manifest.version)) fail('INVALID_PUBLIC_MANIFEST');
  if (!Array.isArray(manifest.files) || manifest.files.length > 150 || new Set(manifest.files).size !== manifest.files.length) fail('EXPLICIT_RELEASE_FILE_LIST_REQUIRED');
  for (const required of requiredFiles) if (!manifest.files.includes(required)) fail('MISSING_RELEASE_FILE', required);
  const files = [];
  for (const file of [...manifest.files].sort()) files.push(await readPublicFile(directory, file));
  if (files.reduce((sum, file) => sum + file.size, 0) > 16 * 1024 * 1024) fail('RELEASE_BUDGET_EXCEEDED');
  const defaults = JSON.parse(files.find(file => file.path === 'config.json').bytes.toString('utf8'));
  if (!Array.isArray(defaults.roots) || defaults.roots.some(root => typeof root.path !== 'string' || !/^~\/(?:[.a-zA-Z0-9_-]+\/)*[.a-zA-Z0-9_-]+$/.test(root.path) || root.path.split('/').includes('..'))) fail('PRIVATE_DEFAULT_CONFIGURATION', 'config.json');
  const lock = JSON.parse(files.find(file => file.path === 'package-lock.json').bytes.toString('utf8'));
  if (lock.packages?.['']?.name !== manifest.name || lock.packages[''].version !== manifest.version || lock.packages[''].license !== manifest.license) fail('ROOT_LOCKFILE_MISMATCH');
  for (const metadata of Object.values(lock.packages).slice(1)) {
    if (metadata.link || !metadata.integrity || typeof metadata.resolved !== 'string') fail('UNPINNED_DEPENDENCY');
    const resolved = new URL(metadata.resolved);
    if (resolved.protocol !== 'https:' || resolved.hostname !== 'registry.npmjs.org' || resolved.username || resolved.password || resolved.search) fail('NON_PUBLIC_DEPENDENCY_SOURCE');
  }
  const notices = files.find(file => file.path === 'THIRD_PARTY_NOTICES.md').bytes.toString('utf8').replace(/\r\n/g, '\n');
  if (notices !== await generateNotices(directory)) fail('THIRD_PARTY_NOTICES_OUTDATED');
  return { manifest, files };
}

export function inspectTrackedFiles(directory, files) {
  const git = args => spawnSync('git', ['-C', directory, ...args], { encoding: 'utf8', windowsHide: true });
  const root = git(['rev-parse', '--show-toplevel']);
  if (root.error?.code === 'ENOENT') return { repository: false, reason: 'git-unavailable', historyReviewed: false };
  if (root.status !== 0) return { repository: false, reason: 'not-initialized', historyReviewed: false };
  const normalized = value => process.platform === 'win32' ? path.resolve(value).toLowerCase() : path.resolve(value);
  if (normalized(root.stdout.trim()) !== normalized(directory)) fail('PARENT_REPOSITORY_REQUIRES_REVIEW');
  const tracked = git(['ls-files', '-z']);
  if (tracked.status !== 0) fail('GIT_INDEX_CHECK_FAILED');
  const allowed = new Set(files.map(file => file.path));
  const names = tracked.stdout.split('\0').filter(Boolean);
  for (const name of names) if (!allowed.has(name)) fail('NON_PUBLIC_TRACKED_FILE', name);
  return { repository: true, trackedFiles: names.length, historyReviewed: false };
}

export async function verifyArchive(filePath, prefix, files) {
  const expected = new Map(files.map(file => [`${prefix}/${file.path}`, file]));
  const seen = new Set();
  const issues = [];
  await listArchive({ file: filePath, strict: true, onReadEntry(entry) {
    const record = expected.get(entry.path);
    if (!record || seen.has(entry.path) || entry.type !== 'File' || entry.size !== record.size) issues.push('UNEXPECTED_ARCHIVE_ENTRY');
    seen.add(entry.path);
    const digest = createHash('sha256');
    entry.on('data', chunk => digest.update(chunk));
    entry.on('end', () => { if (!record || digest.digest('hex') !== record.sha256) issues.push('ARCHIVE_CONTENT_MISMATCH'); });
  } });
  if (seen.size !== expected.size || issues.length) fail(issues[0] ?? 'INCOMPLETE_ARCHIVE');
}

export async function buildRelease(directory) {
  const { manifest, files } = await inspectReleaseFiles(directory);
  const git = inspectTrackedFiles(directory, files);
  const temporary = await fs.mkdtemp(path.join(os.tmpdir(), 'skill-atlas-build-'));
  const prefix = `${manifest.name}-${manifest.version}`;
  try {
    const source = path.join(temporary, 'source');
    await fs.mkdir(source);
    for (const file of files) {
      const destination = path.join(source, file.path);
      await fs.mkdir(path.dirname(destination), { recursive: true });
      await fs.writeFile(destination, file.bytes, { flag: 'wx', mode: 0o644 });
    }
    const archive = path.join(temporary, 'release.tgz');
    await createArchive({ file: archive, cwd: source, prefix, gzip: true, portable: true, noMtime: true, strict: true }, files.map(file => file.path));
    await verifyArchive(archive, prefix, files);
    const archiveBytes = await fs.readFile(archive);
    const sha256 = hash(archiveBytes);
    const output = path.join(directory, 'artifacts');
    await fs.mkdir(output, { recursive: true });
    const outputStat = await fs.lstat(output);
    if (!outputStat.isDirectory() || outputStat.isSymbolicLink()) fail('INVALID_ARTIFACT_DIRECTORY');
    const basename = `${prefix}-${sha256.slice(0, 12)}`;
    const archivePath = path.join(output, `${basename}.tgz`);
    try { await fs.writeFile(archivePath, archiveBytes, { flag: 'wx', mode: 0o600 }); }
    catch (error) {
      if (error.code !== 'EEXIST' || (await fs.lstat(archivePath)).isSymbolicLink() || hash(await fs.readFile(archivePath)) !== sha256) throw error;
    }
    const receipt = { name: manifest.name, version: manifest.version, archive: `${basename}.tgz`, sha256, files: files.map(({ path: file, size, sha256: digest }) => ({ path: file, size, sha256: digest })) };
    const receiptPath = path.join(output, `${basename}.manifest.json`);
    const receiptText = JSON.stringify(receipt, null, 2) + '\n';
    try { await fs.writeFile(receiptPath, receiptText, { flag: 'wx', mode: 0o600 }); }
    catch (error) {
      if (error.code !== 'EEXIST' || (await fs.lstat(receiptPath)).isSymbolicLink() || await fs.readFile(receiptPath, 'utf8') !== receiptText) throw error;
    }
    return { archive: path.relative(directory, archivePath), receipt: path.relative(directory, receiptPath), sha256, fileCount: files.length, git };
  } finally { await fs.rm(temporary, { recursive: true, force: true }); }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const directory = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
  try {
    if (process.argv[2] === '--build') console.log(JSON.stringify(await buildRelease(directory), null, 2));
    else {
      const { files } = await inspectReleaseFiles(directory);
      console.log(JSON.stringify({ checked: true, fileCount: files.length, bytes: files.reduce((sum, file) => sum + file.size, 0), git: inspectTrackedFiles(directory, files), files: files.map(file => file.path) }, null, 2));
    }
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}
