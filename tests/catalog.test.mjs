import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { parseSkill, scanCatalog, LIMITS } from '../src/catalog.mjs';

const document = (name = 'example', description = 'A useful local skill.') => `---\nname: ${name}\ndescription: ${description}\n---\n\n# Instructions\n`;

async function fixture(context) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'skill-atlas-test-'));
  context.after(() => fs.rm(directory, { recursive: true, force: true }));
  const rootPath = path.join(directory, 'skills');
  await fs.mkdir(rootPath);
  return { directory, rootPath, roots: [{ id: 'test', label: 'Test', path: rootPath, enabled: true }] };
}

async function writeSkill(rootPath, folder, content = document()) {
  const directory = path.join(rootPath, folder);
  await fs.mkdir(directory, { recursive: true });
  const entry = path.join(directory, 'SKILL.md');
  await fs.writeFile(entry, content, 'utf8');
  return entry;
}

test('frontmatter supports multiline YAML and invocation flags', () => {
  const result = parseSkill('---\r\nname: example\r\ndescription: >-\r\n  First line\r\n  second line\r\nuser-invocable: false\r\nmetadata:\r\n  version: "2.1"\r\n---\r\n# Body', 'fallback');
  assert.equal(result.name, 'example');
  assert.equal(result.description, 'First line second line');
  assert.equal(result.version, '2.1');
  assert.equal(result.userInvocable, false);
  assert.equal(result.modelInvocable, true);
  assert.equal(result.parseError, null);
});

test('frontmatter budget does not reject a valid header with a long body', () => {
  assert.equal(parseSkill(document() + 'body '.repeat(30000), 'fallback').parseError, null);
  const oversized = `---\nname: example\ndescription: ${'a'.repeat(LIMITS.headerBytes)}\n---\n`;
  assert.equal(parseSkill(oversized, 'fallback').parseError, 'FRONTMATTER_TOO_LARGE');
});

test('malformed, duplicate-key and aliased YAML never leaks source text', () => {
  for (const header of ['description: [broken', 'name: one\nname: two', 'name: &name example\ndescription: *name']) {
    const result = parseSkill(`---\n${header}\n---\n`, 'fallback');
    assert.equal(result.parseError, 'INVALID_FRONTMATTER');
    assert.equal(result.name, 'fallback');
    assert.equal(result.description, '');
  }
});

test('nested skills are found while scripts and ignored folders are not executed', async context => {
  const setup = await fixture(context);
  await writeSkill(setup.rootPath, 'collection/nested');
  await writeSkill(setup.rootPath, 'node_modules/ignored', document('ignored'));
  await fs.writeFile(path.join(setup.rootPath, 'collection', 'evil.mjs'), 'throw new Error("must not run")');
  const result = await scanCatalog(setup.roots);
  assert.equal(result.skills.length, 1);
  assert.equal(result.skills[0].metadata.name, 'example');
  assert.equal(result.roots[0].status, 'ok');
});

test('incremental changes, missing and restored records retain annotations', async context => {
  const setup = await fixture(context);
  const entry = await writeSkill(setup.rootPath, 'example');
  const first = await scanCatalog(setup.roots);
  assert.equal(first.lastScan.counts.added, 1);
  first.skills[0].note = 'Keep my note';
  first.skills[0].customSummary = 'My summary';
  const same = await scanCatalog(setup.roots, first);
  assert.equal(same.events.length, 1);
  assert.equal(same.lastScan.counts.unchanged, 1);
  await fs.writeFile(entry, document('example', 'Changed description'));
  const updated = await scanCatalog(setup.roots, same);
  assert.equal(updated.lastScan.counts.updated, 1);
  assert.equal(updated.skills[0].note, 'Keep my note');
  assert.equal(updated.skills[0].customSummary, 'My summary');
  assert.equal(updated.skills[0].firstSeen, first.skills[0].firstSeen);
  await fs.unlink(entry);
  const missing = await scanCatalog(setup.roots, updated);
  assert.equal(missing.lastScan.counts.missing, 1);
  assert.equal(missing.skills[0].status, 'missing');
  const missingAgain = await scanCatalog(setup.roots, missing);
  assert.equal(missingAgain.lastScan.counts.missing, 0);
  await writeSkill(setup.rootPath, 'example');
  const restored = await scanCatalog(setup.roots, missingAgain);
  assert.equal(restored.lastScan.counts.restored, 1);
  assert.equal(restored.skills[0].note, 'Keep my note');
});

test('an unavailable or disabled source never creates false removals', async context => {
  const setup = await fixture(context);
  await writeSkill(setup.rootPath, 'example');
  const first = await scanCatalog(setup.roots);
  await fs.rename(setup.rootPath, `${setup.rootPath}-offline`);
  const unavailable = await scanCatalog(setup.roots, first);
  assert.equal(unavailable.roots[0].status, 'unavailable');
  assert.equal(unavailable.skills[0].status, 'unknown');
  assert.equal(unavailable.lastScan.counts.missing, 0);
  const disabled = await scanCatalog(setup.roots.map(root => ({ ...root, enabled: false })), first);
  assert.equal(disabled.skills[0].status, 'unknown');
  assert.equal(disabled.events.length, 1);
});

test('a newly installed skill adds exactly one event to an existing source', async context => {
  const setup = await fixture(context);
  await writeSkill(setup.rootPath, 'existing', document('existing'));
  const baseline = await scanCatalog(setup.roots);
  await writeSkill(setup.rootPath, 'collection/new-skill', document('new-skill', 'Newly installed skill'));
  const increment = await scanCatalog(setup.roots, baseline);
  assert.equal(increment.skills.length, 2);
  assert.equal(increment.lastScan.counts.added, 1);
  assert.equal(increment.lastScan.counts.unchanged, 1);
  assert.equal(increment.events.length, 2);
  assert.equal(increment.events[0].name, 'new-skill');
  const repeat = await scanCatalog(setup.roots, increment);
  assert.equal(repeat.lastScan.counts.added, 0);
  assert.equal(repeat.lastScan.counts.unchanged, 2);
  assert.equal(repeat.events.length, 2);
});

test('partial scans retain unseen records without claiming deletion', async context => {
  const setup = await fixture(context);
  const entry = await writeSkill(setup.rootPath, 'example');
  const first = await scanCatalog(setup.roots);
  await fs.unlink(entry);
  await writeSkill(setup.rootPath, 'broken', '---\ndescription: [broken\n---\n');
  const partial = await scanCatalog(setup.roots, first);
  assert.equal(partial.roots[0].status, 'partial');
  assert.equal(partial.skills.find(skill => skill.metadata.name === 'example').status, 'unknown');
  assert.equal(partial.lastScan.counts.missing, 0);
  assert.equal(partial.roots[0].issues[0].code, 'INVALID_FRONTMATTER');
});

test('junctions deduplicate physical skills across roots and stop cycles', async context => {
  const setup = await fixture(context);
  await writeSkill(setup.rootPath, 'example');
  const alias = path.join(setup.directory, 'linked-skills');
  await fs.symlink(setup.rootPath, alias, process.platform === 'win32' ? 'junction' : 'dir');
  await fs.symlink(setup.rootPath, path.join(setup.rootPath, 'loop'), process.platform === 'win32' ? 'junction' : 'dir');
  const result = await scanCatalog([...setup.roots, { id: 'alias', label: 'Alias', path: alias }]);
  assert.equal(result.skills.length, 1);
  assert.equal(result.skills[0].locations.length, 2);
  assert.deepEqual(result.roots.map(root => root.count), [1, 1]);
  assert.equal(result.lastScan.counts.added, 1);
});

test('same-name copies remain distinct physical installations', async context => {
  const setup = await fixture(context);
  await writeSkill(setup.rootPath, 'first');
  await writeSkill(setup.rootPath, 'second');
  const result = await scanCatalog(setup.roots);
  assert.equal(result.skills.length, 2);
  assert.notEqual(result.skills[0].id, result.skills[1].id);
});

test('multiple links within one root retain every installation location', async context => {
  const setup = await fixture(context);
  const entry = await writeSkill(setup.rootPath, 'original');
  await fs.symlink(path.dirname(entry), path.join(setup.rootPath, 'alias'), process.platform === 'win32' ? 'junction' : 'dir');
  const result = await scanCatalog(setup.roots);
  assert.equal(result.skills.length, 1);
  assert.equal(result.skills[0].locations.length, 2);
  assert.equal(result.roots[0].count, 1);
});

test('oversized entries are bounded and reported without reading their body', async context => {
  const setup = await fixture(context);
  await writeSkill(setup.rootPath, 'large', document() + 'x'.repeat(LIMITS.fileBytes));
  const result = await scanCatalog(setup.roots);
  assert.equal(result.skills.length, 0);
  assert.equal(result.roots[0].status, 'partial');
  assert.equal(result.roots[0].issues[0].code, 'FILE_TOO_LARGE');
});

test('a main entry and nested skills form one package with parent relationships', async context => {
  const setup = await fixture(context);
  await writeSkill(setup.rootPath, 'bundle', document('bundle'));
  await writeSkill(setup.rootPath, 'bundle/skills/search', document('search'));
  await writeSkill(setup.rootPath, 'bundle/skills/publish', document('publish'));
  const result = await scanCatalog(setup.roots);
  assert.equal(result.packages.length, 1);
  assert.equal(result.packages[0].kind, 'bundle');
  assert.equal(result.packages[0].memberIds.length, 3);
  const main = result.skills.find(skill => skill.metadata.name === 'bundle');
  assert.equal(result.packages[0].entrySkillId, main.id);
  assert.equal(main.parentSkillId, null);
  for (const child of result.skills.filter(skill => skill.id !== main.id)) {
    assert.equal(child.packageId, main.packageId);
    assert.equal(child.parentSkillId, main.id);
  }
});

test('a collection has no invented callable entry and source roots never become packages', async context => {
  const setup = await fixture(context);
  await writeSkill(setup.rootPath, 'collection/review', document('review'));
  await writeSkill(setup.rootPath, 'collection/plan', document('plan'));
  await writeSkill(setup.rootPath, 'standalone-a', document('shared-a'));
  await writeSkill(setup.rootPath, 'standalone-b', document('shared-b'));
  const result = await scanCatalog(setup.roots);
  assert.equal(result.packages.length, 1);
  assert.equal(result.packages[0].name, 'collection');
  assert.equal(result.packages[0].entrySkillId, null);
  assert.equal(result.skills.filter(skill => !skill.packageId).length, 2);
  assert.equal(result.packageCandidates.length, 0);
});

test('confirmed packages absorb new members and retain structure across unavailable scans', async context => {
  const setup = await fixture(context);
  await writeSkill(setup.rootPath, 'bundle', document('bundle'));
  await writeSkill(setup.rootPath, 'bundle/skills/first', document('first'));
  const baseline = await scanCatalog(setup.roots);
  await writeSkill(setup.rootPath, 'bundle/skills/second', document('second'));
  const increment = await scanCatalog(setup.roots, baseline);
  assert.equal(increment.packages[0].id, baseline.packages[0].id);
  assert.equal(increment.packages[0].memberIds.length, 3);
  assert.equal(increment.lastScan.counts.added, 1);
  await fs.rename(setup.rootPath, `${setup.rootPath}-offline`);
  const unavailable = await scanCatalog(setup.roots, increment);
  assert.equal(unavailable.packages.length, 1);
  assert.equal(unavailable.packages[0].memberIds.length, 3);
  assert.equal(unavailable.packages[0].status, 'unknown');
  assert.equal(unavailable.lastScan.counts.missing, 0);
});

test('package junction aliases deduplicate while same-name directory copies remain independent', async context => {
  const setup = await fixture(context);
  await writeSkill(setup.rootPath, 'collection/first', document('first'));
  await writeSkill(setup.rootPath, 'collection/second', document('second'));
  await fs.symlink(path.join(setup.rootPath, 'collection'), path.join(setup.rootPath, 'alias'), process.platform === 'win32' ? 'junction' : 'dir');
  const result = await scanCatalog(setup.roots);
  assert.equal(result.packages.length, 1);
  assert.equal(result.packages[0].memberIds.length, 2);
  assert.equal(result.packages[0].locations.length, 2);
  assert.equal(result.skills.length, 2);
});

test('ambiguous nested collections require confirmation and can remain independent', async context => {
  const setup = await fixture(context);
  await writeSkill(setup.rootPath, 'uncertain/topic/first', document('first'));
  await writeSkill(setup.rootPath, 'uncertain/topic/second', document('second'));
  const first = await scanCatalog(setup.roots);
  assert.equal(first.packages.length, 0);
  assert.equal(first.packageCandidates.length, 1);
  const id = first.packageCandidates[0].id;
  const confirmed = await scanCatalog(setup.roots, { ...first, packageRules: [{ id, mode: 'confirmed' }] });
  assert.equal(confirmed.packages.length, 1);
  const independent = await scanCatalog(setup.roots, { ...confirmed, packageRules: [{ id, mode: 'suppressed' }] });
  assert.equal(independent.packages.length, 0);
  assert.equal(independent.packageCandidates.length, 0);
  assert.equal(independent.skills.filter(skill => !skill.packageId).length, 2);
});

test('an overlapping source candidate cannot split an already established package', async context => {
  const setup = await fixture(context);
  await writeSkill(setup.rootPath, 'bundle', document('bundle'));
  await writeSkill(setup.rootPath, 'bundle/skills/child', document('child'));
  const original = await scanCatalog(setup.roots);
  const extraRoot = path.join(setup.directory, 'extra');
  const wrapper = path.join(extraRoot, 'wrapper', 'nested');
  await fs.mkdir(wrapper, { recursive: true });
  await fs.symlink(path.join(setup.rootPath, 'bundle'), path.join(wrapper, 'alias'), process.platform === 'win32' ? 'junction' : 'dir');
  const updated = await scanCatalog([...setup.roots, { id: 'extra', label: 'Extra', path: extraRoot }], original);
  assert.equal(updated.packages.length, 1);
  assert.equal(updated.packages[0].id, original.packages[0].id);
  assert.equal(updated.skills.every(skill => skill.packageId === original.packages[0].id), true);
  assert.equal(updated.packageCandidates.length, 1);
  assert.equal(updated.packageCandidates[0].conflicts.length, 2);
});
