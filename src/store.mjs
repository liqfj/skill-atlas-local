import * as fs from 'node:fs/promises';
import { readFileSync, unlinkSync } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { createHash, randomUUID } from 'node:crypto';
import { emptyCatalog, expandPath, scanCatalog } from './catalog.mjs';
import { createDefaultTaxonomy, prepareIntroduction, presentCatalog } from './presentation.mjs';
import { validateTaxonomy, automaticCategory, appliedClassification, planReclassification } from './classification.mjs';
import { descriptionHash, validateLocalIntroductions } from './introductions.mjs';
import { packageStructure, packageSubject, classificationUnits, structureFingerprint } from './packages.mjs';

export class AppError extends Error {
  constructor(code, status = 400) {
    super(code);
    this.code = code;
    this.status = status;
  }
}

function importFingerprint(value) {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

function importBytesFingerprint(value) {
  return createHash('sha256').update(value).digest('hex');
}

export async function acquireCatalogLock(directory) {
  const lockPath = path.join(directory, 'data', 'instance.lock');
  await fs.mkdir(path.dirname(lockPath), { recursive: true });
  let handle;
  try { handle = await fs.open(lockPath, 'wx', 0o600); }
  catch (error) {
    if (error.code === 'EEXIST') throw new AppError('CATALOG_ALREADY_RUNNING', 409);
    throw error;
  }
  const marker = JSON.stringify({ pid: process.pid, owner: randomUUID() });
  const remove = () => {
    try { if (readFileSync(lockPath, 'utf8') === marker) unlinkSync(lockPath); }
    catch {}
  };
  try { await handle.writeFile(marker, 'utf8'); }
  catch (error) { await handle.close(); remove(); throw error; }
  process.once('exit', remove);
  let released = false;
  return async () => {
    if (released) return;
    released = true;
    await handle.close();
    remove();
    process.off('exit', remove);
  };
}

export async function atomicJson(filePath, value, expectedHash) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  const temporary = `${filePath}.${randomUUID()}.tmp`;
  try {
    await fs.writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, { encoding: 'utf8', flag: 'wx', mode: 0o600 });
    if (expectedHash !== undefined) {
      let currentBytes;
      try { currentBytes = await fs.readFile(filePath); }
      catch { throw new AppError('IMPORT_STALE', 409); }
      if (importBytesFingerprint(currentBytes) !== expectedHash) throw new AppError('IMPORT_STALE', 409);
    }
    await fs.rename(temporary, filePath);
  } finally {
    await fs.rm(temporary, { force: true });
  }
}

async function readJson(filePath, fallback) {
  try { return JSON.parse(await fs.readFile(filePath, 'utf8')); }
  catch (error) {
    if (error.code === 'ENOENT' && fallback !== undefined) return fallback;
    throw new AppError('INVALID_LOCAL_DATA', 500);
  }
}

function validateConfig(config) {
  if (!config || !Array.isArray(config.roots) || config.roots.length > 50) throw new AppError('INVALID_CONFIG', 500);
  const ids = new Set();
  for (const root of config.roots) {
    if (!root || typeof root.id !== 'string' || ids.has(root.id) || typeof root.label !== 'string' || typeof root.path !== 'string') throw new AppError('INVALID_CONFIG', 500);
    ids.add(root.id);
    validatePath(root.path);
  }
  return { ...config, settings: { autoScan: config.settings?.autoScan !== false, intervalMinutes: 5 } };
}

function validatePath(value) {
  if (typeof value !== 'string' || !value.trim() || value.length > 2000 || /[\u0000-\u001f]/.test(value) || /^[\\/]{2}/.test(value) || (!path.isAbsolute(value) && !/^~([/\\]|$)/.test(value))) throw new AppError('INVALID_PATH');
  const resolved = expandPath(value);
  if (resolved.toLowerCase() === path.parse(resolved).root.toLowerCase() || resolved.toLowerCase() === os.homedir().toLowerCase()) throw new AppError('PATH_TOO_BROAD');
  return resolved;
}

function preparedCatalog(catalog, localEntries = {}) {
  let taxonomy;
  try { taxonomy = validateTaxonomy(catalog.taxonomy ?? createDefaultTaxonomy()); }
  catch { throw new AppError('INVALID_LOCAL_DATA', 500); }
  const structure = packageStructure(catalog.skills, catalog.packages, catalog.packageRules);
  const skills = structure.skills.map(skill => ({ ...skill, classification: appliedClassification(skill, taxonomy), introduction: prepareIntroduction(skill, localEntries) }));
  const packages = structure.packages.map(group => ({ ...group, classification: appliedClassification(packageSubject(group, skills), taxonomy) }));
  return {
    ...catalog,
    ...structure,
    taxonomy,
    taxonomyRevision: catalog.taxonomyRevision ?? 1,
    packageRules: catalog.packageRules ?? [],
    packages,
    skills,
  };
}

const importSkillId = /^[a-f0-9]{24}$/;
const importPackageId = /^pkg-[a-f0-9]{24}$/;
const importEventTypes = new Set(['added', 'updated', 'missing', 'restored', 'classified', 'packaged']);

function importedClassification(value, taxonomy) {
  if (!value || !['manual', 'auto'].includes(value.mode) || !taxonomy.some(category => category.id === value.categoryId) || value.appliedAt !== undefined && (typeof value.appliedAt !== 'string' || !Number.isFinite(Date.parse(value.appliedAt)))) throw new AppError('INVALID_IMPORT');
  return { categoryId: value.categoryId, mode: value.mode, ...(value.appliedAt ? { appliedAt: value.appliedAt } : {}) };
}

function importedIntroduction(value) {
  if (value === null) return null;
  if (!value || typeof value.text !== 'string' || !value.text.trim() || value.text.length > 4000 || typeof value.whenToUse !== 'string' || value.whenToUse.length > 2000 || !['manual', 'local', 'preset', 'original'].includes(value.source) || !/^[a-f0-9]{64}$/.test(value.sourceHash) || !Number.isSafeInteger(value.revision) || value.revision < 1 || typeof value.updatedAt !== 'string' || !Number.isFinite(Date.parse(value.updatedAt))) throw new AppError('INVALID_IMPORT');
  return { text: value.text, whenToUse: value.whenToUse, source: value.source, sourceHash: value.sourceHash, revision: value.revision, updatedAt: value.updatedAt };
}

function importedEvent(event, knownIds) {
  if (!event || typeof event !== 'object' || !/^[a-f0-9-]{36}$/.test(event.id) || !importEventTypes.has(event.type) || ![importSkillId, importPackageId].some(pattern => pattern.test(event.skillId)) || typeof event.name !== 'string' || event.name.length > 1000 || typeof event.at !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(event.at) || !Number.isFinite(Date.parse(event.at)) || event.path !== undefined && event.path !== null && (typeof event.path !== 'string' || event.path.length > 2000)) throw new AppError('INVALID_IMPORT');
  const result = { id: event.id, type: event.type, skillId: event.skillId, name: event.name, at: event.at };
  if (event.path !== undefined) result.path = event.path;
  if (event.packageId !== undefined) {
    if (!importPackageId.test(event.packageId)) throw new AppError('INVALID_IMPORT');
    result.packageId = event.packageId;
  }
  for (const field of ['fromCategory', 'toCategory']) if (event[field] !== undefined) {
    if (typeof event[field] !== 'string' || event[field].length > 200) throw new AppError('INVALID_IMPORT');
    result[field] = event[field];
  }
  if (event.mode !== undefined) {
    if (!['manual', 'auto'].includes(event.mode)) throw new AppError('INVALID_IMPORT');
    result.mode = event.mode;
  }
  if (event.action !== undefined) {
    if (!['create', 'edit', 'confirm', 'suppress'].includes(event.action)) throw new AppError('INVALID_IMPORT');
    result.action = event.action;
  }
  if (event.entityType !== undefined) {
    if (event.entityType !== 'package') throw new AppError('INVALID_IMPORT');
    result.entityType = event.entityType;
  }
  if (event.memberCount !== undefined) {
    if (!Number.isSafeInteger(event.memberCount) || event.memberCount < 0 || event.memberCount > 30000) throw new AppError('INVALID_IMPORT');
    result.memberCount = event.memberCount;
  }
  if (result.packageId) {
    if (result.skillId !== result.packageId || !['classified', 'packaged'].includes(result.type)) throw new AppError('INVALID_IMPORT');
  } else if (!knownIds.has(result.skillId) || result.type === 'packaged' || result.entityType === 'package') throw new AppError('INVALID_IMPORT');
  return result;
}

function importedCatalog(snapshot, current, localEntries) {
  if (!Number.isSafeInteger(snapshot.taxonomyRevision) || snapshot.taxonomyRevision < 1 || !Array.isArray(snapshot.packageRules) || snapshot.packageRules.length > 1000 || snapshot.events.length > 100000 || snapshot.packages.length > 1000) throw new AppError('INVALID_IMPORT');
  let taxonomy;
  try { taxonomy = validateTaxonomy(snapshot.taxonomy); }
  catch { throw new AppError('INVALID_IMPORT'); }
  const knownIds = new Set(current.skills.map(skill => skill.id));
  const backupSkills = new Map(snapshot.skills.map(skill => [skill.id, skill]));
  const skills = current.skills.map(skill => {
    const backup = backupSkills.get(skill.id);
    return { ...skill, note: backup.note, customSummary: backup.customSummary, introduction: importedIntroduction(backup.introduction), classification: importedClassification(backup.classification, taxonomy) };
  });
  const groupIds = new Set();
  const packages = snapshot.packages.map(group => {
    if (!group || !importPackageId.test(group.id) || groupIds.has(group.id) || typeof group.name !== 'string' || !group.name.trim() || group.name.length > 100 || !Array.isArray(group.memberIds) || group.memberIds.length < 2 || group.memberIds.length > 5000 || new Set(group.memberIds).size !== group.memberIds.length || group.memberIds.some(id => !knownIds.has(id)) || group.entrySkillId !== null && !group.memberIds.includes(group.entrySkillId)) throw new AppError('INVALID_IMPORT');
    groupIds.add(group.id);
    return { id: group.id, name: group.name, memberIds: [...group.memberIds], entrySkillId: group.entrySkillId, classification: importedClassification(group.classification, taxonomy) };
  });
  const ruleIds = new Set();
  const packageRules = snapshot.packageRules.map(rule => {
    if (!rule || !importPackageId.test(rule.id) || ruleIds.has(rule.id) || !['manual', 'confirmed', 'suppressed'].includes(rule.mode)) throw new AppError('INVALID_IMPORT');
    ruleIds.add(rule.id);
    if (rule.mode === 'suppressed') return { id: rule.id, mode: 'suppressed' };
    if (typeof rule.name !== 'string' || !rule.name.trim() || rule.name.length > 100) throw new AppError('INVALID_IMPORT');
    if (rule.mode === 'confirmed') return { id: rule.id, mode: 'confirmed', name: rule.name };
    if (!Array.isArray(rule.memberIds) || rule.memberIds.length < 2 || rule.memberIds.length > 5000 || new Set(rule.memberIds).size !== rule.memberIds.length || rule.memberIds.some(id => !knownIds.has(id))) throw new AppError('INVALID_IMPORT');
    return { id: rule.id, mode: 'manual', name: rule.name, memberIds: [...rule.memberIds] };
  });
  const eventIds = new Set();
  const events = snapshot.events.map(event => {
    const restored = importedEvent(event, knownIds);
    if (eventIds.has(restored.id)) throw new AppError('INVALID_IMPORT');
    eventIds.add(restored.id);
    return restored;
  });
  const next = preparedCatalog({ ...current, skills, packages, packageRules, events, taxonomy, taxonomyRevision: snapshot.taxonomyRevision }, localEntries);
  const expected = packages.map(group => [group.id, [...group.memberIds].sort()]).sort((left, right) => left[0].localeCompare(right[0]));
  const actual = next.packages.map(group => [group.id, [...group.memberIds].sort()]).sort((left, right) => left[0].localeCompare(right[0]));
  if (JSON.stringify(actual) !== JSON.stringify(expected)) throw new AppError('IMPORT_SOURCE_MISMATCH', 409);
  return next;
}

function classificationEvent(skill, classification, taxonomy) {
  return {
    id: randomUUID(), type: 'classified', skillId: skill.id, name: skill.metadata.name,
    ...(skill.entityType === 'package' ? { packageId: skill.id, entityType: 'package', memberCount: skill.memberIds.length } : {}),
    at: classification.appliedAt, path: skill.canonicalPath,
    fromCategory: taxonomy.find(category => category.id === skill.classification.categoryId)?.label ?? skill.classification.categoryId,
    toCategory: taxonomy.find(category => category.id === classification.categoryId)?.label ?? classification.categoryId,
    mode: classification.mode,
  };
}

export class CatalogStore {
  constructor(directory) {
    this.directory = directory;
    this.defaultConfigPath = path.join(directory, 'config.json');
    this.configPath = path.join(directory, 'data', 'config.local.json');
    this.introductionsPath = path.join(directory, 'data', 'introductions.local.json');
    this.dataPath = path.join(directory, 'data', 'catalog.json');
    this.pending = Promise.resolve();
    this.activeScan = null;
    this.previews = new Map();
    this.importDraft = null;
  }

  async initialize() {
    this.config = validateConfig(await readJson(this.configPath, await readJson(this.defaultConfigPath)));
    try { this.localIntroductions = validateLocalIntroductions(await readJson(this.introductionsPath, {})); }
    catch { throw new AppError('INVALID_LOCAL_INTRODUCTIONS', 500); }
    this.catalog = await readJson(this.dataPath, emptyCatalog());
    if (this.catalog.version !== 1 || !Array.isArray(this.catalog.skills) || !Array.isArray(this.catalog.events)) throw new AppError('INVALID_LOCAL_DATA', 500);
    this.catalog = preparedCatalog(this.catalog, this.localIntroductions);
    return this;
  }

  enqueue(operation) {
    const result = this.pending.then(operation);
    this.pending = result.catch(() => {});
    return result;
  }

  view() { return presentCatalog(this.catalog, this.config); }

  previewImport(values) {
    return this.enqueue(async () => {
      this.importDraft = null;
      const snapshot = values?.snapshot;
      if (snapshot?.version !== 1 || !Array.isArray(snapshot.skills) || !Array.isArray(snapshot.events) || !Array.isArray(snapshot.packages) || !Array.isArray(snapshot.taxonomy) || !Array.isArray(snapshot.configuredRoots)) throw new AppError('INVALID_IMPORT');
      const ids = new Set();
      for (const skill of snapshot.skills) {
        if (!skill || !/^[a-f0-9]{24}$/.test(skill.id) || ids.has(skill.id) || typeof skill.metadata?.name !== 'string' || typeof skill.note !== 'string' || skill.note.length > 8000 || typeof skill.customSummary !== 'string' || skill.customSummary.length > 1000) throw new AppError('INVALID_IMPORT');
        ids.add(skill.id);
      }
      if (snapshot.events.some(event => !event || typeof event.id !== 'string')) throw new AppError('INVALID_IMPORT');
      try { validateTaxonomy(snapshot.taxonomy); }
      catch { throw new AppError('INVALID_IMPORT'); }
      const currentIds = new Set(this.catalog.skills.map(skill => skill.id));
      const applicable = currentIds.size === ids.size && [...ids].every(id => currentIds.has(id));
      const summary = { version: 1, skills: snapshot.skills.length, packages: snapshot.packages.length, events: snapshot.events.length, configuredRoots: snapshot.configuredRoots.length, applicable, sourceRootsApplied: false };
      if (!applicable) return summary;
      const diskBytes = await fs.readFile(this.dataPath);
      const next = importedCatalog(snapshot, this.catalog, this.localIntroductions);
      const previewId = randomUUID();
      this.importDraft = { previewId, snapshotHash: importFingerprint(snapshot), stateHash: importFingerprint([this.catalog, this.config]), diskHash: importBytesFingerprint(diskBytes), next, expiresAt: Date.now() + 5 * 60 * 1000 };
      return { ...summary, previewId };
    });
  }

  applyImport(values) {
    return this.enqueue(async () => {
      const draft = this.importDraft;
      this.importDraft = null;
      if (!draft || draft.previewId !== values?.previewId || draft.expiresAt < Date.now() || !values.snapshot || typeof values.snapshot !== 'object' || Array.isArray(values.snapshot) || draft.snapshotHash !== importFingerprint(values.snapshot) || draft.stateHash !== importFingerprint([this.catalog, this.config])) throw new AppError('IMPORT_STALE', 409);
      const diskBytes = await fs.readFile(this.dataPath);
      if (draft.diskHash !== importBytesFingerprint(diskBytes)) throw new AppError('IMPORT_STALE', 409);
      const backupDirectory = path.join(this.directory, 'data', 'backups');
      await fs.mkdir(backupDirectory, { recursive: true, mode: 0o700 });
      const directoryStat = await fs.lstat(backupDirectory);
      if (!directoryStat.isDirectory() || directoryStat.isSymbolicLink()) throw new AppError('IMPORT_BACKUP_FAILED', 500);
      const backupPath = path.join(backupDirectory, `catalog-before-import-${randomUUID()}.json`);
      await fs.writeFile(backupPath, diskBytes, { flag: 'wx', mode: 0o600 });
      if (!(await fs.readFile(backupPath)).equals(diskBytes)) throw new AppError('IMPORT_BACKUP_FAILED', 500);
      return { ...await this.saveCatalog(draft.next, draft.diskHash), backup: `data/backups/${path.basename(backupPath)}` };
    });
  }

  async saveCatalog(next, expectedHash) {
    await atomicJson(this.dataPath, next, expectedHash);
    this.catalog = next;
    return this.view();
  }

  async persistScan() {
    const next = preparedCatalog(await scanCatalog(this.config.roots, this.catalog), this.localIntroductions);
    return this.saveCatalog(next);
  }

  scan() {
    if (this.activeScan) return this.activeScan;
    this.activeScan = this.enqueue(() => this.persistScan()).finally(() => { this.activeScan = null; });
    return this.activeScan;
  }

  updateSkill(id, values) {
    return this.enqueue(async () => {
      if (!values || typeof values.note !== 'string' || values.note.length > 8000 || typeof values.customSummary !== 'string' || values.customSummary.length > 1000) throw new AppError('INVALID_ANNOTATION');
      if (!this.catalog.skills.some(skill => skill.id === id)) throw new AppError('NOT_FOUND', 404);
      const next = {
        ...this.catalog,
        skills: this.catalog.skills.map(skill => skill.id === id ? { ...skill, note: values.note.trim(), customSummary: values.customSummary.trim() } : skill),
      };
      await atomicJson(this.dataPath, next);
      this.catalog = next;
      return this.view();
    });
  }

  updateTaxonomy(values) {
    return this.enqueue(async () => {
      if (values?.revision !== this.catalog.taxonomyRevision) throw new AppError('TAXONOMY_CONFLICT', 409);
      let taxonomy;
      try { taxonomy = validateTaxonomy(values.categories); }
      catch (error) { throw new AppError(error.message); }
      const removed = this.catalog.taxonomy.filter(category => !taxonomy.some(next => next.id === category.id));
      const migrations = values.migrations ?? {};
      if (!migrations || typeof migrations !== 'object' || Array.isArray(migrations)) throw new AppError('INVALID_MIGRATION');
      if (Object.keys(migrations).some(id => !removed.some(category => category.id === id))) throw new AppError('INVALID_MIGRATION');
      for (const category of removed) {
        const target = taxonomy.find(candidate => candidate.id === migrations[category.id]);
        if (!target) throw new AppError('MIGRATION_REQUIRED');
        if (target.id !== 'other') {
          target.keywords = [...new Set([...target.keywords, ...category.keywords])];
          target.names = [...new Set([...target.names, ...category.names])];
        }
      }
      try { taxonomy = validateTaxonomy(taxonomy); }
      catch (error) { throw new AppError(error.message); }
      const events = [];
      const appliedAt = new Date().toISOString();
      const migrate = (skill, emit = true) => {
        const target = Object.hasOwn(migrations, skill.classification.categoryId) ? migrations[skill.classification.categoryId] : null;
        if (!target) return skill;
        const classification = { ...skill.classification, categoryId: target, appliedAt };
        const event = classificationEvent(skill, classification, this.catalog.taxonomy);
        event.toCategory = taxonomy.find(category => category.id === target).label;
        if (emit) events.push(event);
        return { ...skill, classification };
      };
      const skills = this.catalog.skills.map(skill => migrate(skill, !skill.packageId));
      const packages = this.catalog.packages.map(group => ({ ...group, classification: migrate(packageSubject(group, skills)).classification }));
      return this.saveCatalog({ ...this.catalog, taxonomy, taxonomyRevision: this.catalog.taxonomyRevision + 1, skills, packages, events: [...events, ...this.catalog.events] });
    });
  }

  setSkillCategory(id, values) {
    return this.enqueue(async () => {
      const skill = this.catalog.skills.find(item => item.id === id);
      if (!skill) throw new AppError('NOT_FOUND', 404);
      if (skill.packageId) throw new AppError('PACKAGE_CATEGORY_REQUIRED', 409);
      const selected = values?.categoryId;
      if (selected !== null && !this.catalog.taxonomy.some(category => category.id === selected)) throw new AppError('INVALID_CATEGORY');
      const classification = {
        categoryId: selected ?? automaticCategory(skill, this.catalog.taxonomy),
        mode: selected === null ? 'auto' : 'manual',
        appliedAt: new Date().toISOString(),
      };
      if (skill.classification.mode === classification.mode && skill.classification.categoryId === classification.categoryId) return this.view();
      return this.saveCatalog({
        ...this.catalog,
        skills: this.catalog.skills.map(item => item.id === id ? { ...item, classification } : item),
        events: [classificationEvent(skill, classification, this.catalog.taxonomy), ...this.catalog.events],
      });
    });
  }

  updateIntroduction(id, values) {
    return this.enqueue(async () => {
      const skill = this.catalog.skills.find(item => item.id === id);
      if (!skill) throw new AppError('NOT_FOUND', 404);
      if (!values || typeof values.text !== 'string' || !values.text.trim() || values.text.length > 4000 || !/\p{Script=Han}/u.test(values.text) || typeof values.whenToUse !== 'string' || values.whenToUse.length > 2000) throw new AppError('INVALID_INTRODUCTION');
      if (values.sourceHash !== descriptionHash(skill) || values.revision !== (skill.introduction?.revision ?? 0)) throw new AppError('INTRODUCTION_CONFLICT', 409);
      const introduction = {
        text: values.text.trim(), whenToUse: values.whenToUse.trim(), source: 'manual', sourceHash: values.sourceHash,
        revision: values.revision + 1, updatedAt: new Date().toISOString(),
      };
      return this.saveCatalog({ ...this.catalog, skills: this.catalog.skills.map(item => item.id === id ? { ...item, introduction } : item) });
    });
  }

  setPackageCategory(id, values) {
    return this.enqueue(async () => {
      const group = this.catalog.packages.find(item => item.id === id);
      if (!group) throw new AppError('NOT_FOUND', 404);
      const subject = packageSubject(group, this.catalog.skills);
      const selected = values?.categoryId;
      if (selected !== null && !this.catalog.taxonomy.some(category => category.id === selected)) throw new AppError('INVALID_CATEGORY');
      const classification = { categoryId: selected ?? automaticCategory(subject, this.catalog.taxonomy), mode: selected === null ? 'auto' : 'manual', appliedAt: new Date().toISOString() };
      if (group.classification.mode === classification.mode && group.classification.categoryId === classification.categoryId) return this.view();
      return this.saveCatalog({ ...this.catalog,
        packages: this.catalog.packages.map(item => item.id === id ? { ...item, classification } : item),
        events: [classificationEvent(subject, classification, this.catalog.taxonomy), ...this.catalog.events],
      });
    });
  }

  updatePackageStructure(values) {
    return this.enqueue(async () => {
      if (values?.revision !== structureFingerprint(this.catalog)) throw new AppError('PACKAGE_STRUCTURE_CONFLICT', 409);
      if (!['confirm', 'suppress', 'create', 'edit'].includes(values.action)) throw new AppError('INVALID_PACKAGE');
      if (values.action === 'create' && values.id !== undefined) throw new AppError('INVALID_PACKAGE');
      const target = [...this.catalog.packages, ...this.catalog.packageCandidates].find(group => group.id === values.id);
      const oldRule = this.catalog.packageRules.find(rule => rule.id === values.id);
      if (values.action !== 'create' && !target) throw new AppError('NOT_FOUND', 404);
      let rule;
      if (values.action === 'confirm') {
        if (target.conflicts.length) throw new AppError('PACKAGE_MEMBERS_CONFLICT', 409);
        rule = { id: target.id, mode: 'confirmed', name: target.name };
      } else if (values.action === 'suppress') {
        rule = { id: target.id, mode: 'suppressed' };
      } else {
        if (typeof values.name !== 'string' || !values.name.trim() || values.name.trim().length > 100) throw new AppError('INVALID_PACKAGE');
        if (values.action === 'edit' && oldRule?.mode !== 'manual') {
          rule = { id: target.id, mode: 'confirmed', name: values.name.trim() };
        } else {
          if (!Array.isArray(values.memberIds) || values.memberIds.length < 2 || values.memberIds.length > 5000 || new Set(values.memberIds).size !== values.memberIds.length) throw new AppError('INVALID_PACKAGE_MEMBERS');
          for (const id of values.memberIds) {
            const skill = this.catalog.skills.find(item => item.id === id);
            if (!skill || skill.packageId && skill.packageId !== target?.id || this.catalog.packageCandidates.some(candidate => candidate.memberIds.includes(id))) throw new AppError('PACKAGE_MEMBERS_CONFLICT', 409);
          }
          rule = { id: target?.id ?? `pkg-${randomUUID().replaceAll('-', '').slice(0, 24)}`, mode: 'manual', name: values.name.trim(), memberIds: [...values.memberIds].sort() };
        }
      }
      const rules = [...this.catalog.packageRules.filter(item => item.id !== rule.id), rule];
      const skills = this.catalog.skills.map(skill => {
        if (target && skill.packageId === target.id && (rule.mode === 'suppressed' || rule.mode === 'manual' && !rule.memberIds.includes(skill.id))) return { ...skill, classification: target.classification };
        return skill;
      });
      const next = preparedCatalog({ ...this.catalog, skills, packageRules: rules }, this.localIntroductions);
      if (rule.mode !== 'suppressed' && !next.packages.some(group => group.id === rule.id)) throw new AppError('PACKAGE_MEMBERS_CONFLICT', 409);
      const event = { id: randomUUID(), type: 'packaged', entityType: 'package', packageId: rule.id, skillId: rule.id, name: rule.name ?? target.name, action: values.action, at: new Date().toISOString(), path: target?.canonicalPath ?? null };
      return this.saveCatalog({ ...next, events: [event, ...this.catalog.events] });
    });
  }

  classificationFingerprint() {
    const state = {
      taxonomy: this.catalog.taxonomy, revision: this.catalog.taxonomyRevision,
      skills: this.catalog.skills.map(skill => [skill.id, skill.hash, skill.metadata.name, skill.metadata.description, skill.status, skill.classification]),
      structure: structureFingerprint(this.catalog),
      packages: this.catalog.packages.map(group => [group.id, group.classification]),
    };
    return createHash('sha256').update(JSON.stringify(state)).digest('hex');
  }

  previewReclassification(values) {
    return this.enqueue(async () => {
      if (typeof values?.includeManual !== 'boolean') throw new AppError('INVALID_PREVIEW');
      for (const [id, preview] of this.previews) if (preview.expiresAt < Date.now()) this.previews.delete(id);
      if (this.previews.size >= 20) this.previews.delete(this.previews.keys().next().value);
      const units = classificationUnits(this.catalog);
      const plan = { ...planReclassification(units, this.catalog.taxonomy, values.includeManual), packageCount: this.catalog.packages.length, standaloneCount: units.length - this.catalog.packages.length };
      const preview = { ...plan, id: randomUUID(), fingerprint: this.classificationFingerprint(), expiresAt: Date.now() + 5 * 60 * 1000 };
      this.previews.set(preview.id, preview);
      return { id: preview.id, expiresAt: new Date(preview.expiresAt).toISOString(), ...plan };
    });
  }

  applyReclassification(values) {
    return this.enqueue(async () => {
      const preview = this.previews.get(values?.previewId);
      if (!preview) throw new AppError('PREVIEW_EXPIRED', 409);
      this.previews.delete(preview.id);
      if (preview.expiresAt < Date.now() || preview.fingerprint !== this.classificationFingerprint()) throw new AppError('PREVIEW_STALE', 409);
      if (!preview.changes.length) return this.view();
      const changes = new Map(preview.changes.map(change => [change.skillId, change]));
      const events = [];
      const appliedAt = new Date().toISOString();
      const apply = skill => {
        const change = changes.get(skill.id);
        if (!change) return skill;
        const classification = { categoryId: change.toCategory, mode: 'auto', appliedAt };
        events.push(classificationEvent(skill, classification, this.catalog.taxonomy));
        return { ...skill, classification };
      };
      const skills = this.catalog.skills.map(skill => skill.packageId ? skill : apply(skill));
      const packages = this.catalog.packages.map(group => ({ ...group, classification: apply(packageSubject(group, skills)).classification }));
      return this.saveCatalog({ ...this.catalog, skills, packages, events: [...events, ...this.catalog.events] });
    });
  }

  addRoot(values) {
    return this.enqueue(async () => {
      if (!values || typeof values.label !== 'string' || !values.label.trim() || values.label.length > 100 || !['personal', 'shared', 'project', 'builtin'].includes(values.kind)) throw new AppError('INVALID_SOURCE');
      if (this.config.roots.length >= 50) throw new AppError('SOURCE_LIMIT');
      const resolved = validatePath(values.path);
      if (this.config.roots.some(root => expandPath(root.path).toLowerCase() === resolved.toLowerCase())) throw new AppError('SOURCE_EXISTS');
      try { if (!(await fs.stat(resolved)).isDirectory()) throw new Error('NOT_DIRECTORY'); }
      catch { throw new AppError('SOURCE_UNAVAILABLE'); }
      const root = { id: randomUUID(), label: values.label.trim(), path: resolved, kind: values.kind, enabled: true };
      const next = { ...this.config, roots: [...this.config.roots, root] };
      await atomicJson(this.configPath, next);
      this.config = next;
      return this.persistScan();
    });
  }

  updateRoot(id, values) {
    return this.enqueue(async () => {
      if (typeof values?.enabled !== 'boolean') throw new AppError('INVALID_SOURCE');
      if (!this.config.roots.some(root => root.id === id)) throw new AppError('NOT_FOUND', 404);
      const next = { ...this.config, roots: this.config.roots.map(root => root.id === id ? { ...root, enabled: values.enabled } : root) };
      await atomicJson(this.configPath, next);
      this.config = next;
      return this.persistScan();
    });
  }

  updateSettings(values) {
    return this.enqueue(async () => {
      if (typeof values?.autoScan !== 'boolean') throw new AppError('INVALID_SETTINGS');
      const next = { ...this.config, settings: { autoScan: values.autoScan, intervalMinutes: 5 } };
      await atomicJson(this.configPath, next);
      this.config = next;
      return this.view();
    });
  }

  async candidates() {
    const known = [
      ['Shared / Agents', '~/.agents/skills', 'shared'],
      ['GitHub Copilot', '~/.copilot/skills', 'personal'],
      ['Claude Code', '~/.claude/skills', 'personal'],
      ['Codex', '~/.codex/skills', 'personal'],
      ['Cursor', '~/.cursor/skills', 'personal'],
    ];
    const existing = new Set(this.config.roots.map(root => expandPath(root.path).toLowerCase()));
    const results = [];
    for (const [label, candidatePath, kind] of known) {
      const resolved = expandPath(candidatePath);
      if (existing.has(resolved.toLowerCase())) continue;
      try {
        if ((await fs.stat(resolved)).isDirectory()) results.push({ label, path: resolved, kind });
      } catch {}
    }
    return results;
  }
}
