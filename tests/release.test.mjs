import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { collectDependencyNotices, generateNotices, verifyNotices } from '../scripts/licenses.mjs';
import { inspectReleaseFiles, buildRelease, validateReleasePath, verifyArchive } from '../scripts/release.mjs';
import { create as createArchive } from 'tar';
import { fileURLToPath } from 'node:url';
import { parseDocument } from 'yaml';

async function fixture(context) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'skill-atlas-release-'));
  context.after(() => fs.rm(directory, { recursive: true, force: true }));
  return directory;
}

async function licenseFixture(directory, license = 'MIT') {
  const location = 'node_modules/example';
  await fs.mkdir(path.join(directory, location), { recursive: true });
  await fs.writeFile(path.join(directory, 'package-lock.json'), JSON.stringify({ lockfileVersion: 3, packages: { '': {}, [location]: { version: '1.2.3', license } } }));
  await fs.writeFile(path.join(directory, location, 'package.json'), JSON.stringify({ name: 'example', version: '1.2.3', license }));
  return path.join(directory, location);
}

test('release notices preserve full bundled licenses and detect stale generated output', async context => {
  const directory = await fixture(context);
  const dependency = await licenseFixture(directory);
  await fs.writeFile(path.join(dependency, 'LICENSE'), 'MIT License\r\nCopyright example\r\nAdditional bundled notice\r\n');
  await fs.writeFile(path.join(dependency, 'NOTICE.txt'), 'An additional attribution.\n');
  const notices = await generateNotices(directory);
  assert.match(notices, /MIT License/);
  assert.match(notices, /Additional bundled notice/);
  assert.match(notices, /An additional attribution/);
  assert.match(notices, /example 1\.2\.3/);
  await fs.writeFile(path.join(directory, 'THIRD_PARTY_NOTICES.md'), notices.replace(/\n/g, '\r\n'));
  await verifyNotices(directory);
  await fs.appendFile(path.join(dependency, 'LICENSE'), 'New attribution\n');
  await assert.rejects(verifyNotices(directory), /THIRD_PARTY_NOTICES_OUTDATED/);
});

test('release notices fail on missing license text or mismatched installed versions', async context => {
  const directory = await fixture(context);
  const dependency = await licenseFixture(directory);
  await assert.rejects(collectDependencyNotices(directory), /MISSING_DEPENDENCY_LICENSE/);
  await fs.writeFile(path.join(dependency, 'LICENSE'), 'MIT text');
  await fs.writeFile(path.join(dependency, 'package.json'), JSON.stringify({ name: 'example', version: '9.9.9', license: 'MIT' }));
  await assert.rejects(collectDependencyNotices(directory), /DEPENDENCY_METADATA_MISMATCH/);
});

test('new dependency license types require an explicit review', async context => {
  const directory = await fixture(context);
  const dependency = await licenseFixture(directory, 'UNLICENSED');
  await fs.writeFile(path.join(dependency, 'LICENSE'), 'Restricted');
  await assert.rejects(collectDependencyNotices(directory), /LICENSE_REVIEW_REQUIRED/);
});

async function releaseFixture(directory) {
  const files = ['LICENSE', 'README.md', 'SECURITY.md', 'CONTRIBUTING.md', 'THIRD_PARTY_NOTICES.md', 'package.json', 'package-lock.json', 'config.json', 'server.mjs', 'cli.mjs'];
  const manifest = { name: 'example-app', version: '0.1.0', private: true, license: 'MIT', files };
  for (const file of files) await fs.writeFile(path.join(directory, file), 'Public fixture\n');
  await fs.writeFile(path.join(directory, 'package.json'), JSON.stringify(manifest));
  await fs.writeFile(path.join(directory, 'package-lock.json'), JSON.stringify({ lockfileVersion: 3, packages: { '': { name: manifest.name, version: manifest.version, license: manifest.license } } }));
  await fs.writeFile(path.join(directory, 'config.json'), JSON.stringify({ roots: [{ id: 'default', path: '~/.agents/skills' }] }));
  await fs.writeFile(path.join(directory, 'THIRD_PARTY_NOTICES.md'), await generateNotices(directory));
  return manifest;
}

test('release archives contain only allowlisted files and exclude private working data', async context => {
  const directory = await fixture(context);
  const manifest = await releaseFixture(directory);
  await fs.mkdir(path.join(directory, 'data'));
  await fs.writeFile(path.join(directory, 'data', 'catalog.json'), 'PRIVATE_SENTINEL');
  await fs.writeFile(path.join(directory, '.env'), 'PRIVATE_SENTINEL');
  const release = await buildRelease(directory);
  assert.equal(release.fileCount, manifest.files.length);
  const receipt = JSON.parse(await fs.readFile(path.join(directory, release.receipt), 'utf8'));
  assert.equal(receipt.sha256, release.sha256);
  assert.deepEqual(receipt.files.map(file => file.path).sort(), [...manifest.files].sort());
  assert.equal(receipt.files.some(file => file.path.includes('data/')), false);
  const { files } = await inspectReleaseFiles(directory);
  await verifyArchive(path.join(directory, release.archive), 'example-app-0.1.0', files);
  const repeated = await buildRelease(directory);
  assert.equal(repeated.sha256, release.sha256);
});

test('release policy rejects private paths, traversal and symbolic file paths', async context => {
  for (const file of ['../README.md', 'data/config.local.json', 'node_modules/file.js', '.env', '.env.test', 'secret.key', 'personal.local.json', 'src\\file.mjs', 'artifacts/export.json']) {
    assert.throws(() => validateReleasePath(file), /PRIVATE_OR_INVALID_RELEASE_PATH/, file);
  }
  const directory = await fixture(context);
  const manifest = await releaseFixture(directory);
  const outside = path.join(directory, 'private');
  await fs.mkdir(outside);
  await fs.writeFile(path.join(outside, 'file.md'), 'Linked private file');
  await fs.symlink(outside, path.join(directory, 'linked'), process.platform === 'win32' ? 'junction' : 'dir');
  manifest.files.push('linked/file.md');
  await fs.writeFile(path.join(directory, 'package.json'), JSON.stringify(manifest));
  await assert.rejects(inspectReleaseFiles(directory), /RELEASE_LINK_OR_SPECIAL_FILE/);
});

test('release policy reports sensitive-file codes without echoing matched content', async context => {
  const directory = await fixture(context);
  await releaseFixture(directory);
  const fakeToken = ['gh', 'p_', 'A'.repeat(36)].join('');
  await fs.writeFile(path.join(directory, 'README.md'), fakeToken);
  await assert.rejects(inspectReleaseFiles(directory), error => error.message === 'ACCESS_TOKEN: README.md' && !error.message.includes(fakeToken));
  await fs.writeFile(path.join(directory, 'README.md'), 'Public text');
  await fs.writeFile(path.join(directory, 'config.json'), JSON.stringify({ roots: [{ id: 'private', path: '/opt/private-skills' }] }));
  await assert.rejects(inspectReleaseFiles(directory), /PRIVATE_DEFAULT_CONFIGURATION/);
});

test('archive verification rejects additional files that were not reviewed', async context => {
  const directory = await fixture(context);
  await releaseFixture(directory);
  const { files } = await inspectReleaseFiles(directory);
  await fs.writeFile(path.join(directory, 'unexpected.txt'), 'Not allowlisted');
  const target = path.join(directory, 'tampered.tgz');
  await createArchive({ file: target, cwd: directory, prefix: 'example-app-0.1.0', gzip: true }, [...files.map(file => file.path), 'unexpected.txt']);
  await assert.rejects(verifyArchive(target, 'example-app-0.1.0', files), /UNEXPECTED_ARCHIVE_ENTRY/);
});

test('CI uses pinned actions, read-only permissions and no automatic publication', async () => {
  const directory = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
  const parsed = parseDocument(await fs.readFile(path.join(directory, '.github/workflows/ci.yml'), 'utf8'));
  assert.equal(parsed.errors.length, 0);
  const workflow = parsed.toJS();
  assert.deepEqual(workflow.permissions, { contents: 'read' });
  assert.equal(Object.hasOwn(workflow.on, 'pull_request_target'), false);
  assert.equal(Object.hasOwn(workflow.on, 'pull_request'), true);
  assert.deepEqual(workflow.jobs.validate.strategy.matrix.node, [22, 24]);
  assert.deepEqual(workflow.jobs.validate.strategy.matrix.os, ['ubuntu-latest', 'windows-latest', 'macos-latest']);
  for (const step of workflow.jobs.validate.steps) {
    if (step.uses) assert.match(step.uses, /^[\w/-]+@[a-f0-9]{40}$/);
    if (step.run) assert.doesNotMatch(step.run, /publish|push|upload/);
  }
});
