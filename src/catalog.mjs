import * as fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { createHash, randomUUID } from 'node:crypto';
import { parseDocument } from 'yaml';
import { packageStructure } from './packages.mjs';

export const LIMITS = Object.freeze({ fileBytes: 1024 * 1024, headerBytes: 64 * 1024, totalBytes: 32 * 1024 * 1024, entries: 30000, depth: 16 });
const ignoredDirectories = new Set(['.git', 'node_modules', '.venv', 'venv', '__pycache__', '.cache', 'dist', 'build']);
const fingerprint = value => createHash('sha256').update(value).digest('hex');
const normalized = value => process.platform === 'win32' ? path.resolve(value).toLowerCase() : path.resolve(value);
const text = (value, maximum = 8000) => typeof value === 'string' ? value.trim().slice(0, maximum) : '';

export function expandPath(value) {
  return path.resolve(value === '~' ? os.homedir() : /^~[/\\]/.test(value) ? path.join(os.homedir(), value.slice(2)) : value);
}

export function parseSkill(content, fallbackName) {
  const source = content.replace(/^\uFEFF/, '');
  const opening = /^---[ \t]*\r?\n/.exec(source);
  if (!opening) return { name: fallbackName, description: '', parseError: 'MISSING_FRONTMATTER' };
  const closing = /^(?:---|\.\.\.)[ \t]*\r?$/gm;
  closing.lastIndex = opening[0].length;
  const match = closing.exec(source);
  if (!match) return { name: fallbackName, description: '', parseError: 'UNCLOSED_FRONTMATTER' };
  const header = source.slice(opening[0].length, match.index);
  if (Buffer.byteLength(header, 'utf8') > LIMITS.headerBytes) return { name: fallbackName, description: '', parseError: 'FRONTMATTER_TOO_LARGE' };
  try {
    const document = parseDocument(header, { schema: 'core', uniqueKeys: true, strict: true });
    if (document.errors.length) throw new Error('INVALID_FRONTMATTER');
    const metadata = document.toJS({ maxAliasCount: 0 });
    if (!metadata || Array.isArray(metadata) || typeof metadata !== 'object') throw new Error('INVALID_FRONTMATTER');
    const name = text(metadata.name, 128) || fallbackName;
    const description = text(metadata.description);
    return {
      name,
      description,
      version: text(String(metadata.metadata?.version ?? metadata.version ?? ''), 100),
      author: text(metadata.metadata?.author, 200),
      license: text(metadata.license, 100),
      userInvocable: metadata['user-invocable'] !== false,
      modelInvocable: metadata['disable-model-invocation'] !== true,
      parseError: !description ? 'MISSING_DESCRIPTION' : !text(metadata.name) ? 'MISSING_NAME' : null,
    };
  } catch {
    return { name: fallbackName, description: '', parseError: 'INVALID_FRONTMATTER' };
  }
}

function sameSnapshot(before, after) {
  return before.dev === after.dev && before.ino === after.ino && before.size === after.size && before.mtimeMs === after.mtimeMs;
}

export async function readEntry(filePath, budget = { bytes: 0 }) {
  const realPath = await fs.realpath(filePath);
  const handle = await fs.open(realPath, 'r');
  try {
    const before = await handle.stat();
    if (!before.isFile()) throw new Error('NOT_A_FILE');
    if (before.size > LIMITS.fileBytes) throw new Error('FILE_TOO_LARGE');
    budget.bytes += before.size;
    if (budget.bytes > LIMITS.totalBytes) throw new Error('READ_BUDGET_EXCEEDED');
    const buffer = Buffer.alloc(before.size + 1);
    let length = 0;
    while (length < buffer.length) {
      const read = await handle.read(buffer, length, buffer.length - length, length);
      if (!read.bytesRead) break;
      length += read.bytesRead;
    }
    const after = await handle.stat();
    const current = await fs.stat(realPath);
    if (length !== before.size || !sameSnapshot(before, after) || before.ctimeMs !== after.ctimeMs || !sameSnapshot(after, current)) throw new Error('FILE_CHANGED_DURING_READ');
    const bytes = buffer.subarray(0, length);
    return { realPath, content: new TextDecoder('utf-8', { fatal: true }).decode(bytes), hash: fingerprint(bytes), modifiedAt: before.mtime.toISOString() };
  } finally {
    await handle.close();
  }
}

function errorCode(error) {
  const allowed = ['ENOENT', 'EACCES', 'EPERM', 'ENOTDIR', 'ELOOP', 'FILE_TOO_LARGE', 'READ_BUDGET_EXCEEDED', 'FILE_CHANGED_DURING_READ', 'NOT_A_FILE', 'DEPTH_LIMIT', 'ENTRY_LIMIT'];
  return allowed.includes(error.code) ? error.code : allowed.includes(error.message) ? error.message : 'READ_ERROR';
}

export function emptyCatalog() {
  return { version: 1, lastScan: null, roots: [], skills: [], events: [] };
}

export async function scanCatalog(roots, previous = emptyCatalog()) {
  const startedAt = new Date().toISOString();
  const priorById = new Map(previous.skills.map(skill => [skill.id, skill]));
  const found = new Map();
  const reports = [];
  const budget = { bytes: 0, entries: 0 };
  for (const root of roots) {
    const rootPath = expandPath(root.path);
    const report = { ...root, path: rootPath, status: root.enabled === false ? 'disabled' : 'ok', count: 0, issues: [] };
    reports.push(report);
    if (root.enabled === false) continue;
    const rootSkills = new Set();
    const issue = (filePath, code) => {
      report.status = 'partial';
      if (report.issues.length < 100) report.issues.push({ path: path.relative(rootPath, filePath) || '.', code });
    };
    async function walk(directory, depth, ancestors = new Set(), outerContainer = null, parentSkillId = null) {
      if (depth > LIMITS.depth) { issue(directory, 'DEPTH_LIMIT'); return; }
      if (budget.entries > LIMITS.entries || budget.bytes > LIMITS.totalBytes) { issue(directory, 'ENTRY_LIMIT'); return; }
      try {
        const actual = await fs.realpath(directory);
        const key = normalized(actual);
        if (ancestors.has(key)) return;
        const descendants = new Set(ancestors);
        descendants.add(key);
        const entries = await fs.readdir(directory, { withFileTypes: true });
        entries.sort((left, right) => left.name.localeCompare(right.name));
        const entryFile = entries.find(entry => entry.name.toLowerCase() === 'skill.md');
        let localSkillId = null;
        if (entryFile) {
          try { localSkillId = fingerprint(normalized(await fs.realpath(path.join(directory, entryFile.name)))).slice(0, 24); }
          catch (error) { issue(path.join(directory, entryFile.name), errorCode(error)); }
        }
        const container = outerContainer ?? (depth > 0 || localSkillId ? {
          path: directory, canonicalPath: actual, name: path.basename(directory), entrySkillId: localSkillId,
        } : null);
        for (const entry of entries) {
          budget.entries += 1;
          if (budget.entries > LIMITS.entries) { issue(directory, 'ENTRY_LIMIT'); break; }
          const entryPath = path.join(directory, entry.name);
          if (entry.name.toLowerCase() === 'skill.md') {
            try {
              const read = await readEntry(entryPath, budget);
              const id = fingerprint(normalized(read.realPath)).slice(0, 24);
              const cached = priorById.get(id);
              const parsed = cached?.hash === read.hash ? cached.metadata : parseSkill(read.content, path.basename(directory));
              if (parsed.parseError) issue(entryPath, parsed.parseError);
              const relativeParts = container ? path.relative(container.path, entryPath).split(path.sep) : [];
              const directMember = relativeParts.length <= 2 || relativeParts.length === 3 && relativeParts[0].toLowerCase() === 'skills';
              const location = { rootId: root.id, path: entryPath, status: 'present', parentSkillId, container: container ? { ...container, directMember } : null };
              if (found.has(id)) {
                found.get(id).locations.push(location);
              } else {
                found.set(id, { id, metadata: parsed, canonicalPath: read.realPath, hash: read.hash, modifiedAt: read.modifiedAt, locations: [location] });
              }
              rootSkills.add(id);
            } catch (error) { issue(entryPath, errorCode(error)); }
          } else if (!ignoredDirectories.has(entry.name.toLowerCase()) && (entry.isDirectory() || entry.isSymbolicLink())) {
            try {
              if ((await fs.stat(entryPath)).isDirectory()) await walk(entryPath, depth + 1, descendants, container, localSkillId ?? parentSkillId);
            } catch (error) { issue(entryPath, errorCode(error)); }
          }
        }
      } catch (error) {
        issue(directory, errorCode(error));
        if (directory === rootPath) report.status = error.code === 'ENOENT' ? 'unavailable' : 'error';
      }
    }
    await walk(rootPath, 0);
    report.count = rootSkills.size;
  }

  const time = new Date().toISOString();
  const reportsById = new Map(reports.map(report => [report.id, report]));
  const changes = [];
  const counts = { added: 0, updated: 0, missing: 0, restored: 0, unchanged: 0 };
  const ids = new Set([...priorById.keys(), ...found.keys()]);
  const skills = [];
  for (const id of ids) {
    const old = priorById.get(id);
    const current = found.get(id);
    const locations = [...(current?.locations ?? [])];
    const currentKeys = new Set(locations.map(location => `${location.rootId}:${normalized(location.path)}`));
    for (const location of old?.locations ?? []) {
      if (currentKeys.has(`${location.rootId}:${normalized(location.path)}`)) continue;
      locations.push({ ...location, status: reportsById.get(location.rootId)?.status === 'ok' ? 'missing' : 'unknown' });
    }
    const status = locations.some(location => location.status === 'present') ? 'present' : locations.some(location => location.status === 'unknown') ? 'unknown' : 'missing';
    const skill = {
      ...old,
      ...current,
      locations,
      status,
      firstSeen: old?.firstSeen ?? time,
      lastSeen: current ? time : old.lastSeen,
      changedAt: old?.changedAt ?? time,
      note: old?.note ?? '',
      customSummary: old?.customSummary ?? '',
    };
    const kinds = [];
    if (!old) kinds.push('added');
    else {
      if (current && old.hash !== current.hash) kinds.push('updated');
      if (old.status !== 'missing' && status === 'missing') kinds.push('missing');
      if (old.status === 'missing' && status === 'present') kinds.push('restored');
    }
    if (!kinds.length && current) counts.unchanged += 1;
    for (const kind of kinds) {
      counts[kind] += 1;
      skill.changedAt = time;
      changes.push({ id: randomUUID(), type: kind, skillId: id, name: skill.metadata.name, at: time, path: skill.canonicalPath });
    }
    skills.push(skill);
  }
  skills.sort((left, right) => left.metadata.name.localeCompare(right.metadata.name));
  const structure = packageStructure(skills, previous.packages, previous.packageRules);
  return {
    ...previous,
    version: 1,
    lastScan: { startedAt, finishedAt: time, counts, discovered: found.size, issues: reports.reduce((sum, report) => sum + report.issues.length, 0), bytesRead: budget.bytes },
    roots: reports,
    ...structure,
    events: [...changes, ...previous.events],
  };
}
