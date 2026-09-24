import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { request as httpRequest } from 'node:http';
import { fileURLToPath } from 'node:url';
import { CatalogStore, acquireCatalogLock } from '../src/store.mjs';
import { createApp } from '../src/http.mjs';
import { validateTaxonomy, automaticCategory, appliedClassification, planReclassification } from '../src/classification.mjs';
import { createDefaultTaxonomy } from '../src/presentation.mjs';
import { renderMarkdown } from '../src/markdown.mjs';

const project = path.dirname(path.dirname(fileURLToPath(import.meta.url)));

test('Markdown preview renders headings, GFM tables, tasks, quotes and escaped code', () => {
  const source = '# Title\n\n**Bold** and *italic* and ~~removed~~.\n\n- one\n- two\n\n1. first\n2. second\n\n> Quote\n\n| Name | Value |\n| --- | --- |\n| one | two |\n\n- [x] Done\n- [ ] Todo\n\n```js\nconst value = "<script>never execute</script>";\n```\n';
  const html = renderMarkdown(source);
  for (const tag of ['h1', 'strong', 'em', 'del', 'ul', 'ol', 'blockquote', 'table', 'th', 'td', 'pre', 'code']) assert.match(html, new RegExp(`<${tag}(?:>|\\s)`), tag);
  assert.match(html, /id="md-title"/);
  assert.match(html, /type="checkbox" disabled/);
  assert.match(html, /checked/);
  assert.match(html, /class="language-js"/);
  assert.match(html, /&lt;script&gt;never execute&lt;\/script&gt;/);
  assert.doesNotMatch(html, /<script>/);
});

test('Markdown frontmatter stays readable without becoming a heading and raw source remains unchanged', () => {
  const source = '\uFEFF---\r\nname: demo\r\ndescription: "<unsafe>"\r\n---\r\n# Body\r\n';
  const original = source;
  const html = renderMarkdown(source);
  assert.match(html, /<details class="markdown-metadata">/);
  assert.match(html, /<summary>YAML<\/summary>/);
  assert.match(html, /name: demo/);
  assert.match(html, /&lt;unsafe&gt;/);
  assert.match(html, /<h1 id="md-body">Body<\/h1>/);
  assert.equal(source, original);
  assert.equal(renderMarkdown(''), '');
});

test('untrusted Markdown cannot run scripts, inject controls, load images or navigate unsafe URLs', () => {
  const source = '<script>alert(1)</script>\n<iframe src="https://example.com"></iframe>\n<form><button data-view="sources">run</button></form>\n<input type="text" value="secret"><input type="checkbox" onclick="alert(1)">\n<svg onload="alert(1)"></svg>\n<p style="color:red" onmouseover="alert(1)">safe</p>\n\n[unsafe](javascript:alert(1)) [encoded](jav&#x61;script:alert(1)) [file](file:///secret) [relative](./references/demo.md) [api](/api/catalog)\n\n[web](https://example.com/docs) [anchor](#section)\n\n![diagram](https://example.com/tracker.png)\n<img src="/api/catalog" onerror="alert(1)" alt="local-image">\n\n# Section\n# Section\n';
  const html = renderMarkdown(source);
  assert.doesNotMatch(html, /<(script|iframe|form|button|svg|img)\b/i);
  assert.doesNotMatch(html, /\s(?:src|on\w+|style|data-view)=/i);
  assert.doesNotMatch(html, /href="(?:javascript:|file:|\.\/|\/api)/i);
  assert.doesNotMatch(html, /type="text"/);
  assert.match(html, /type="checkbox" disabled/);
  assert.match(html, /href="https:\/\/example.com\/docs"[^>]*target="_blank"[^>]*rel="noopener noreferrer"/);
  assert.match(html, /href="#md-section"/);
  assert.match(html, /id="md-section-1"/);
  assert.match(html, /href="https:\/\/example.com\/tracker.png"/);
  assert.match(html, />diagram<\/a>/);
  assert.match(html, /local-image/);
});

test('editable exact-name rules take precedence and manual assignments survive new rules', () => {
  const taxonomy = validateTaxonomy(createDefaultTaxonomy());
  const skill = { id: 'example', metadata: { name: 'archify', description: 'Architecture diagrams with test workflows.' } };
  assert.equal(automaticCategory(skill, taxonomy), 'design');
  taxonomy.find(category => category.id === 'design').names = [];
  taxonomy.find(category => category.id === 'research').names.push('archify');
  assert.equal(automaticCategory(skill, taxonomy), 'research');
  skill.classification = { categoryId: 'writing', mode: 'manual' };
  assert.equal(appliedClassification(skill, taxonomy).categoryId, 'writing');
  assert.equal(planReclassification([skill], taxonomy).preservedManual, 1);
  assert.equal(planReclassification([skill], taxonomy).changes.length, 0);
  assert.deepEqual(planReclassification([skill], taxonomy, true).changes[0], { skillId: 'example', name: 'archify', fromCategory: 'writing', toCategory: 'research', wasManual: true });
});

test('keyword priority is editable and taxonomy validation preserves the fallback', () => {
  const taxonomy = createDefaultTaxonomy();
  const skill = { metadata: { name: 'new-tool', description: 'Test and research workflows' } };
  assert.equal(automaticCategory(skill, taxonomy), 'testing');
  const research = taxonomy.splice(taxonomy.findIndex(category => category.id === 'research'), 1)[0];
  taxonomy.unshift(research);
  assert.equal(automaticCategory(skill, validateTaxonomy(taxonomy)), 'research');
  assert.equal(automaticCategory({ metadata: { name: 'unknown', description: '' } }, taxonomy), 'other');
  assert.throws(() => validateTaxonomy(taxonomy.filter(category => category.id !== 'other')), /FALLBACK_CATEGORY_REQUIRED/);
  const duplicate = createDefaultTaxonomy();
  duplicate[0].names.push('archify');
  assert.throws(() => validateTaxonomy(duplicate), /DUPLICATE_NAME_RULE/);
  assert.throws(() => validateTaxonomy([{ id: 'other', label: 'Fallback', icon: 'untrusted-icon', keywords: [], names: [] }]), /INVALID_CATEGORY/);
});

async function fixture(context) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'skill-atlas-app-'));
  context.after(() => fs.rm(directory, { recursive: true, force: true }));
  const rootPath = path.join(directory, 'skills');
  await fs.mkdir(path.join(rootPath, 'archify'), { recursive: true });
  await fs.writeFile(path.join(rootPath, 'archify', 'SKILL.md'), '---\nname: archify\ndescription: Architecture diagrams.\n---\n# Inert document\n<script>alert(1)</script>\n');
  await fs.writeFile(path.join(directory, 'config.json'), JSON.stringify({ roots: [{ id: 'test', label: 'Test', path: rootPath, kind: 'shared', enabled: true }] }));
  const store = await new CatalogStore(directory).initialize();
  await store.scan();
  return { directory, store, rootPath };
}

test('personal configuration writes stay outside the public defaults and survive restart', async context => {
  const { directory, store } = await fixture(context);
  const defaults = await fs.readFile(store.defaultConfigPath, 'utf8');
  const extra = path.join(directory, 'personal-skills');
  await fs.mkdir(extra);
  await store.addRoot({ label: 'Personal', path: extra, kind: 'personal' });
  await store.updateSettings({ autoScan: false });
  await store.updateRoot('test', { enabled: false });
  assert.equal(await fs.readFile(store.defaultConfigPath, 'utf8'), defaults);
  assert.equal(store.configPath, path.join(directory, 'data', 'config.local.json'));
  const saved = JSON.parse(await fs.readFile(store.configPath, 'utf8'));
  assert.equal(saved.roots.find(root => root.label === 'Personal').path, extra);
  assert.equal(saved.roots.find(root => root.id === 'test').enabled, false);
  const restarted = await new CatalogStore(directory).initialize();
  assert.equal(restarted.config.settings.autoScan, false);
  assert.equal(restarted.config.roots.length, 2);
  assert.equal(restarted.config.roots.find(root => root.id === 'test').enabled, false);
});

test('invalid private configuration is rejected without falling back or overwriting it', async context => {
  const { directory, store } = await fixture(context);
  for (const content of ['{broken', 'null', '{"roots":false}']) {
    await fs.writeFile(store.configPath, content, 'utf8');
    await assert.rejects(new CatalogStore(directory).initialize(), error => ['INVALID_LOCAL_DATA', 'INVALID_CONFIG'].includes(error.code));
    assert.equal(await fs.readFile(store.configPath, 'utf8'), content);
  }
});

test('private introduction extensions seed only missing descriptions and never overwrite edits', async context => {
  const { directory, store, rootPath } = await fixture(context);
  const extension = { 'local-helper': { text: '本地扩展用途。', whenToUse: '处理本地任务时。' } };
  await fs.writeFile(store.introductionsPath, JSON.stringify(extension), 'utf8');
  await fs.mkdir(path.join(rootPath, 'local-helper'));
  await fs.writeFile(path.join(rootPath, 'local-helper', 'SKILL.md'), '---\nname: local-helper\ndescription: A private local helper.\n---\n');
  const withExtension = await new CatalogStore(directory).initialize();
  const first = await withExtension.scan();
  const skill = first.skills.find(item => item.metadata.name === 'local-helper');
  assert.equal(skill.summary, extension['local-helper'].text);
  assert.equal(skill.summarySource, 'local');
  await withExtension.updateIntroduction(skill.id, { text: '人工保留的修订。', whenToUse: '', sourceHash: skill.descriptionHash, revision: skill.introduction.revision });
  await fs.writeFile(store.introductionsPath, JSON.stringify({ 'local-helper': { text: '新词条', whenToUse: '' } }));
  const restarted = await new CatalogStore(directory).initialize();
  assert.equal((await restarted.scan()).skills.find(item => item.id === skill.id).introduction.text, '人工保留的修订。');
  await fs.writeFile(store.introductionsPath, JSON.stringify({ 'local-helper': { text: 1 } }));
  await assert.rejects(new CatalogStore(directory).initialize(), { code: 'INVALID_LOCAL_INTRODUCTIONS' });
});

test('persisted catalog, local summaries and history survive restart and rescans', async context => {
  const { directory, store } = await fixture(context);
  const id = store.catalog.skills[0].id;
  await store.updateSkill(id, { note: 'Personal note', customSummary: 'Personal summary' });
  const restarted = await new CatalogStore(directory).initialize();
  const result = await restarted.scan();
  assert.equal(result.skills[0].summary, 'Personal summary');
  assert.equal(result.skills[0].note, 'Personal note');
  assert.equal(result.skills[0].summarySource, 'custom');
  assert.equal(result.events.length, 1);
  assert.equal(result.lastScan.counts.unchanged, 1);
});

test('concurrent scans coalesce and annotation writes are serialized', async context => {
  const { store } = await fixture(context);
  const firstScan = store.scan();
  const secondScan = store.scan();
  assert.equal(firstScan, secondScan);
  await Promise.all([firstScan, store.updateSkill(store.catalog.skills[0].id, { note: 'Not lost', customSummary: '' }), secondScan]);
  assert.equal(store.catalog.skills[0].note, 'Not lost');
  assert.equal(store.catalog.events.length, 1);
});

test('classification rules persist without changing assignments until an approved preview is applied', async context => {
  const { directory, store } = await fixture(context);
  const id = store.catalog.skills[0].id;
  const taxonomy = structuredClone(store.view().categories);
  taxonomy.find(category => category.id === 'design').names = [];
  taxonomy.find(category => category.id === 'research').names.push('archify');
  await store.updateSkill(id, { note: 'Keep me', customSummary: 'Keep this summary' });
  await store.updateTaxonomy({ revision: 1, categories: taxonomy });
  assert.equal(store.view().skills[0].category, 'design');
  assert.equal(store.view().skills[0].classificationPending, true);
  const preview = await store.previewReclassification({ includeManual: false });
  assert.equal(preview.changes.length, 1);
  assert.equal(store.view().skills[0].category, 'design');
  await store.scan();
  const applied = await store.applyReclassification({ previewId: preview.id });
  assert.equal(applied.skills[0].category, 'research');
  assert.equal(applied.skills[0].note, 'Keep me');
  assert.equal(applied.skills[0].customSummary, 'Keep this summary');
  assert.equal(applied.events[0].type, 'classified');
  await assert.rejects(store.applyReclassification({ previewId: preview.id }), { code: 'PREVIEW_EXPIRED' });
  const restarted = await new CatalogStore(directory).initialize();
  assert.equal(restarted.view().skills[0].category, 'research');
  assert.equal(restarted.catalog.taxonomyRevision, 2);
});

test('manual correction survives scans and batch operations and can return to automatic', async context => {
  const { store } = await fixture(context);
  const id = store.catalog.skills[0].id;
  await store.setSkillCategory(id, { categoryId: 'writing' });
  await store.scan();
  assert.equal(store.view().skills[0].category, 'writing');
  assert.equal(store.view().skills[0].categoryMode, 'manual');
  const preserved = await store.previewReclassification({ includeManual: false });
  assert.equal(preserved.preservedManual, 1);
  assert.equal(preserved.changes.length, 0);
  const reset = await store.previewReclassification({ includeManual: true });
  assert.equal(reset.changes[0].wasManual, true);
  await store.applyReclassification({ previewId: reset.id });
  assert.equal(store.view().skills[0].category, 'design');
  assert.equal(store.view().skills[0].categoryMode, 'auto');
  await store.setSkillCategory(id, { categoryId: 'research' });
  await store.setSkillCategory(id, { categoryId: null });
  assert.equal(store.view().skills[0].categoryMode, 'auto');
  assert.equal(store.view().skills[0].category, 'design');
  await assert.rejects(store.setSkillCategory(id, { categoryId: 'missing' }), { code: 'INVALID_CATEGORY' });
});

test('stale previews reject rule, assignment, content and expiry changes', async context => {
  const { store, rootPath } = await fixture(context);
  const id = store.catalog.skills[0].id;
  for (const mutate of [
    () => store.updateTaxonomy({ revision: store.catalog.taxonomyRevision, categories: store.view().categories }),
    () => store.setSkillCategory(id, { categoryId: 'writing' }),
    async () => { await fs.appendFile(path.join(rootPath, 'archify', 'SKILL.md'), '\nChanged'); await store.scan(); },
  ]) {
    const preview = await store.previewReclassification({ includeManual: true });
    await mutate();
    await assert.rejects(store.applyReclassification({ previewId: preview.id }), { code: 'PREVIEW_STALE' });
  }
  const expired = await store.previewReclassification({ includeManual: true });
  store.previews.get(expired.id).expiresAt = 0;
  await assert.rejects(store.applyReclassification({ previewId: expired.id }), { code: 'PREVIEW_STALE' });
});

test('category creation, rename, reorder and merge preserve manual mode and require explicit migration', async context => {
  const { store } = await fixture(context);
  const id = store.catalog.skills[0].id;
  const taxonomy = structuredClone(store.view().categories);
  taxonomy.unshift({ id: 'custom', label: 'Custom', icon: 'tag', keywords: ['custom'], names: [] });
  taxonomy.find(category => category.id === 'design').label = 'Diagrams';
  const created = await store.updateTaxonomy({ revision: 1, categories: taxonomy });
  assert.equal(created.categories[0].id, 'custom');
  assert.equal(created.categories.find(category => category.id === 'design').label, 'Diagrams');
  await store.setSkillCategory(id, { categoryId: 'custom' });
  const merged = taxonomy.filter(category => category.id !== 'custom');
  await assert.rejects(store.updateTaxonomy({ revision: 2, categories: merged }), { code: 'MIGRATION_REQUIRED' });
  assert.equal(store.catalog.taxonomyRevision, 2);
  const migrated = await store.updateTaxonomy({ revision: 2, categories: merged, migrations: { custom: 'writing' } });
  assert.equal(migrated.skills[0].category, 'writing');
  assert.equal(migrated.skills[0].categoryMode, 'manual');
  assert.equal(migrated.categories.find(category => category.id === 'writing').keywords.includes('custom'), true);
  await assert.rejects(store.updateTaxonomy({ revision: 1, categories: merged }), { code: 'TAXONOMY_CONFLICT' });
  assert.equal(store.catalog.taxonomyRevision, 3);
});

test('invalid local data fails closed without overwriting the catalog', async context => {
  const { directory, store } = await fixture(context);
  await fs.writeFile(store.dataPath, '{invalid');
  await assert.rejects(new CatalogStore(directory).initialize(), { code: 'INVALID_LOCAL_DATA' });
  assert.equal(await fs.readFile(store.dataPath, 'utf8'), '{invalid');
});

test('Chinese introductions persist independently and become stale only when the description changes', async context => {
  const { store, directory, rootPath } = await fixture(context);
  const original = store.view().skills[0];
  assert.match(original.introduction.text, /图/);
  await store.updateSkill(original.id, { note: 'Keep note', customSummary: 'Personal display summary' });
  const values = { text: '绘制架构与流程关系图。', whenToUse: '需要可视化架构时。', sourceHash: original.descriptionHash, revision: original.introduction.revision };
  await store.updateIntroduction(original.id, values);
  await assert.rejects(store.updateIntroduction(original.id, values), { code: 'INTRODUCTION_CONFLICT' });
  await fs.appendFile(path.join(rootPath, 'archify', 'SKILL.md'), '\nBody only');
  await store.scan();
  assert.equal(store.view().skills[0].introduction.stale, false);
  await fs.writeFile(path.join(rootPath, 'archify', 'SKILL.md'), '---\nname: archify\ndescription: Changed architecture description.\n---\n');
  await store.scan();
  const stale = store.view().skills[0];
  assert.equal(stale.introduction.stale, true);
  assert.equal(stale.introduction.text, values.text);
  assert.equal(stale.summary, 'Personal display summary');
  assert.equal(stale.note, 'Keep note');
  await assert.rejects(store.updateIntroduction(original.id, { ...values, revision: stale.introduction.revision }), { code: 'INTRODUCTION_CONFLICT' });
  await store.updateIntroduction(original.id, { ...values, sourceHash: stale.descriptionHash, revision: stale.introduction.revision });
  const restarted = await new CatalogStore(directory).initialize();
  assert.equal(restarted.view().skills[0].introduction.stale, false);
  assert.equal(restarted.view().skills[0].introduction.source, 'manual');
  assert.equal(restarted.view().skills[0].introduction.text, values.text);
});

test('unrecognized English skills remain untranslated and can receive a Chinese introduction', async context => {
  const { store, rootPath } = await fixture(context);
  await fs.mkdir(path.join(rootPath, 'new-skill'));
  await fs.writeFile(path.join(rootPath, 'new-skill', 'SKILL.md'), '---\nname: not-in-local-glossary\ndescription: An unfamiliar English tool.\n---\n');
  await store.scan();
  const skill = store.view().skills.find(item => item.metadata.name === 'not-in-local-glossary');
  assert.equal(skill.introduction, null);
  assert.equal(skill.summarySource, 'original');
  await assert.rejects(store.updateIntroduction(skill.id, { text: 'English only', whenToUse: '', sourceHash: skill.descriptionHash, revision: 0 }), { code: 'INVALID_INTRODUCTION' });
  await store.updateIntroduction(skill.id, { text: '用户补充的中文用途。', whenToUse: '', sourceHash: skill.descriptionHash, revision: 0 });
  assert.equal(store.view().skills.find(item => item.id === skill.id).summary, '用户补充的中文用途。');
});

test('source validation rejects whole drives, home folders, relative and network paths', async context => {
  const { store } = await fixture(context);
  for (const candidate of [path.parse(store.directory).root, os.homedir(), '.', '\\\\server\\share', '//server/share']) {
    await assert.rejects(store.addRoot({ label: 'Bad', path: candidate, kind: 'personal' }));
  }
  assert.equal(store.config.roots.length, 1);
});

async function addBundle(store, rootPath) {
  for (const [folder, name, description] of [['suite', 'suite', 'Development workflow'], ['suite/skills/test', 'suite-test', 'Test application behavior'], ['suite/skills/research', 'suite-research', 'Research sources']]) {
    await fs.mkdir(path.join(rootPath, folder), { recursive: true });
    await fs.writeFile(path.join(rootPath, folder, 'SKILL.md'), `---\nname: ${name}\ndescription: ${description}\n---\n`);
  }
  await store.scan();
  return store.view().packages.find(group => group.name === 'suite');
}

test('package classification is inherited, child corrections are rejected and notes remain independent', async context => {
  const { store, rootPath } = await fixture(context);
  const group = await addBundle(store, rootPath);
  const child = store.view().skills.find(skill => skill.metadata.name === 'suite-test');
  await assert.rejects(store.updatePackageStructure({ action: 'create', id: group.id, name: 'Replacement', memberIds: group.memberIds, revision: store.view().structureRevision }), { code: 'INVALID_PACKAGE' });
  await assert.rejects(store.updatePackageStructure({ action: 'create', name: 'Steal members', memberIds: group.memberIds, revision: store.view().structureRevision }), { code: 'PACKAGE_MEMBERS_CONFLICT' });
  await assert.rejects(store.setSkillCategory(child.id, { categoryId: 'research' }), { code: 'PACKAGE_CATEGORY_REQUIRED' });
  await store.updateSkill(child.id, { note: 'Member note', customSummary: 'Member summary' });
  await store.setPackageCategory(group.id, { categoryId: 'writing' });
  await store.scan();
  const view = store.view();
  assert.equal(view.libraryItems.length, 2);
  assert.deepEqual(view.stats, { packages: 1, standalone: 1, members: 3, entries: 4 });
  for (const member of view.skills.filter(skill => skill.packageId === group.id)) {
    assert.equal(member.category, 'writing');
    assert.equal(member.categoryMode, 'inherited');
  }
  assert.equal(view.skills.find(skill => skill.id === child.id).note, 'Member note');
  assert.equal(view.skills.find(skill => skill.id === child.id).summary, 'Member summary');
});

test('bulk classification changes one package and never individually reclassifies its members', async context => {
  const { store, rootPath } = await fixture(context);
  const group = await addBundle(store, rootPath);
  await store.setPackageCategory(group.id, { categoryId: 'personal' });
  const preserved = await store.previewReclassification({ includeManual: false });
  assert.equal(preserved.preservedManual, 1);
  const preview = await store.previewReclassification({ includeManual: true });
  assert.equal(preview.packageCount, 1);
  assert.equal(preview.standaloneCount, 1);
  assert.equal(preview.changes.length, 1);
  assert.equal(preview.changes[0].entityType, 'package');
  assert.equal(preview.changes[0].memberCount, 3);
  const view = await store.applyReclassification({ previewId: preview.id });
  const updatedGroup = view.packages.find(item => item.id === group.id);
  assert.equal(updatedGroup.categoryMode, 'auto');
  assert.equal(view.skills.filter(skill => skill.packageId === group.id).every(skill => skill.category === updatedGroup.category), true);
  assert.equal(view.events[0].packageId, group.id);
});

test('package category migration preserves the whole group and invalidates membership-stale previews', async context => {
  const { store, rootPath } = await fixture(context);
  const group = await addBundle(store, rootPath);
  await store.setPackageCategory(group.id, { categoryId: 'writing' });
  const categories = store.view().categories.filter(category => category.id !== 'writing');
  await store.updateTaxonomy({ revision: store.catalog.taxonomyRevision, categories, migrations: { writing: 'development' } });
  assert.equal(store.view().packages[0].category, 'development');
  assert.equal(store.view().packages[0].categoryMode, 'manual');
  assert.equal(store.view().skills.filter(skill => skill.packageId).every(skill => skill.category === 'development'), true);
  const preview = await store.previewReclassification({ includeManual: true });
  await fs.mkdir(path.join(rootPath, 'suite/skills/new'), { recursive: true });
  await fs.writeFile(path.join(rootPath, 'suite/skills/new/SKILL.md'), '---\nname: new-member\ndescription: Research.\n---\n');
  await store.scan();
  assert.equal(store.view().packages[0].memberCount, 4);
  assert.equal(store.view().skills.find(skill => skill.metadata.name === 'new-member').category, 'development');
  await assert.rejects(store.applyReclassification({ previewId: preview.id }), { code: 'PREVIEW_STALE' });
});

test('manual grouping, explicit disbanding and candidate confirmation persist across scans', async context => {
  const { store, rootPath, directory } = await fixture(context);
  await fs.mkdir(path.join(rootPath, 'second'));
  await fs.writeFile(path.join(rootPath, 'second/SKILL.md'), '---\nname: second\ndescription: Related independently installed member.\n---\n');
  await store.scan();
  const selected = store.view().skills.map(skill => skill.id);
  const oldRevision = store.view().structureRevision;
  const created = await store.updatePackageStructure({ action: 'create', name: 'Manual collection', memberIds: selected, revision: oldRevision });
  assert.equal(created.libraryItems.length, 1);
  const id = created.packages[0].id;
  assert.equal(created.packages[0].entrySkillId, null);
  await assert.rejects(store.updatePackageStructure({ action: 'suppress', id, revision: oldRevision }), { code: 'PACKAGE_STRUCTURE_CONFLICT' });
  await store.setPackageCategory(id, { categoryId: 'personal' });
  await store.scan();
  const restarted = await new CatalogStore(directory).initialize();
  assert.equal(restarted.view().packages[0].memberCount, 2);
  const disbanded = await restarted.updatePackageStructure({ action: 'suppress', id, revision: restarted.view().structureRevision });
  assert.equal(disbanded.packages.length, 0);
  assert.equal(disbanded.skills.every(skill => skill.category === 'personal'), true);
  await fs.mkdir(path.join(rootPath, 'ambiguous/deep/one'), { recursive: true });
  await fs.mkdir(path.join(rootPath, 'ambiguous/deep/two'), { recursive: true });
  for (const name of ['one', 'two']) await fs.writeFile(path.join(rootPath, `ambiguous/deep/${name}/SKILL.md`), `---\nname: ${name}\ndescription: Nested tool.\n---\n`);
  await restarted.scan();
  const candidate = restarted.view().packageCandidates[0];
  assert.ok(candidate);
  const confirmed = await restarted.updatePackageStructure({ action: 'confirm', id: candidate.id, revision: restarted.view().structureRevision });
  assert.equal(confirmed.packages[0].memberCount, 2);
  await restarted.scan();
  assert.equal(restarted.view().packages.length, 1);
});

test('a second process owner cannot open the same catalog until its lock is released', async context => {
  const { directory } = await fixture(context);
  const release = await acquireCatalogLock(directory);
  try {
    await assert.rejects(acquireCatalogLock(directory), { code: 'CATALOG_ALREADY_RUNNING' });
  } finally { await release(); }
  const reacquired = await acquireCatalogLock(directory);
  await reacquired();
  await reacquired();
  assert.equal((await fs.readdir(path.join(directory, 'data'))).includes('instance.lock'), false);
});

test('adding and disabling a source persists configuration and preserves history', async context => {
  const { directory, store } = await fixture(context);
  const extra = path.join(directory, 'extra');
  await fs.mkdir(extra);
  await fs.writeFile(path.join(extra, 'SKILL.md'), '---\nname: second\ndescription: Another skill.\n---\n');
  const added = await store.addRoot({ label: 'Extra', path: extra, kind: 'project' });
  assert.equal(added.skills.length, 2);
  const source = store.config.roots.find(root => root.label === 'Extra');
  const disabled = await store.updateRoot(source.id, { enabled: false });
  assert.equal(disabled.skills.find(skill => skill.metadata.name === 'second').status, 'unknown');
  assert.equal(disabled.events.length, 2);
  const restarted = await new CatalogStore(directory).initialize();
  assert.equal(restarted.config.roots.find(root => root.id === source.id).enabled, false);
});

test('HTTP API checks origin, host, token and exposes only registered documents', async context => {
  const { store, rootPath } = await fixture(context);
  const server = createApp(store, project);
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  context.after(async () => {
    server.closeAllConnections();
    await new Promise(resolve => server.close(resolve));
  });
  const base = `http://127.0.0.1:${server.address().port}`;
  const bootstrap = await fetch(`${base}/api/catalog`);
  assert.equal(bootstrap.status, 200);
  assert.match(bootstrap.headers.get('content-security-policy'), /frame-ancestors 'none'/);
  const initial = await bootstrap.json();
  assert.equal(initial.skills.length, 1);
  assert.equal(initial.skills[0].summarySource, 'preset');
  assert.equal((await fetch(`${base}/api/catalog`, { headers: { Origin: 'https://untrusted.example' } })).status, 403);
  const invalidHostStatus = await new Promise((resolve, reject) => {
    const request = httpRequest(`${base}/api/catalog`, { headers: { Host: 'attacker.example' } }, response => {
      response.resume();
      resolve(response.statusCode);
    });
    request.on('error', reject);
    request.end();
  });
  assert.equal(invalidHostStatus, 403);
  assert.equal((await fetch(`${base}/api/scan`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' })).status, 403);
  const scanned = await fetch(`${base}/api/scan`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Catalog-Token': initial.token }, body: '{}' });
  assert.equal(scanned.status, 200);
  assert.equal((await scanned.json()).lastScan.counts.unchanged, 1);
  const doc = await fetch(`${base}/api/skills/${initial.skills[0].id}/document`);
  assert.equal(doc.status, 200);
  const documentData = await doc.json();
  assert.match(documentData.content, /<script>alert\(1\)<\/script>/);
  assert.match(documentData.html, /<h1 id="md-inert-document">Inert document<\/h1>/);
  assert.doesNotMatch(documentData.html, /<script>/);
  assert.equal((await fetch(`${base}/api/skills/${'f'.repeat(24)}/document`)).status, 404);
  assert.equal((await fetch(`${base}/config.json`)).status, 404);
  assert.equal((await fetch(`${base}/data/catalog.json`)).status, 404);
  const exported = await (await fetch(`${base}/api/export`)).json();
  assert.equal('token' in exported, false);
  assert.equal(exported.skills.length, 1);
  const mutationHeaders = { 'Content-Type': 'application/json', 'X-Catalog-Token': initial.token };
  const corrected = await fetch(`${base}/api/skills/${initial.skills[0].id}/category`, { method: 'PATCH', headers: mutationHeaders, body: JSON.stringify({ categoryId: 'writing' }) });
  assert.equal(corrected.status, 200);
  assert.equal((await corrected.json()).skills[0].categoryMode, 'manual');
  const previewResponse = await fetch(`${base}/api/reclassify/preview`, { method: 'POST', headers: mutationHeaders, body: JSON.stringify({ includeManual: false }) });
  const preview = await previewResponse.json();
  assert.equal(preview.preservedManual, 1);
  assert.equal((await fetch(`${base}/api/reclassify/apply`, { method: 'POST', headers: mutationHeaders, body: JSON.stringify({ previewId: preview.id }) })).status, 200);
  assert.equal((await fetch(`${base}/api/categories`, { method: 'PUT', headers: mutationHeaders, body: JSON.stringify({ revision: 1, categories: initial.categories }) })).status, 200);
  const group = await addBundle(store, rootPath);
  const member = store.view().skills.find(skill => skill.packageId === group.id);
  const blocked = await fetch(`${base}/api/skills/${member.id}/category`, { method: 'PATCH', headers: mutationHeaders, body: JSON.stringify({ categoryId: 'research' }) });
  assert.equal(blocked.status, 409);
  assert.equal((await blocked.json()).error, 'PACKAGE_CATEGORY_REQUIRED');
  const classified = await fetch(`${base}/api/packages/${group.id}/category`, { method: 'PATCH', headers: mutationHeaders, body: JSON.stringify({ categoryId: 'research' }) });
  assert.equal(classified.status, 200);
  assert.equal((await classified.json()).skills.filter(skill => skill.packageId === group.id).every(skill => skill.category === 'research'), true);
  const independent = await fetch(`${base}/api/packages/structure`, { method: 'POST', headers: mutationHeaders, body: JSON.stringify({ action: 'suppress', id: group.id, revision: store.view().structureRevision }) });
  assert.equal(independent.status, 200);
  assert.equal((await independent.json()).packages.length, 0);
  for (const resource of ['/', '/app.js', '/style.css', '/vendor/lucide.js', '/assets/catalog-mark.svg']) {
    assert.equal((await fetch(`${base}${resource}`)).status, 200, resource);
  }
});
