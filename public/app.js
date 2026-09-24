const get = id => document.getElementById(id);
const escapeHtml = value => String(value ?? '').replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]);
const icon = (name, className = '') => `<i data-lucide="${name}"${className ? ` class="${className}"` : ''}></i>`;
const state = { data: null, token: '', view: 'library', category: '', query: '', source: '', status: '', sort: 'name', recent: false, page: 1, pageSize: 20, eventType: '', historyLimit: 50, scanning: false, detailId: null, detailRevision: 0, noteDirty: false, introductionDirty: false, categoryDirty: false, detailTab: 'overview', managementBusy: false, categoryEdit: null, mergeEdit: null, preview: null, previewSequence: 0, candidates: [], candidatesLoaded: false };
Object.assign(state, { kind: '', packageId: null, packageQuery: '', packageEdit: null, packageDraft: null, packageCategoryDirty: false, packageCategoryValue: '' });
Object.assign(state, { document: null, documentMode: 'preview', documentLoading: false, documentError: '' });
const categoryNames = new Map();
const statusLabels = { present: '已发现', missing: '路径缺失', unknown: '待确认' };
const eventLabels = { added: '新增发现', updated: '内容更新', missing: '路径缺失', restored: '重新发现', classified: '分类调整', packaged: '包归属调整' };
const eventIcons = { added: 'plus', updated: 'pencil', missing: 'minus', restored: 'rotate-ccw', classified: 'tags', packaged: 'package' };
const packageEvidenceLabels = { 'nested-entry': '主入口与子技能', 'collection-directory': '集合目录', 'nested-directory': '嵌套目录边界', manual: '手工确认的成员集合' };
const summaryOrigins = { custom: '个人摘要', preset: '本地整理', original: '原始描述', manual: '个人修订', local: '本地词条' };
const iconLabels = { 'code-2': '开发', 'flask-conical': '测试', 'pen-tool': '设计', radar: '研究', workflow: '流程', files: '文档', 'heart-handshake': '生活', shapes: '其他', tag: '标签', 'book-open': '阅读', database: '数据', 'shield-check': '安全', compass: '探索' };
const scopeLabels = { shared: '共享目录', personal: '个人目录', project: '项目目录', builtin: '软件内置' };
const rootStatuses = { ok: '扫描正常', partial: '部分异常', unavailable: '目录不可用', error: '读取失败', disabled: '已暂停' };
const errors = {
  INVALID_PATH: '请输入本机绝对目录路径或 ~/ 开头的路径。', PATH_TOO_BROAD: '扫描范围过大，请选择具体的技能目录。',
  SOURCE_EXISTS: '这个目录已经在来源列表中。', SOURCE_UNAVAILABLE: '目录不存在或无法访问。', INVALID_SOURCE: '来源信息不完整。',
  SOURCE_LIMIT: '来源目录最多为 50 个。', DOCUMENT_UNAVAILABLE: '原始文档暂时无法读取，已保留上次扫描的信息。',
  TOKEN_REQUIRED: '页面会话已过期，请刷新页面。', INVALID_ANNOTATION: '笔记或摘要超出长度限制。',
  INTERNAL_ERROR: '操作未完成，本地记录已保留。', INVALID_LOCAL_DATA: '本地数据无法读取。', NETWORK: '无法连接本地服务。',
  INVALID_TAXONOMY: '分类数量必须在 1 到 50 之间。', INVALID_CATEGORY: '请检查分类名称、图标和目标分类。',
  DUPLICATE_CATEGORY: '分类名称不能重复。', INVALID_CATEGORY_RULES: '规则为空、过长或超过数量限制。',
  DUPLICATE_NAME_RULE: '同一个精确技能名称不能分配给多个分类。', FALLBACK_CATEGORY_REQUIRED: '兜底分类必须保留在末尾，且不设置匹配规则。',
  MIGRATION_REQUIRED: '移除分类前必须选择迁移目标。', INVALID_MIGRATION: '迁移目标无效。',
  TAXONOMY_CONFLICT: '分类已在其他操作中更新。请关闭编辑框，刷新后重新编辑。',
  PREVIEW_EXPIRED: '预览已过期，请重新预览。', PREVIEW_STALE: '规则或技能状态已变化，请重新预览。',
  INVALID_INTRODUCTION: '请填写中文简介，并检查内容长度。', INTRODUCTION_CONFLICT: '原始描述或中文修订已变化。请保留当前草稿，重新打开详情后核对。',
  PACKAGE_CATEGORY_REQUIRED: '该技能属于技能包，请调整整包分类。', PACKAGE_STRUCTURE_CONFLICT: '包结构已变化，请重新打开分组编辑并预览。',
  INVALID_PACKAGE: '请检查技能包名称和操作。', INVALID_PACKAGE_MEMBERS: '请至少选择两个不同的成员。',
  PACKAGE_MEMBERS_CONFLICT: '成员已有包归属或待确认分组，请先处理原分组，不能同时归入两个包。',
};
let toastTimer;
let loadSequence = 0;

function icons() { window.lucide?.createIcons({ attrs: { 'aria-hidden': 'true' } }); }
function date(value, full = false) {
  if (!value) return '—';
  const parsed = new Date(value);
  if (!Number.isFinite(parsed.getTime())) return '—';
  return new Intl.DateTimeFormat('zh-CN', full ? { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false } : { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false }).format(parsed);
}
function isRecent(skill) { return Date.now() - new Date(skill.firstSeen).getTime() < 7 * 24 * 60 * 60 * 1000; }
function rootLabel(id) { return state.data.configuredRoots.find(root => root.id === id)?.label ?? id; }
function categoryFor(skill) { return state.data.categories.find(category => category.id === skill.category) ?? state.data.categories.at(-1); }
function statusMarkup(status) { return `<span class="status-label ${status}"><span class="status-dot"></span>${statusLabels[status] ?? status}</span>`; }

function toast(message, error = false) {
  clearTimeout(toastTimer);
  const target = get('toast');
  target.textContent = message;
  target.classList.toggle('error', error);
  target.hidden = false;
  toastTimer = setTimeout(() => { target.hidden = true; }, 4500);
}

async function request(url, options = {}) {
  try {
    const response = await fetch(url, { ...options, headers: { ...(options.body ? { 'Content-Type': 'application/json', 'X-Catalog-Token': state.token } : {}), ...options.headers } });
    const payload = await response.json();
    if (!response.ok) throw new Error(errors[payload.error] ?? `请求失败（${payload.error ?? response.status}）`);
    return payload;
  } catch (error) {
    if (error instanceof TypeError) throw new Error(errors.NETWORK);
    throw error;
  }
}

function connection(online) {
  get('connectionError').hidden = online;
  get('connectionStatus').classList.toggle('offline', !online);
  get('connectionStatus').innerHTML = `<span class="status-dot"></span><span>${online ? '本地运行' : '连接断开'}</span>`;
}

function accept(data) {
  state.data = data;
  if (data.token) state.token = data.token;
  categoryNames.clear();
  data.categories.forEach(category => categoryNames.set(category.id, category.label));
  if (state.category && !categoryNames.has(state.category)) state.category = '';
  if (state.packageId && !data.packages.some(group => group.id === state.packageId)) { state.packageId = null; state.packageCategoryDirty = false; if (state.view === 'package') setView('packages'); }
  connection(true);
  renderOverview();
  renderCurrent();
}

function renderOverview() {
  const data = state.data;
  get('metricPackages').textContent = data.stats.packages;
  get('metricStandalone').textContent = data.stats.standalone;
  get('metricMembers').textContent = data.stats.members;
  get('metricEntries').textContent = data.stats.entries;
  get('navTotal').textContent = data.libraryItems.length;
  get('navPackages').textContent = data.packages.length;
  get('navChanges').textContent = data.events.length;
  get('navSources').textContent = data.configuredRoots.length;
  get('navCategories').textContent = data.categories.length;
  get('categoryNav').innerHTML = data.categories.map(category => {
    const count = data.libraryItems.filter(skill => skill.category === category.id).length;
    return `<button class="nav-item${state.category === category.id && state.view === 'library' ? ' active' : ''}" data-category="${category.id}" aria-pressed="${state.category === category.id && state.view === 'library'}">${icon(category.icon)}<span>${escapeHtml(category.label)}</span><span class="nav-count">${count}</span></button>`;
  }).join('');
  get('packageNav').innerHTML = data.packages.map(group => `<button class="nav-item${state.view === 'package' && state.packageId === group.id ? ' active' : ''}" data-package="${group.id}" title="${escapeHtml(group.name)}">${icon('package')}<span>${escapeHtml(group.name)}</span><span class="nav-count">${group.memberCount}</span></button>`).join('') || '<span class="nav-empty">暂无技能包</span>';
  get('sourceFilter').innerHTML = '<option value="">全部来源</option>' + data.configuredRoots.map(root => `<option value="${escapeHtml(root.id)}">${escapeHtml(root.label)}</option>`).join('');
  get('sourceFilter').value = state.source;
  get('statusFilter').value = state.status;
  get('sortSelect').value = state.sort;
  const time = data.lastScan?.finishedAt;
  get('scanStamp').textContent = time ? `上次扫描 ${date(time)}` : '尚未扫描';
  get('footerTime').textContent = time ? `最近同步 ${date(time, true)}` : '等待首次扫描';
  get('autoScanToggle').checked = data.settings.autoScan;
  const group = data.packages.find(item => item.id === state.packageId);
  get('pageMeta').textContent = state.view === 'library' ? `${data.stats.packages} 个技能包 · ${data.stats.standalone} 个独立技能 · ${data.stats.entries} 个入口` : state.view === 'history' ? `${data.events.length} 条变化 · 扫描、分类与归属` : state.view === 'categories' ? `${data.categories.length} 个用途分类 · ${data.libraryItems.length} 个整包或独立技能` : state.view === 'packages' ? `${data.packages.length} 个技能包 · ${data.packageCandidates.length} 个待确认分组` : state.view === 'package' && group ? `${group.memberCount} 个入口 · ${group.entrySkillId ? '含主入口' : '无主入口的技能集合'}` : `${data.configuredRoots.length} 个来源 · ${data.configuredRoots.filter(root => root.enabled !== false).length} 个参与扫描`;
  icons();
}

function filteredSkills() {
  const words = state.query.toLowerCase().trim().split(/\s+/).filter(Boolean);
  const matches = skill => {
    if (state.source && !skill.locations.some(location => location.rootId === state.source)) return false;
    if (state.status === 'issues' && !skill.metadata.parseError) return false;
    if (state.status === 'duplicates' && !(skill.status === 'present' && skill.sameNameCount > 1)) return false;
    if (state.status === 'zh-missing' && skill.introduction) return false;
    if (state.status === 'zh-stale' && !skill.introduction?.stale) return false;
    const searchable = `${skill.metadata.name} ${skill.metadata.description} ${skill.summary} ${skill.introduction?.text ?? ''} ${skill.introduction?.whenToUse ?? ''} ${skill.keywords ?? ''} ${skill.note ?? ''} ${categoryNames.get(skill.category)}`.toLowerCase();
    return words.every(word => searchable.includes(word));
  };
  const selected = state.data.libraryItems.filter(skill => {
    if (state.kind && skill.entityType !== state.kind) return false;
    if (state.category && skill.category !== state.category) return false;
    if (state.source && !skill.locations.some(location => location.rootId === state.source)) return false;
    if (state.recent && !isRecent(skill)) return false;
    if (state.status === 'manual' && skill.categoryMode !== 'manual') return false;
    if (state.status === 'pending' && !skill.classificationPending) return false;
    if (['present', 'missing', 'unknown'].includes(state.status) && skill.status !== state.status) return false;
    if (skill.entityType !== 'package') return matches(skill);
    return state.data.skills.some(member => member.packageId === skill.id && matches(member)) || !['issues', 'duplicates', 'zh-missing', 'zh-stale'].includes(state.status) && matches(skill);
  });
  selected.sort((left, right) => state.sort === 'name' ? left.metadata.name.localeCompare(right.metadata.name) : right[state.sort].localeCompare(left[state.sort]) || left.metadata.name.localeCompare(right.metadata.name));
  return selected;
}

function renderLibrary() {
  const skills = filteredSkills();
  const pageCount = Math.max(1, Math.ceil(skills.length / state.pageSize));
  state.page = Math.min(state.page, pageCount);
  get('listTitle').textContent = state.category ? categoryNames.get(state.category) : '全部目录项';
  document.querySelectorAll('[data-kind]').forEach(button => { const active = button.dataset.kind === state.kind; button.classList.toggle('active', active); button.setAttribute('aria-pressed', active); });
  get('resultCount').textContent = skills.length;
  get('recentChip').hidden = !state.recent;
  get('clearSearch').hidden = !state.query;
  if (!skills.length) {
    get('skillTable').innerHTML = `<div class="empty-state">${icon('search-x')}<h3>${state.data.skills.length ? '没有匹配的技能' : '尚无收录技能'}</h3><p>${escapeHtml(state.query)}</p><button class="button button-secondary" data-action="reset">${icon('list-filter')}清除筛选</button></div>`;
    get('pagination').innerHTML = '';
    icons();
    return;
  }
  const start = (state.page - 1) * state.pageSize;
  get('skillTable').innerHTML = '<div class="table-header"><span>技能包 / 独立技能</span><span class="category-column">用途分类</span><span>来源</span><span class="status-column">收录状态</span><span></span></div>' + skills.slice(start, start + state.pageSize).map(skill => {
    const category = categoryFor(skill);
    const roots = [...new Set(skill.locations.map(location => location.rootId))];
    if (skill.entityType === 'package') {
      const words = state.query.toLowerCase().trim().split(/\s+/).filter(Boolean);
      const matching = words.length ? state.data.skills.filter(member => member.packageId === skill.id && words.every(word => `${member.metadata.name} ${member.summary} ${member.introduction?.whenToUse ?? ''} ${member.note}`.toLowerCase().includes(word))) : [];
      return `<article class="skill-row package-library-row" data-package-row="${skill.id}"><div class="skill-main"><span class="skill-symbol package-symbol">${icon('package')}</span><div class="skill-description"><button class="skill-name" data-package="${skill.id}">${escapeHtml(skill.name)}</button><span class="package-badge">技能包 · ${skill.memberCount} 个入口</span><p class="skill-summary">${escapeHtml(skill.summary)}</p>${matching.length ? `<div class="package-matches"><span>命中 ${matching.length} 个成员</span>${matching.slice(0, 2).map(member => `<button data-skill="${member.id}">${escapeHtml(member.metadata.name)}</button>`).join('')}</div>` : ''}</div></div><div class="skill-category"><span class="category-label">${escapeHtml(category.label)}</span><small class="classification-mode">${skill.categoryMode === 'manual' ? '整包人工指定' : '整包分类'}</small></div><div class="skill-sources source-labels">${roots.map(root => `<span class="source-label">${icon('folder')}<span>${escapeHtml(rootLabel(root))}</span></span>`).join('')}</div><div class="skill-status">${statusMarkup(skill.status)}<span class="record-time">${skill.presentMemberCount} / ${skill.memberCount} 存在</span></div><button class="icon-button row-arrow" data-package="${skill.id}" title="展开技能包" aria-label="展开 ${escapeHtml(skill.name)}">${icon('chevron-right')}</button></article>`;
    }
    return `<article class="skill-row"><div class="skill-main"><span class="skill-symbol tone-${skill.category}">${icon(category.icon)}</span><div class="skill-description"><button class="skill-name" data-skill="${skill.id}">${escapeHtml(skill.metadata.name)}</button>${skill.sameNameCount > 1 ? '<span class="mini-badge">同名</span>' : ''}${skill.metadata.parseError ? '<span class="mini-badge warning">需整理</span>' : ''}${skill.introduction?.stale ? '<span class="mini-badge warning">中文待复核</span>' : !skill.introduction ? '<span class="mini-badge">待补中文</span>' : ''}<p class="skill-summary" title="${escapeHtml(skill.summary)}">${escapeHtml(skill.summary)}</p></div></div><div class="skill-category"><span class="category-label"><span class="category-dot"></span>${escapeHtml(category.label)}</span>${skill.categoryMode === 'manual' ? '<small class="classification-mode">人工指定</small>' : skill.classificationPending ? '<small class="classification-mode pending">待重分类</small>' : ''}</div><div class="skill-sources source-labels">${roots.map(root => `<span class="source-label" title="${escapeHtml(rootLabel(root))}">${icon('folder')}<span>${escapeHtml(rootLabel(root))}</span></span>`).join('')}</div><div class="skill-status">${statusMarkup(skill.status)}<time class="record-time" title="首次发现 ${date(skill.firstSeen, true)}">${date(skill.firstSeen)}</time></div><button class="icon-button row-arrow" data-skill="${skill.id}" title="查看详情" aria-label="查看 ${escapeHtml(skill.metadata.name)}">${icon('chevron-right')}</button></article>`;
  }).join('');
  get('pagination').innerHTML = `<span>第 ${start + 1}–${Math.min(start + state.pageSize, skills.length)} 项，共 ${skills.length} 项</span><div class="pagination-controls"><button class="icon-button" data-page="previous" aria-label="上一页" title="上一页" ${state.page === 1 ? 'disabled' : ''}>${icon('chevron-left')}</button><span class="page-index">${state.page} / ${pageCount}</span><button class="icon-button" data-page="next" aria-label="下一页" title="下一页" ${state.page === pageCount ? 'disabled' : ''}>${icon('chevron-right')}</button></div>`;
  icons();
}

function renderHistory() {
  const events = state.data.events.filter(event => !state.eventType || event.type === state.eventType);
  get('historyCount').textContent = events.length;
  get('historyList').innerHTML = events.length ? events.slice(0, state.historyLimit).map(event => {
    const target = event.packageId ? state.data.packages.some(group => group.id === event.packageId) ? `data-package="${event.packageId}"` : 'disabled' : `data-skill="${event.skillId}"`;
    return `<article class="history-row"><span class="event-symbol event-${event.type}">${icon(eventIcons[event.type] ?? 'history')}</span><div><button class="skill-name history-name" ${target}>${escapeHtml(event.name)}</button><div class="history-type">${eventLabels[event.type] ?? '目录变化'}${event.packageId ? ' · 整包' : ''}${event.type === 'classified' ? ` · ${escapeHtml(event.fromCategory)} → ${escapeHtml(event.toCategory)} · ${event.mode === 'manual' ? '人工' : '自动'}` : ''}${event.type === 'packaged' ? ` · ${{ create: '建立分组', edit: '调整分组', confirm: '确认分组', suppress: '解除分组' }[event.action] ?? ''}` : ''}</div></div><time datetime="${event.at}">${date(event.at, true)}</time><button class="icon-button" ${target} title="查看详情" aria-label="查看 ${escapeHtml(event.name)}">${icon('arrow-up-right')}</button></article>`;
  }).join('') : `<div class="empty-state">${icon('history')}<h3>暂无变化记录</h3></div>`;
  get('historyMore').innerHTML = events.length > state.historyLimit ? `<button class="button button-secondary" data-action="more-history">${icon('chevron-down')}载入更多</button>` : '';
  icons();
}

function renderSources() {
  get('sourceList').innerHTML = state.data.configuredRoots.map(root => {
    const report = state.data.roots.find(item => item.id === root.id);
    const issues = report?.issues ?? [];
    return `<article class="source-card"><div class="source-card-main"><div class="source-card-header"><span class="source-symbol">${icon(root.kind === 'shared' ? 'folder-symlink' : root.kind === 'builtin' ? 'package' : 'folder-code')}</span><div><h3>${escapeHtml(root.label)}</h3><div class="source-kind">${scopeLabels[root.kind] ?? '自定义目录'}</div></div><span class="status-label ${report?.status === 'ok' ? '' : 'unknown'}"><span class="status-dot"></span>${rootStatuses[report?.status] ?? '未扫描'}</span></div><p class="source-path">${escapeHtml(report?.path ?? root.path)}</p><div class="source-count"><strong>${report?.count ?? 0}</strong><span>个技能</span></div>${issues.length ? `<details class="source-issues"><summary>${issues.length} 项扫描异常</summary><ul>${issues.map(issue => `<li>${escapeHtml(issue.code)} · ${escapeHtml(issue.path)}</li>`).join('')}</ul></details>` : ''}</div><footer class="source-card-footer"><span>参与扫描</span><label class="switch"><input type="checkbox" data-root="${escapeHtml(root.id)}" aria-label="扫描 ${escapeHtml(root.label)}" ${root.enabled !== false ? 'checked' : ''}><span class="switch-track"></span></label></footer></article>`;
  }).join('');
  get('autoScanToggle').checked = state.data.settings.autoScan;
  get('candidateSection').hidden = state.candidates.length === 0;
  get('candidateList').innerHTML = state.candidates.map((candidate, index) => `<div class="candidate-row"><div><strong>${escapeHtml(candidate.label)}</strong><p class="source-path">${escapeHtml(candidate.path)}</p></div><button class="button button-secondary" data-candidate="${index}">${icon('plus')}纳入</button></div>`).join('');
  icons();
  if (!state.candidatesLoaded) {
    state.candidatesLoaded = true;
    request('/api/candidates').then(candidates => { state.candidates = candidates; if (state.view === 'sources') renderSources(); }).catch(error => { toast(error.message, true); });
  }
}

function renderCurrent() {
  if (!state.data) return;
  if (state.view === 'library') renderLibrary();
  else if (state.view === 'history') renderHistory();
  else if (state.view === 'categories') renderCategories();
  else if (state.view === 'packages') renderPackages();
  else if (state.view === 'package') renderPackage();
  else renderSources();
}

function setView(view) {
  if (state.view === 'package' && view !== 'package' && state.packageCategoryDirty) {
    if (!window.confirm('整包分类尚未保存，仍要离开吗？')) return;
    state.packageCategoryDirty = false;
  }
  state.view = view;
  const titles = { library: ['技能目录', 'YOUR LOCAL TOOLKIT'], history: ['变化记录', 'COLLECTION ACTIVITY'], sources: ['来源目录', 'CONNECTED SOURCES'], categories: ['分类管理', 'TAXONOMY & RULES'], packages: ['技能包', 'PACKAGES & COLLECTIONS'], package: [state.data?.packages.find(group => group.id === state.packageId)?.name ?? '技能包', 'PACKAGE PROFILE'] };
  get('catalogMetrics').hidden = view === 'package';
  get('pageTitle').textContent = titles[view][0];
  get('breadcrumbCurrent').textContent = titles[view][0];
  get('pageEyebrow').textContent = titles[view][1];
  for (const name of Object.keys(titles)) get(`${name}View`).hidden = name !== view;
  document.querySelectorAll('[data-view]').forEach(button => {
    const active = button.dataset.view === view;
    button.classList.toggle('active', active);
    if (active) button.setAttribute('aria-current', 'page'); else button.removeAttribute('aria-current');
  });
  closeNav();
  if (state.data) { renderOverview(); renderCurrent(); }
}

function resetFilters() {
  Object.assign(state, { category: '', query: '', source: '', status: '', recent: false, page: 1, kind: '' });
  get('searchInput').value = '';
  renderOverview();
  renderLibrary();
}

async function scan(quiet = false) {
  if (state.scanning || state.managementBusy || !state.token) return;
  state.scanning = true;
  get('scanButton').disabled = true;
  get('scanLabel').textContent = '扫描中';
  get('scanIcon').classList.add('spin');
  loadSequence += 1;
  try {
    const data = await request('/api/scan', { method: 'POST', body: '{}' });
    accept(data);
    if (!quiet) {
      const counts = data.lastScan.counts;
      const changed = counts.added + counts.updated + counts.missing + counts.restored;
      toast(changed ? `扫描完成：新增 ${counts.added}，更新 ${counts.updated}，缺失 ${counts.missing}，重新发现 ${counts.restored}` : `扫描完成，${data.lastScan.discovered} 个技能无变化${data.lastScan.issues ? `，${data.lastScan.issues} 项读取异常` : ''}`);
    }
  } catch (error) { toast(error.message, true); }
  finally {
    state.scanning = false;
    get('scanButton').disabled = false;
    get('scanLabel').textContent = '扫描更新';
    get('scanIcon').classList.remove('spin');
  }
}

async function refresh(scanOnOpen = false) {
  const sequence = ++loadSequence;
  try {
    const data = await request('/api/catalog');
    if (sequence !== loadSequence) return;
    accept(data);
    if (scanOnOpen) await scan(true);
  } catch { if (sequence === loadSequence) connection(false); }
}

function showDetail(id) {
  const skill = state.data.skills.find(item => item.id === id);
  if (!skill) return;
  state.detailId = id;
  state.detailRevision += 1;
  state.noteDirty = false;
  state.introductionDirty = false;
  state.categoryDirty = false;
  state.introductionBase = { sourceHash: skill.descriptionHash, revision: skill.introduction?.revision ?? 0 };
  get('customSummaryInput').value = skill.customSummary;
  get('noteInput').value = skill.note;
  get('noteStatus').textContent = '';
  Object.assign(state, { document: null, documentMode: 'preview', documentLoading: false, documentError: '' });
  get('documentText').textContent = '';
  get('documentPreview').replaceChildren();
  renderDocumentState();
  get('introductionText').value = skill.introduction?.text ?? '';
  get('introductionWhen').value = skill.introduction?.whenToUse ?? '';
  get('introductionOriginal').textContent = skill.metadata.description;
  get('introductionStatus').textContent = '';
  get('introductionNotice').textContent = skill.introduction?.stale ? '原始描述已更新，中文简介待复核' : skill.introduction ? `${summaryOrigins[skill.introduction.source]} · ${date(skill.introduction.updatedAt)}` : '待补充中文简介';
  renderDetailOverview(skill);
  detailTab('overview');
  if (!get('detailDialog').open) get('detailDialog').showModal();
  icons();
}

function renderDetailOverview(skill) {
  const category = categoryFor(skill);
  const selected = state.categoryDirty ? get('skillCategory')?.value : skill.categoryMode === 'manual' ? skill.category : '';
  get('detailName').textContent = skill.metadata.name;
  get('detailIcon').className = `detail-category-icon tone-${skill.category}`;
  get('detailIcon').innerHTML = icon(category.icon);
  get('detailBadges').innerHTML = `${statusMarkup(skill.status)}<span>${escapeHtml(category.label)}</span><span>${skill.packageId ? '继承技能包分类' : skill.categoryMode === 'manual' ? '人工指定' : '自动分类'}</span>${skill.metadata.version ? `<span>v${escapeHtml(skill.metadata.version)}</span>` : ''}`;
  const intro = skill.introduction;
  get('detailOverview').innerHTML = `<section class="detail-section"><h3>${skill.customSummary ? '展示摘要' : intro ? '中文简介' : '原始用途'}<span class="summary-origin">${summaryOrigins[skill.summarySource] ?? '原始描述'}</span></h3><p class="detail-summary">${escapeHtml(skill.summary)}</p>${skill.customSummary && intro ? `<h3 class="intro-subheading">中文简介</h3><p class="original-description">${escapeHtml(intro.text)}</p>` : ''}${intro?.whenToUse ? `<h3 class="intro-subheading">适用场景</h3><p class="original-description">${escapeHtml(intro.whenToUse)}</p>` : ''}${intro?.stale ? '<p class="editor-status warning-text">原始描述已更新，中文简介待复核</p>' : !intro ? '<p class="editor-status warning-text">待补充中文简介</p>' : ''}</section><section class="detail-section"><h3>用途分类<span class="summary-origin">${skill.categoryMode === 'manual' ? '人工指定' : '自动规则'}</span></h3><form id="skillCategoryForm" class="classification-form"><select id="skillCategory" aria-label="用途分类"><option value="">自动规则：${escapeHtml(categoryNames.get(skill.suggestedCategory) ?? '其他技能')}</option>${state.data.categories.map(item => `<option value="${item.id}">${escapeHtml(item.label)}</option>`).join('')}</select><button type="submit" class="icon-button" id="saveSkillCategory" title="应用分类" aria-label="应用分类">${icon('check')}</button></form>${skill.classificationPending ? `<p class="editor-status warning-text">待应用规则：${escapeHtml(categoryNames.get(skill.suggestedCategory))}</p>` : ''}</section><section class="detail-section"><h3>原始描述</h3><p class="original-description">${escapeHtml(skill.metadata.description || '未提供描述')}</p></section><section class="detail-section"><h3>收录信息</h3><dl class="detail-facts"><dt>首次发现</dt><dd>${date(skill.firstSeen, true)}</dd><dt>最近变化</dt><dd>${date(skill.changedAt, true)}</dd><dt>最近确认存在</dt><dd>${date(skill.lastSeen, true)}</dd><dt>文件修改时间</dt><dd>${date(skill.modifiedAt, true)}</dd><dt>作者</dt><dd>${escapeHtml(skill.metadata.author || '未声明')}</dd><dt>许可</dt><dd>${escapeHtml(skill.metadata.license || '未声明')}</dd><dt>软件启用状态</dt><dd>未验证</dd><dt>同名安装</dt><dd>${skill.sameNameCount} 处</dd>${skill.metadata.parseError ? `<dt>元数据异常</dt><dd>${escapeHtml(skill.metadata.parseError)}</dd>` : ''}</dl></section><section class="detail-section"><h3>安装位置</h3>${skill.locations.map(location => `<div class="location-item"><div class="location-heading"><span>${escapeHtml(rootLabel(location.rootId))} · ${statusLabels[location.status]}</span><button class="icon-button" data-copy="${escapeHtml(location.path)}" title="复制路径" aria-label="复制路径">${icon('copy')}</button></div><code class="detail-path">${escapeHtml(location.path)}</code></div>`).join('')}<p class="status-note">${icon('info')}首次发现时间不等于安装时间。</p></section><section class="detail-section"><h3>真实路径</h3><code class="detail-path">${escapeHtml(skill.canonicalPath)}</code></section>`;
  if (skill.packageId) {
    get('skillCategoryForm').closest('section').innerHTML = `<h3>所属技能包<span class="summary-origin">分类随包统一维护</span></h3><button class="package-owner-link" data-package="${skill.packageId}">${icon('package')}<span>${escapeHtml(skill.packageName)}</span>${icon('arrow-up-right')}</button>${skill.parentSkillId ? `<p class="editor-status">父入口：${escapeHtml(state.data.skills.find(parent => parent.id === skill.parentSkillId)?.metadata.name ?? '')}</p>` : ''}`;
  } else get('skillCategory').value = selected ?? '';
  icons();
}

function detailTab(tab) {
  state.detailTab = tab;
  document.querySelectorAll('[data-detail-tab]').forEach(button => {
    const active = button.dataset.detailTab === tab;
    button.classList.toggle('active', active);
    button.setAttribute('aria-pressed', active);
  });
  for (const name of ['overview', 'introduction', 'document', 'notes']) get(`detail${name[0].toUpperCase()}${name.slice(1)}`).hidden = name !== tab;
  if (tab === 'document') loadDocument();
}

function renderDocumentState() {
  const loaded = state.document !== null;
  const empty = loaded && !state.document.content.trim();
  get('documentStatus').textContent = state.documentLoading ? '正在读取…' : state.documentError || (empty ? '文档为空' : '');
  get('documentStatus').hidden = !get('documentStatus').textContent;
  get('documentPreview').hidden = !loaded || empty || state.documentMode !== 'preview';
  get('documentText').hidden = !loaded || empty || state.documentMode !== 'source';
  get('reloadDocument').disabled = state.documentLoading;
  get('detailDocument').setAttribute('aria-busy', String(state.documentLoading));
  document.querySelectorAll('[data-document-mode]').forEach(button => {
    const active = button.dataset.documentMode === state.documentMode;
    button.classList.toggle('active', active);
    button.setAttribute('aria-pressed', active);
  });
}

async function loadDocument(force = false) {
  if (!state.detailId || state.documentLoading || state.document && !force) return;
  const revision = state.detailRevision;
  const id = state.detailId;
  Object.assign(state, { document: null, documentLoading: true, documentError: '' });
  get('documentText').textContent = '';
  get('documentPreview').replaceChildren();
  renderDocumentState();
  try {
    const data = await request(`/api/skills/${id}/document`);
    if (revision !== state.detailRevision) return;
    if (typeof data.content !== 'string' || typeof data.html !== 'string') throw new Error('文档预览暂不可用，请重新读取。');
    state.document = data;
    get('documentText').textContent = data.content;
    get('documentPreview').innerHTML = data.html;
  } catch (error) {
    if (revision === state.detailRevision) state.documentError = error.message;
  } finally {
    if (revision === state.detailRevision) { state.documentLoading = false; renderDocumentState(); }
  }
}

function closeDetail() {
  if (state.managementBusy) return;
  if ((state.noteDirty || state.introductionDirty || state.categoryDirty) && !window.confirm('有未保存的修改，仍要关闭吗？')) return;
  get('detailDialog').close();
  state.detailRevision += 1;
  state.detailId = null;
  state.noteDirty = false;
  state.introductionDirty = false;
  state.categoryDirty = false;
}

async function copy(value) {
  try { await navigator.clipboard.writeText(value); toast('路径已复制'); }
  catch { toast('无法访问剪贴板', true); }
}

function openSource(candidate) {
  get('sourceForm').reset();
  get('sourceError').hidden = true;
  if (candidate) {
    get('sourceName').value = candidate.label;
    get('sourcePath').value = candidate.path;
    get('sourceKind').value = candidate.kind;
  }
  get('sourceDialog').showModal();
}

function closeNav() {
  document.body.classList.remove('nav-open');
  get('navScrim').hidden = true;
  get('menuToggle').setAttribute('aria-expanded', 'false');
}

function renderCategories() {
  const data = state.data;
  get('categoryStats').innerHTML = `<span><strong>${data.libraryItems.filter(skill => skill.categoryMode === 'manual').length}</strong> 人工指定</span><span><strong>${data.libraryItems.filter(skill => skill.classificationPending).length}</strong> 待重分类</span><span><strong>${data.packages.length}</strong> 个整包</span><span><strong>${data.skills.filter(skill => !skill.packageId).length}</strong> 个独立技能</span>`;
  get('categoryList').innerHTML = data.categories.map((category, index) => {
    const selected = data.libraryItems.filter(skill => skill.category === category.id);
    const fallback = category.id === 'other';
    return `<article class="category-row" data-category-row="${category.id}"><div class="category-priority"><span>${fallback ? '兜底' : String(index + 1).padStart(2, '0')}</span><div><button class="icon-button" data-move-category="${category.id}" data-direction="-1" title="提高优先级" aria-label="提高 ${escapeHtml(category.label)} 的优先级" ${index === 0 || fallback ? 'disabled' : ''}>${icon('arrow-up')}</button><button class="icon-button" data-move-category="${category.id}" data-direction="1" title="降低优先级" aria-label="降低 ${escapeHtml(category.label)} 的优先级" ${index >= data.categories.length - 2 ? 'disabled' : ''}>${icon('arrow-down')}</button></div></div><div class="category-identity"><span class="category-small-icon">${icon(category.icon)}</span><div><h3>${escapeHtml(category.label)}</h3><span>${selected.filter(item => item.entityType === 'package').length} 个包 · ${selected.filter(item => item.entityType === 'skill').length} 个独立技能</span></div></div><div class="category-rules"><p><span>关键词</span>${escapeHtml(category.keywords.join(' · ') || '无')}</p><p><span>精确名称</span>${escapeHtml(category.names.join(' · ') || '无')}</p></div><div class="category-actions"><button class="icon-button" data-edit-category="${category.id}" title="编辑分类" aria-label="编辑 ${escapeHtml(category.label)}">${icon('pencil')}</button><button class="icon-button" data-merge-category="${category.id}" title="合并并移除" aria-label="合并并移除 ${escapeHtml(category.label)}" ${fallback ? 'disabled' : ''}>${icon('merge')}</button></div></article>`;
  }).join('');
  icons();
}

async function manageMutation(url, method, values) {
  if (state.managementBusy || state.scanning) throw new Error('另一项操作正在进行，请稍后重试。');
  state.managementBusy = true;
  loadSequence += 1;
  get('scanButton').disabled = true;
  try {
    const data = await request(url, { method, body: JSON.stringify(values) });
    accept(data);
    return data;
  } finally { state.managementBusy = false; get('scanButton').disabled = state.scanning; }
}

function openCategory(id) {
  const category = state.data.categories.find(item => item.id === id);
  state.categoryEdit = { id: id ?? `category-${crypto.randomUUID()}`, revision: state.data.taxonomyRevision, categories: structuredClone(state.data.categories), fresh: !category };
  get('categoryDialogTitle').textContent = category ? '编辑分类' : '新增分类';
  get('categoryName').value = category?.label ?? '';
  get('categoryIcon').innerHTML = state.data.categoryIcons.map(name => `<option value="${name}">${iconLabels[name] ?? name}</option>`).join('');
  get('categoryIcon').value = category?.icon ?? 'tag';
  get('categoryKeywords').value = category?.keywords.join('\n') ?? '';
  get('categoryNames').value = category?.names.join('\n') ?? '';
  get('categoryKeywords').disabled = id === 'other';
  get('categoryNames').disabled = id === 'other';
  get('categoryError').hidden = true;
  get('categoryDialog').showModal();
}

function openMerge(id) {
  const category = state.data.categories.find(item => item.id === id);
  if (!category || id === 'other') return;
  state.mergeEdit = { id, revision: state.data.taxonomyRevision, categories: structuredClone(state.data.categories) };
  get('mergeDescription').textContent = `${category.label} · ${state.data.libraryItems.filter(skill => skill.category === id).length} 个技能包或独立技能`;
  get('mergeTarget').innerHTML = state.data.categories.filter(item => item.id !== id).map(item => `<option value="${item.id}">${escapeHtml(item.label)}</option>`).join('');
  get('mergeTarget').value = 'other';
  get('mergeError').hidden = true;
  get('mergeDialog').showModal();
}

async function moveCategory(id, direction) {
  const categories = structuredClone(state.data.categories);
  const index = categories.findIndex(category => category.id === id);
  const target = index + direction;
  if (id === 'other' || index < 0 || target < 0 || target >= categories.length - 1) return;
  [categories[index], categories[target]] = [categories[target], categories[index]];
  try { await manageMutation('/api/categories', 'PUT', { revision: state.data.taxonomyRevision, categories }); toast('分类顺序已保存'); }
  catch (error) { toast(error.message, true); }
}

async function loadPreview() {
  const sequence = ++state.previewSequence;
  state.preview = null;
  get('previewError').hidden = true;
  get('applyPreview').disabled = true;
  get('refreshPreview').disabled = true;
  get('includeManual').disabled = true;
  get('previewSummary').textContent = '正在计算…';
  get('previewChanges').innerHTML = '';
  try {
    const preview = await request('/api/reclassify/preview', { method: 'POST', body: JSON.stringify({ includeManual: get('includeManual').checked }) });
    if (sequence !== state.previewSequence || !get('reclassifyDialog').open) return;
    state.preview = preview;
    get('previewSummary').textContent = `${preview.packageCount} 个包 + ${preview.standaloneCount} 个独立技能 · ${preview.changes.length} 项变更 · 保留 ${preview.preservedManual} 项人工指定`;
    get('previewChanges').innerHTML = preview.changes.length ? `<div class="preview-row preview-header"><span>整包 / 独立技能</span><span>当前分类</span><span>调整后</span></div>${preview.changes.map(change => `<div class="preview-row"><strong>${escapeHtml(change.name)}${change.entityType === 'package' ? `<small>整包 · ${change.memberCount} 个入口</small>` : ''}${change.wasManual ? '<small>人工 → 自动</small>' : ''}</strong><span>${escapeHtml(categoryNames.get(change.fromCategory))}</span><span>${escapeHtml(categoryNames.get(change.toCategory))}</span></div>`).join('')}` : '<div class="empty-state"><h3>没有需要调整的分类</h3></div>';
    get('applyPreview').disabled = preview.changes.length === 0;
  } catch (error) { get('previewError').textContent = error.message; get('previewError').hidden = false; get('previewSummary').textContent = '预览未完成'; }
  finally { get('refreshPreview').disabled = false; get('includeManual').disabled = false; }
}

function openPackage(id) {
  if (get('detailDialog').open) { closeDetail(); if (get('detailDialog').open) return; }
  if (state.packageCategoryDirty && !window.confirm('整包分类尚未保存，仍要切换吗？')) return;
  if (!state.data.packages.some(group => group.id === id)) { toast('该分组已解除或暂不可用'); return; }
  state.packageQuery = state.view === 'library' ? state.query : '';
  state.packageId = id;
  state.packageCategoryDirty = false;
  get('memberSearch').value = state.packageQuery;
  setView('package');
  window.scrollTo(0, 0);
}

function renderPackages() {
  get('packageList').innerHTML = state.data.packages.map(group => `<article class="package-management-row"><span class="package-symbol skill-symbol">${icon('package')}</span><div><button class="skill-name" data-package="${group.id}">${escapeHtml(group.name)}</button><p class="skill-summary">${escapeHtml(group.summary)}</p><div class="package-meta">${group.memberCount} 个入口 · ${group.entrySkillId ? '有主入口' : '集合，无主入口'} · ${escapeHtml(categoryNames.get(group.category))}</div></div><div class="toolbar-actions"><button class="icon-button" data-edit-package="${group.id}" title="编辑技能包" aria-label="编辑 ${escapeHtml(group.name)}">${icon('pencil')}</button><button class="icon-button" data-package="${group.id}" title="展开技能包" aria-label="展开 ${escapeHtml(group.name)}">${icon('chevron-right')}</button></div></article>`).join('') || '<div class="empty-state"><h3>暂无已确认技能包</h3></div>';
  const candidates = state.data.packageCandidates;
  get('packageCandidatesSection').hidden = !candidates.length;
  get('packageCandidateCount').textContent = candidates.length;
  get('packageCandidateList').innerHTML = candidates.map(group => `<article class="package-candidate-row"><div><h3>${escapeHtml(group.name)}</h3><p class="package-meta">${group.memberIds.length} 个入口 · ${escapeHtml(packageEvidenceLabels[group.evidence])}${group.conflicts.length ? ' · 归属冲突' : ''}</p><p class="source-path">${escapeHtml(group.canonicalPath)}</p></div><div class="toolbar-actions"><button class="button button-secondary" data-package-action="suppress" data-package-target="${group.id}">保持独立</button><button class="button button-primary" data-package-action="confirm" data-package-target="${group.id}" ${group.conflicts.length ? 'disabled' : ''}>${icon('package-check')}确认成包</button></div></article>`).join('');
  icons();
}

function renderPackage() {
  const group = state.data.packages.find(item => item.id === state.packageId);
  if (!group) return;
  get('pageTitle').textContent = group.name;
  get('breadcrumbCurrent').textContent = group.name;
  get('packageDescription').textContent = group.summary;
  get('packageBadges').innerHTML = `<span class="package-badge">${group.kind === 'bundle' ? '主技能包' : '技能集合'}</span>${statusMarkup(group.status)}<span>${escapeHtml(packageEvidenceLabels[group.evidence])}</span>`;
  get('packageLocations').innerHTML = group.canonicalPath ? `<span>包目录</span><code>${escapeHtml(group.canonicalPath)}</code>` : '<span>成员位于独立目录 · 手工确认归属</span>';
  get('packageCategory').innerHTML = `<option value="">自动规则：${escapeHtml(categoryNames.get(group.suggestedCategory))}</option>${state.data.categories.map(category => `<option value="${category.id}">${escapeHtml(category.label)}</option>`).join('')}`;
  get('packageCategory').value = state.packageCategoryDirty ? state.packageCategoryValue : group.categoryMode === 'manual' ? group.category : '';
  get('packageCategoryState').textContent = `${categoryNames.get(group.category)} · ${group.categoryMode === 'manual' ? '人工指定' : '自动分类'}${group.classificationPending ? ' · 待应用新规则' : ''}`;
  get('packageMainEntry').hidden = !group.entrySkillId;
  const words = state.packageQuery.toLowerCase().trim().split(/\s+/).filter(Boolean);
  const members = state.data.skills.filter(skill => skill.packageId === group.id);
  const ordered = [];
  const visited = new Set();
  const visit = (skill, depth) => {
    if (visited.has(skill.id)) return;
    visited.add(skill.id);
    ordered.push({ skill, depth });
    members.filter(child => child.parentSkillId === skill.id).forEach(child => visit(child, depth + 1));
  };
  members.filter(skill => !skill.parentSkillId || !members.some(parent => parent.id === skill.parentSkillId)).sort((left, right) => Number(right.id === group.entrySkillId) - Number(left.id === group.entrySkillId) || left.metadata.name.localeCompare(right.metadata.name)).forEach(skill => visit(skill, 0));
  members.forEach(skill => visit(skill, 0));
  const filtered = ordered.filter(({ skill }) => words.every(word => `${skill.metadata.name} ${skill.summary} ${skill.metadata.description} ${skill.introduction?.whenToUse ?? ''} ${skill.note}`.toLowerCase().includes(word)));
  get('packageMemberCount').textContent = `${filtered.length} / ${members.length}`;
  get('packageMembers').innerHTML = filtered.map(({ skill, depth }) => `<article class="package-member member-level-${Math.min(depth, 2)}" data-member-row="${skill.id}"><span class="member-symbol">${icon(skill.id === group.entrySkillId ? 'book-open' : depth ? 'corner-down-right' : 'file-code-2')}</span><div><button class="skill-name" data-skill="${skill.id}">${escapeHtml(skill.metadata.name)}</button><span class="member-role">${skill.id === group.entrySkillId ? '主入口' : skill.parentSkillId ? '子技能' : '成员'}</span><p class="skill-summary">${escapeHtml(skill.summary)}</p>${skill.parentSkillId ? `<p class="member-parent">父入口：${escapeHtml(state.data.skills.find(parent => parent.id === skill.parentSkillId)?.metadata.name ?? '')}</p>` : ''}</div><div class="member-state">${statusMarkup(skill.status)}</div><button class="icon-button" data-skill="${skill.id}" aria-label="查看 ${escapeHtml(skill.metadata.name)}" title="查看成员详情">${icon('chevron-right')}</button></article>`).join('') || '<div class="empty-state"><h3>没有匹配的包内成员</h3></div>';
  icons();
}

function openPackageEditor(action, id) {
  const target = [...state.data.packages, ...state.data.packageCandidates].find(group => group.id === id);
  const manual = action === 'create' || target?.evidence === 'manual' && action === 'edit';
  const blocked = new Set(state.data.packageCandidates.flatMap(group => group.memberIds));
  const members = manual ? state.data.skills.filter(skill => (!skill.packageId || skill.packageId === id) && !blocked.has(skill.id)) : state.data.skills.filter(skill => target?.memberIds.includes(skill.id));
  state.packageEdit = { action, id, revision: state.data.structureRevision, manual, members };
  state.packageDraft = null;
  get('packageDialogTitle').textContent = { create: '手工组包', edit: '编辑技能包', confirm: '确认技能包', suppress: '解除分组，保持独立' }[action];
  get('packageName').value = target?.name ?? '';
  get('packageName').readOnly = ['confirm', 'suppress'].includes(action);
  get('packageEvidence').textContent = target ? `${packageEvidenceLabels[target.evidence]} · ${target.memberIds.length} 个入口` : '独立技能成员';
  get('packageMemberPicker').innerHTML = members.map(skill => `<label class="member-choice"><input type="checkbox" value="${skill.id}" ${target?.memberIds.includes(skill.id) ? 'checked' : ''} ${!manual ? 'disabled' : ''}><span><strong>${escapeHtml(skill.metadata.name)}</strong><small>${escapeHtml(skill.canonicalPath)}</small></span></label>`).join('') || '<p class="editor-status">暂无可选择的独立技能</p>';
  get('packageError').hidden = true;
  get('packageDraftPreview').hidden = true;
  get('applyPackageButton').disabled = true;
  get('packageDialog').showModal();
}

function previewPackageEdit() {
  if (!get('packageForm').reportValidity()) return;
  const edit = state.packageEdit;
  const memberIds = [...get('packageMemberPicker').querySelectorAll('input:checked')].map(control => control.value);
  if (edit.manual && memberIds.length < 2) { get('packageError').textContent = errors.INVALID_PACKAGE_MEMBERS; get('packageError').hidden = false; return; }
  const name = get('packageName').value.trim();
  state.packageDraft = { action: edit.action, id: edit.id, revision: edit.revision, name, ...(edit.manual ? { memberIds } : {}) };
  const selected = edit.members.filter(skill => memberIds.includes(skill.id));
  get('packageDraftPreview').innerHTML = `<h3>${edit.action === 'suppress' ? '恢复为独立技能' : '整包管理'}：${escapeHtml(name)}</h3><p>${selected.length} 个入口 · 原文件不变</p><ul>${selected.map(skill => `<li>${escapeHtml(skill.metadata.name)}</li>`).join('')}</ul>`;
  get('packageDraftPreview').hidden = false;
  get('packageError').hidden = true;
  get('applyPackageButton').disabled = false;
}

document.addEventListener('click', event => {
  const button = event.target.closest('button');
  if (!button) return;
  if (button.dataset.view) {
    if (button.dataset.view === 'library') state.category = '';
    setView(button.dataset.view);
  }
  if (!state.data) return;
  if (button.dataset.category) { state.category = button.dataset.category; state.page = 1; setView('library'); }
  if (button.dataset.quick) {
    if (button.dataset.quick === 'packages') { setView('packages'); return; }
    if (button.dataset.quick === 'sources') { setView('sources'); return; }
    resetFilters();
    if (button.dataset.quick === 'recent') { state.recent = true; state.sort = 'firstSeen'; }
    if (button.dataset.quick === 'duplicates') state.status = 'duplicates';
    if (button.dataset.quick === 'all') state.status = 'present';
    if (button.dataset.quick === 'standalone') state.kind = 'skill';
    setView('library');
  }
  if (button.dataset.skill) showDetail(button.dataset.skill);
  if (button.dataset.package) openPackage(button.dataset.package);
  if (button.dataset.kind !== undefined) { state.kind = button.dataset.kind; state.page = 1; renderLibrary(); }
  if (button.dataset.editPackage) openPackageEditor('edit', button.dataset.editPackage);
  if (button.dataset.packageAction) openPackageEditor(button.dataset.packageAction, button.dataset.packageTarget);
  if (button.dataset.page) { state.page += button.dataset.page === 'next' ? 1 : -1; renderLibrary(); get('listTitle').scrollIntoView({ block: 'start' }); }
  if (button.dataset.detailTab) detailTab(button.dataset.detailTab);
  if (button.dataset.documentMode) { state.documentMode = button.dataset.documentMode; renderDocumentState(); }
  if (button.dataset.copy) copy(button.dataset.copy);
  if (button.dataset.action === 'reset') resetFilters();
  if (button.dataset.action === 'more-history') { state.historyLimit += 50; renderHistory(); }
  if (button.dataset.candidate !== undefined) openSource(state.candidates[Number(button.dataset.candidate)]);
  if (button.dataset.editCategory) openCategory(button.dataset.editCategory);
  if (button.dataset.mergeCategory) openMerge(button.dataset.mergeCategory);
  if (button.dataset.moveCategory) moveCategory(button.dataset.moveCategory, Number(button.dataset.direction));
  if (button.dataset.closeDialog && !state.managementBusy) { get(button.dataset.closeDialog).close(); if (button.dataset.closeDialog === 'reclassifyDialog') state.previewSequence += 1; }
});

get('createPackageButton').addEventListener('click', () => openPackageEditor('create'));
get('editPackageButton').addEventListener('click', () => openPackageEditor('edit', state.packageId));
get('ungroupPackageButton').addEventListener('click', () => openPackageEditor('suppress', state.packageId));
get('packageMainEntry').addEventListener('click', () => { const group = state.data.packages.find(item => item.id === state.packageId); if (group?.entrySkillId) showDetail(group.entrySkillId); });
get('memberSearch').addEventListener('input', event => { state.packageQuery = event.target.value; renderPackage(); });
get('packageCategory').addEventListener('change', event => { state.packageCategoryDirty = true; state.packageCategoryValue = event.target.value; });
get('packageCategoryForm').addEventListener('submit', async event => {
  event.preventDefault();
  const id = state.packageId;
  const selected = get('packageCategory').value;
  get('savePackageCategory').disabled = true;
  get('packageCategory').disabled = true;
  try {
    await manageMutation(`/api/packages/${id}/category`, 'PATCH', { categoryId: selected || null });
    if (state.packageId === id) { state.packageCategoryDirty = false; renderPackage(); }
    toast('整包分类已更新，所有成员同步继承');
  } catch (error) { toast(error.message, true); }
  finally { get('savePackageCategory').disabled = false; get('packageCategory').disabled = false; }
});
get('packageForm').addEventListener('input', () => { state.packageDraft = null; get('applyPackageButton').disabled = true; get('packageDraftPreview').hidden = true; });
get('previewPackageButton').addEventListener('click', previewPackageEdit);
get('packageForm').addEventListener('submit', async event => {
  event.preventDefault();
  if (!state.packageDraft) return;
  const draft = state.packageDraft;
  get('applyPackageButton').disabled = true;
  try { await manageMutation('/api/packages/structure', 'POST', draft); get('packageDialog').close(); state.packageDraft = null; toast('包归属已更新，原技能文件未改动'); }
  catch (error) { get('packageError').textContent = error.message; get('packageError').hidden = false; }
});
get('searchInput').addEventListener('input', event => { state.query = event.target.value; state.page = 1; if (state.data) renderLibrary(); });
get('clearSearch').addEventListener('click', () => { get('searchInput').value = ''; state.query = ''; state.page = 1; renderLibrary(); get('searchInput').focus(); });
get('recentChip').addEventListener('click', () => { state.recent = false; renderLibrary(); });
for (const [id, key] of [['sourceFilter', 'source'], ['statusFilter', 'status'], ['sortSelect', 'sort']]) get(id).addEventListener('change', event => { state[key] = event.target.value; state.page = 1; if (state.data) renderLibrary(); });
get('eventFilter').addEventListener('change', event => { state.eventType = event.target.value; state.historyLimit = 50; renderHistory(); });
get('scanButton').addEventListener('click', () => scan());
get('retryConnection').addEventListener('click', () => refresh(true));
get('closeDetail').addEventListener('click', closeDetail);
get('detailDialog').addEventListener('cancel', event => { event.preventDefault(); closeDetail(); });
get('detailDialog').addEventListener('click', event => { if (event.target === get('detailDialog') && event.clientX < get('detailDialog').getBoundingClientRect().left) closeDetail(); });
get('copyDocumentPath').addEventListener('click', () => { const skill = state.data.skills.find(item => item.id === state.detailId); if (skill) copy(skill.canonicalPath); });
get('reloadDocument').addEventListener('click', () => loadDocument(true));
get('documentPreview').addEventListener('click', event => {
  const link = event.target.closest('a[href^="#md-"]');
  if (!link) return;
  event.preventDefault();
  const target = get('documentPreview').querySelector(`#${CSS.escape(link.getAttribute('href').slice(1))}`);
  target?.scrollIntoView({ block: 'start' });
});
get('addSourceButton').addEventListener('click', () => openSource());
get('closeSource').addEventListener('click', () => get('sourceDialog').close());
get('cancelSource').addEventListener('click', () => get('sourceDialog').close());
get('menuToggle').addEventListener('click', () => { const open = document.body.classList.toggle('nav-open'); get('navScrim').hidden = !open; get('menuToggle').setAttribute('aria-expanded', open); });
get('navScrim').addEventListener('click', closeNav);
get('noteForm').addEventListener('input', () => { state.noteDirty = true; get('noteStatus').textContent = '尚未保存'; });
get('noteForm').addEventListener('submit', async event => {
  event.preventDefault();
  const id = state.detailId;
  const revision = state.detailRevision;
  const values = { customSummary: get('customSummaryInput').value, note: get('noteInput').value };
  get('saveNote').disabled = true;
  loadSequence += 1;
  try {
    const data = await request(`/api/skills/${id}`, { method: 'PATCH', body: JSON.stringify(values) });
    accept(data);
    if (revision === state.detailRevision) {
      const saved = data.skills.find(skill => skill.id === id);
      renderDetailOverview(saved);
      state.noteDirty = get('customSummaryInput').value !== values.customSummary || get('noteInput').value !== values.note;
      get('noteStatus').textContent = state.noteDirty ? '仍有未保存的修改' : '已保存';
    }
    toast('笔记已保存');
  } catch (error) { toast(error.message, true); }
  finally { get('saveNote').disabled = false; }
});
get('sourceForm').addEventListener('submit', async event => {
  event.preventDefault();
  get('submitSource').disabled = true;
  get('sourceError').hidden = true;
  loadSequence += 1;
  try {
    const data = await request('/api/roots', { method: 'POST', body: JSON.stringify(Object.fromEntries(new FormData(event.target))) });
    state.candidatesLoaded = false;
    state.candidates = [];
    accept(data);
    get('sourceDialog').close();
    toast('目录已添加，扫描完成');
  } catch (error) { get('sourceError').textContent = error.message; get('sourceError').hidden = false; }
  finally { get('submitSource').disabled = false; }
});
get('sourceList').addEventListener('change', async event => {
  const control = event.target;
  if (!control.dataset.root) return;
  control.disabled = true;
  loadSequence += 1;
  try { accept(await request(`/api/roots/${control.dataset.root}`, { method: 'PATCH', body: JSON.stringify({ enabled: control.checked }) })); }
  catch (error) { control.checked = !control.checked; toast(error.message, true); }
  finally { control.disabled = false; }
});
get('autoScanToggle').addEventListener('change', async event => {
  const control = event.target;
  control.disabled = true;
  loadSequence += 1;
  try { accept(await request('/api/settings', { method: 'PATCH', body: JSON.stringify({ autoScan: control.checked }) })); }
  catch (error) { control.checked = !control.checked; toast(error.message, true); }
  finally { control.disabled = false; }
});
get('addCategoryButton').addEventListener('click', () => openCategory());
get('categoryForm').addEventListener('submit', async event => {
  event.preventDefault();
  const edit = state.categoryEdit;
  const parseRules = value => value.split(/[\r\n,，;；]+/).map(item => item.trim()).filter(Boolean);
  const category = { id: edit.id, label: get('categoryName').value, icon: get('categoryIcon').value, keywords: parseRules(get('categoryKeywords').value), names: parseRules(get('categoryNames').value) };
  const categories = edit.fresh ? [...edit.categories.slice(0, -1), category, edit.categories.at(-1)] : edit.categories.map(item => item.id === edit.id ? category : item);
  get('saveCategory').disabled = true;
  get('categoryError').hidden = true;
  try {
    await manageMutation('/api/categories', 'PUT', { revision: edit.revision, categories });
    get('categoryDialog').close();
    toast('分类规则已保存，已有技能可预览重分类');
  } catch (error) { get('categoryError').textContent = error.message; get('categoryError').hidden = false; }
  finally { get('saveCategory').disabled = false; }
});
get('mergeForm').addEventListener('submit', async event => {
  event.preventDefault();
  const edit = state.mergeEdit;
  get('mergeCategory').disabled = true;
  get('mergeError').hidden = true;
  try {
    await manageMutation('/api/categories', 'PUT', { revision: edit.revision, categories: edit.categories.filter(item => item.id !== edit.id), migrations: { [edit.id]: get('mergeTarget').value } });
    get('mergeDialog').close();
    toast('分类已合并，技能与个人内容已保留');
  } catch (error) { get('mergeError').textContent = error.message; get('mergeError').hidden = false; }
  finally { get('mergeCategory').disabled = false; }
});
get('previewReclassifyButton').addEventListener('click', () => { get('includeManual').checked = false; get('reclassifyDialog').showModal(); loadPreview(); });
get('refreshPreview').addEventListener('click', loadPreview);
get('includeManual').addEventListener('change', loadPreview);
get('applyPreview').addEventListener('click', async () => {
  if (!state.preview) return;
  const preview = state.preview;
  get('applyPreview').disabled = true;
  get('previewError').hidden = true;
  try {
    await manageMutation('/api/reclassify/apply', 'POST', { previewId: preview.id });
    state.preview = null;
    get('reclassifyDialog').close();
    toast(`已应用 ${preview.changes.length} 项分类调整`);
  } catch (error) { state.preview = null; get('previewError').textContent = error.message; get('previewError').hidden = false; }
});
get('detailOverview').addEventListener('change', event => { if (event.target.id === 'skillCategory') state.categoryDirty = true; });
get('detailOverview').addEventListener('submit', async event => {
  if (event.target.id !== 'skillCategoryForm') return;
  event.preventDefault();
  const id = state.detailId;
  const revision = state.detailRevision;
  const selected = get('skillCategory').value;
  get('saveSkillCategory').disabled = true;
  get('skillCategory').disabled = true;
  try {
    const data = await manageMutation(`/api/skills/${id}/category`, 'PATCH', { categoryId: selected || null });
    if (revision === state.detailRevision) { state.categoryDirty = false; renderDetailOverview(data.skills.find(skill => skill.id === id)); }
    toast(selected ? '人工分类已保存' : '已恢复自动分类');
  } catch (error) { toast(error.message, true); }
  finally { if (revision === state.detailRevision) { get('saveSkillCategory').disabled = false; get('skillCategory').disabled = false; } }
});
get('introductionForm').addEventListener('input', () => { state.introductionDirty = true; get('introductionStatus').textContent = '尚未保存'; });
get('introductionForm').addEventListener('submit', async event => {
  event.preventDefault();
  const id = state.detailId;
  const revision = state.detailRevision;
  const values = { text: get('introductionText').value, whenToUse: get('introductionWhen').value, ...state.introductionBase };
  get('saveIntroduction').disabled = true;
  try {
    const data = await manageMutation(`/api/skills/${id}/introduction`, 'PATCH', values);
    if (revision === state.detailRevision) {
      const saved = data.skills.find(skill => skill.id === id);
      state.introductionBase = { sourceHash: saved.descriptionHash, revision: saved.introduction.revision };
      state.introductionDirty = values.text !== get('introductionText').value || values.whenToUse !== get('introductionWhen').value;
      get('introductionStatus').textContent = state.introductionDirty ? '仍有未保存的修改' : '已保存';
      get('introductionNotice').textContent = `个人修订 · ${date(saved.introduction.updatedAt)}`;
      renderDetailOverview(saved);
    }
  } catch (error) { get('introductionStatus').textContent = error.message; }
  finally { get('saveIntroduction').disabled = false; }
});
for (const id of ['categoryDialog', 'mergeDialog', 'reclassifyDialog', 'packageDialog']) get(id).addEventListener('cancel', event => { if (state.managementBusy) event.preventDefault(); if (id === 'reclassifyDialog') state.previewSequence += 1; });
window.addEventListener('beforeunload', event => { if (state.noteDirty || state.introductionDirty || state.categoryDirty || state.packageCategoryDirty) { event.preventDefault(); event.returnValue = ''; } });
window.addEventListener('keydown', event => { if (event.key === 'Escape') closeNav(); });
icons();
refresh(true);
setInterval(() => { if (!document.hidden && !state.scanning && !state.managementBusy && !state.packageCategoryDirty && !document.querySelector('dialog[open]')) refresh(); }, 20000);
