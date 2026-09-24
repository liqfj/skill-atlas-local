import path from 'node:path';
import { createHash } from 'node:crypto';

export function packageId(directory) {
  const canonical = process.platform === 'win32' ? path.resolve(directory).toLowerCase() : path.resolve(directory);
  return `pkg-${createHash('sha256').update(canonical).digest('hex').slice(0, 24)}`;
}

export function packageStructure(skills, previousPackages = [], rules = []) {
  const previous = new Map(previousPackages.map(group => [group.id, group]));
  const preferences = new Map(rules.map(rule => [rule.id, rule]));
  const groups = new Map();
  for (const skill of skills) {
    for (const location of skill.locations) {
      const container = location.container;
      if (!container) continue;
      const id = packageId(container.canonicalPath);
      if (!groups.has(id)) groups.set(id, {
        id, name: container.name, canonicalPath: container.canonicalPath,
        entrySkillId: container.entrySkillId, memberIds: new Set(), locations: [], simple: true,
      });
      const group = groups.get(id);
      group.memberIds.add(skill.id);
      if (container.entrySkillId) group.entrySkillId = container.entrySkillId;
      group.simple &&= container.directMember;
      if (!group.locations.some(item => item.rootId === location.rootId && item.path === container.path)) {
        group.locations.push({ rootId: location.rootId, path: container.path, status: location.status });
      }
    }
  }
  const byId = new Map(skills.map(skill => [skill.id, skill]));
  const options = [];
  for (const group of groups.values()) {
    const preference = preferences.get(group.id);
    if (preference?.mode === 'suppressed' || group.memberIds.size < 2 && !previous.has(group.id) && preference?.mode !== 'confirmed') continue;
    const memberIds = [...group.memberIds].sort();
    const entry = memberIds.includes(group.entrySkillId) ? byId.get(group.entrySkillId) : null;
    options.push({
      ...previous.get(group.id), ...group, memberIds,
      name: preference?.name || previous.get(group.id)?.name || entry?.metadata.name || group.name,
      entrySkillId: entry?.id ?? null,
      kind: entry ? 'bundle' : 'collection',
      evidence: entry ? 'nested-entry' : group.simple ? 'collection-directory' : 'nested-directory',
      confirmed: Boolean(entry || group.simple || previous.has(group.id) || preference?.mode === 'confirmed'),
    });
  }
  for (const rule of rules.filter(item => item.mode === 'manual')) {
    options.push({
      ...previous.get(rule.id), id: rule.id, name: rule.name, memberIds: rule.memberIds.filter(id => byId.has(id)),
      entrySkillId: null, canonicalPath: null, kind: 'collection', evidence: 'manual', confirmed: true, locations: [],
    });
  }
  const owners = new Map();
  const priority = group => ['confirmed', 'manual'].includes(preferences.get(group.id)?.mode) ? 3 : previous.has(group.id) ? 2 : group.confirmed ? 1 : 0;
  for (const group of options) for (const id of group.memberIds) {
    if (!owners.has(id)) owners.set(id, []);
    owners.get(id).push(group);
  }
  const packages = [];
  const candidates = [];
  for (const group of options) {
    const conflicts = group.memberIds.filter(id => owners.get(id).some(other => other.id !== group.id && priority(other) >= priority(group)));
    const members = group.memberIds.map(id => byId.get(id));
    const status = members.some(skill => skill.status === 'present') ? 'present' : members.some(skill => skill.status === 'unknown') ? 'unknown' : 'missing';
    const result = { ...group, status, conflicts, firstSeen: group.firstSeen ?? members.map(skill => skill.firstSeen).sort()[0] };
    delete result.simple;
    delete result.confirmed;
    if (!group.confirmed || conflicts.length) candidates.push(result);
    else packages.push(result);
  }
  const assignments = new Map();
  for (const group of packages) for (const id of group.memberIds) assignments.set(id, group.id);
  return {
    packages: packages.sort((left, right) => left.name.localeCompare(right.name)),
    packageCandidates: candidates.sort((left, right) => left.name.localeCompare(right.name)),
    skills: skills.map(skill => {
      const owner = assignments.get(skill.id) ?? null;
      const parents = skill.locations.map(location => location.parentSkillId).filter(id => id && assignments.get(id) === owner && owner);
      return { ...skill, packageId: owner, parentSkillId: parents[0] ?? null };
    }),
  };
}

export function packageSubject(group, skills) {
  const entry = skills.find(skill => skill.id === group.entrySkillId);
  const descriptions = {
    'compound-engineering': '工程开发与协作工作流技能集合',
    superpowers: '软件开发工作流技能集合',
  };
  return {
    ...group, entityType: 'package',
    metadata: { name: group.name, description: entry?.metadata.description || (Object.hasOwn(descriptions, group.name) ? descriptions[group.name] : '') },
  };
}

export function classificationUnits(catalog) {
  return [
    ...(catalog.packages ?? []).map(group => packageSubject(group, catalog.skills)),
    ...catalog.skills.filter(skill => !skill.packageId).map(skill => ({ ...skill, entityType: 'skill' })),
  ];
}

export function structureFingerprint(catalog) {
  const value = {
    packages: (catalog.packages ?? []).map(group => [group.id, group.name, group.entrySkillId, group.memberIds, group.evidence]),
    candidates: (catalog.packageCandidates ?? []).map(group => [group.id, group.memberIds, group.conflicts]),
    rules: catalog.packageRules ?? [],
    skills: catalog.skills.map(skill => [skill.id, skill.packageId, skill.parentSkillId, skill.status]),
  };
  return createHash('sha256').update(JSON.stringify(value)).digest('hex');
}
