export const categoryIcons = ['code-2', 'flask-conical', 'pen-tool', 'radar', 'workflow', 'files', 'heart-handshake', 'shapes', 'tag', 'book-open', 'database', 'shield-check', 'compass'];

export function validateTaxonomy(value) {
  if (!Array.isArray(value) || !value.length || value.length > 50) throw new Error('INVALID_TAXONOMY');
  const ids = new Set();
  const labels = new Set();
  const exactNames = new Set();
  const result = value.map(category => {
    if (!category || typeof category.id !== 'string' || !/^[a-z][a-z0-9-]{0,63}$/.test(category.id) || ids.has(category.id) || typeof category.label !== 'string' || !category.label.trim() || category.label.trim().length > 40 || !categoryIcons.includes(category.icon)) throw new Error('INVALID_CATEGORY');
    const label = category.label.trim();
    if (labels.has(label.toLowerCase())) throw new Error('DUPLICATE_CATEGORY');
    ids.add(category.id);
    labels.add(label.toLowerCase());
    const normalizeRules = (rules, maximum) => {
      if (!Array.isArray(rules) || rules.length > maximum || rules.some(rule => typeof rule !== 'string' || !rule.trim() || rule.length > 128)) throw new Error('INVALID_CATEGORY_RULES');
      return [...new Set(rules.map(rule => rule.trim().toLowerCase()))];
    };
    const keywords = normalizeRules(category.keywords, 100);
    const names = normalizeRules(category.names, 200);
    for (const name of names) {
      if (exactNames.has(name)) throw new Error('DUPLICATE_NAME_RULE');
      exactNames.add(name);
    }
    if (category.id === 'other' && (keywords.length || names.length)) throw new Error('FALLBACK_CATEGORY_REQUIRED');
    return { id: category.id, label, icon: category.icon, keywords, names };
  });
  if (result.at(-1).id !== 'other') throw new Error('FALLBACK_CATEGORY_REQUIRED');
  return result;
}

export function automaticCategory(skill, taxonomy) {
  const name = skill.metadata.name.toLowerCase();
  const exact = taxonomy.find(category => category.names.includes(name));
  if (exact) return exact.id;
  const searchable = `${name} ${skill.metadata.description}`.toLowerCase();
  return taxonomy.find(category => category.id !== 'other' && category.keywords.some(keyword => searchable.includes(keyword)))?.id ?? 'other';
}

export function appliedClassification(skill, taxonomy) {
  if (['manual', 'auto'].includes(skill.classification?.mode) && taxonomy.some(category => category.id === skill.classification.categoryId)) return skill.classification;
  return { categoryId: automaticCategory(skill, taxonomy), mode: 'auto' };
}

export function planReclassification(skills, taxonomy, includeManual = false) {
  const changes = [];
  let preservedManual = 0;
  let unchanged = 0;
  for (const skill of skills) {
    const current = appliedClassification(skill, taxonomy);
    if (current.mode === 'manual' && !includeManual) { preservedManual += 1; continue; }
    const proposed = automaticCategory(skill, taxonomy);
    if (current.categoryId === proposed && current.mode === 'auto') { unchanged += 1; continue; }
    changes.push({ skillId: skill.id, name: skill.metadata.name, fromCategory: current.categoryId, toCategory: proposed, wasManual: current.mode === 'manual', ...(skill.entityType === 'package' ? { entityType: 'package', memberCount: skill.memberIds.length } : {}) });
  }
  return { changes, preservedManual, unchanged, includeManual };
}
