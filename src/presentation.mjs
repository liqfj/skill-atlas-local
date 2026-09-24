import { automaticCategory, appliedClassification, categoryIcons } from './classification.mjs';
import { descriptionHash, seedIntroduction } from './introductions.mjs';
import { packageSubject, structureFingerprint } from './packages.mjs';

export const categories = [
  { id: 'development', label: '开发与架构', icon: 'code-2' },
  { id: 'testing', label: '测试与排障', icon: 'flask-conical' },
  { id: 'design', label: '设计与可视化', icon: 'pen-tool' },
  { id: 'research', label: '资讯与研究', icon: 'radar' },
  { id: 'automation', label: '自动化与运维', icon: 'workflow' },
  { id: 'writing', label: '文档与协作', icon: 'files' },
  { id: 'personal', label: '生活与陪伴', icon: 'heart-handshake' },
  { id: 'other', label: '其他技能', icon: 'shapes' },
];

const presets = {
  archify: ['design', '把架构、工作流、时序与状态关系制作成可交互、可导出的图。', '架构图 流程图 时序图 可视化 Mermaid'],
  aihot: ['research', '查询近期 AI 资讯、模型发布、产品动态与精选论文，生成中文简报。', 'AI 新闻 日报 热点 论文 大模型'],
  last30days: ['research', '研究近 30 天的热门话题，汇集社区讨论、视频与网页证据。', '近期 热点 调研 趋势 社交媒体'],
  'emotion-companion': ['personal', '提供情绪倾听、压力疏导和陪伴式对话。', '情绪 心理 陪伴 压力 焦虑'],
  'fitness-coach': ['personal', '运动与健身相关技能；具体能力以原始说明为准。', '运动 健身 健康'],
  'xiaohongshu-skills': ['automation', '处理小红书登录、搜索、发布、互动与复合运营流程。', '小红书 发布 搜索 评论 运营'],
  understand: ['development', '分析代码结构，生成可交互的组件与关系知识图谱。', '代码 理解 架构 知识图谱'],
  'understand-chat': ['development', '基于代码知识图谱问答，查找实现与组件关系。', '代码 问答 关系 图谱'],
  'understand-dashboard': ['design', '启动代码知识图谱的交互式可视化面板。', '图谱 面板 可视化'],
  'understand-diff': ['development', '分析 Git 变更与 PR，梳理影响组件和潜在风险。', '代码审查 变更 影响 diff PR'],
  'understand-domain': ['development', '从代码中提取业务领域知识并生成领域流程图。', '业务 领域 流程图'],
  'understand-explain': ['development', '深入解释指定文件、函数或模块的实现。', '代码 解读 解释 函数 模块'],
  'understand-knowledge': ['research', '分析知识库的实体、隐含关系与主题聚类。', '知识库 实体 聚类 Wiki'],
  'understand-onboard': ['writing', '根据代码库为新成员生成项目入门指南。', '入门 文档 新人 上手'],
  brainstorming: ['development', '在实现前澄清需求、比较方案并形成可执行的设计。', '需求 头脑风暴 方案 设计'],
  'writing-plans': ['writing', '把需求与设计拆分成可执行、可验证的实施计划。', '计划 任务 拆解'],
  'executing-plans': ['development', '按照已有实施计划逐步执行任务并核对结果。', '计划 执行 实现'],
  'systematic-debugging': ['testing', '通过复现、收集证据和验证假设定位问题根因。', '调试 排障 故障 Bug 根因'],
  'test-driven-development': ['testing', '通过先写失败测试、再实现行为的流程开展开发。', 'TDD 测试 驱动 回归'],
  'verification-before-completion': ['testing', '完成前运行验证并以实际结果核对交付结论。', '验证 验收 测试 完成'],
  'requesting-code-review': ['development', '组织代码审查，检查实现质量与需求符合度。', '代码审查 评审 Review'],
  'receiving-code-review': ['development', '核实代码审查意见并处理需要修正的问题。', '代码审查 反馈 评审'],
  'writing-skills': ['writing', '编写、改进并验证可复用的 Agent 技能。', '技能 创建 Skill 编写'],
  'using-git-worktrees': ['development', '通过 Git worktree 创建隔离工作目录。', 'Git 工作树 隔离 分支'],
  'finishing-a-development-branch': ['development', '完成分支验证并安排合并、提交或清理。', 'Git 分支 合并 收尾'],
  'subagent-driven-development': ['development', '通过有界子任务和审查组织子代理协作开发。', '子代理 协作 并行 开发'],
  'dispatching-parallel-agents': ['automation', '把相互独立的问题分配给多个代理并行处理。', '并行 子代理 分工'],
};

const categoryRules = [
  ['personal', ['fitness', 'emotion', 'workout', 'mental', '健身', '情绪', '陪伴']],
  ['testing', ['debug', 'test', 'verification', '排障', '测试', '验证', '故障']],
  ['design', ['visualiz', 'diagram', 'frontend-design', 'frontend design', 'figma', '可视化', '设计图', '架构图']],
  ['research', ['research', 'news', '论文', '调研', '资讯', '研究']],
  ['automation', ['automat', 'deploy', 'browser', 'ops-log', 'ops log', '运维', '日志', '自动化', '浏览器']],
  ['writing', ['document', 'writing', 'onboard', '文档', '写作', '指南']],
  ['development', ['code', 'develop', 'architect', 'git', '代码', '开发', '架构']],
];

export function createDefaultTaxonomy() {
  return [...categoryRules, ['other', []]].map(([id, keywords]) => ({
    ...categories.find(category => category.id === id),
    keywords: [...keywords],
    names: Object.entries(presets).filter(([, preset]) => preset[0] === id).map(([name]) => name),
  }));
}

export function prepareIntroduction(skill, localEntries = {}) {
  const preset = Object.hasOwn(presets, skill.metadata.name) ? presets[skill.metadata.name] : null;
  return seedIntroduction(skill, preset?.[1], localEntries);
}

export function presentCatalog(catalog, config) {
  const taxonomy = catalog.taxonomy ?? createDefaultTaxonomy();
  const packageSubjects = new Map((catalog.packages ?? []).map(group => [group.id, packageSubject(group, catalog.skills)]));
  const names = new Map();
  const hashes = new Map();
  for (const skill of catalog.skills.filter(item => item.status === 'present')) {
    const name = skill.metadata.name.toLowerCase();
    names.set(name, (names.get(name) ?? 0) + 1);
    hashes.set(skill.hash, (hashes.get(skill.hash) ?? 0) + 1);
  }
  const skills = catalog.skills.map(skill => {
    const preset = Object.hasOwn(presets, skill.metadata.name) ? presets[skill.metadata.name] : null;
    const owner = packageSubjects.get(skill.packageId);
    const classification = appliedClassification(owner ?? skill, taxonomy);
    const suggestedCategory = automaticCategory(owner ?? skill, taxonomy);
    const introduction = prepareIntroduction(skill);
    const sourceHash = descriptionHash(skill);
    const summary = skill.customSummary || introduction?.text || skill.metadata.description || '缺少用途描述';
    return {
      ...skill,
      entityType: 'skill',
      packageName: owner?.name ?? null,
      category: classification.categoryId,
      categoryMode: owner ? 'inherited' : classification.mode,
      ownerCategoryMode: owner ? classification.mode : null,
      suggestedCategory,
      classificationPending: classification.mode === 'auto' && classification.categoryId !== suggestedCategory,
      introduction: introduction ? { ...introduction, stale: introduction.sourceHash !== sourceHash } : null,
      descriptionHash: sourceHash,
      summary,
      summarySource: skill.customSummary ? 'custom' : introduction?.source ?? 'original',
      keywords: preset?.[2] ?? '',
      sameNameCount: names.get(skill.metadata.name.toLowerCase()) ?? 0,
      copyCount: hashes.get(skill.hash) ?? 0,
    };
  });
  const packages = [...packageSubjects.values()].map(group => {
    const members = skills.filter(skill => group.memberIds.includes(skill.id));
    const entry = members.find(skill => skill.id === group.entrySkillId);
    const classification = appliedClassification(group, taxonomy);
    const suggestedCategory = automaticCategory(group, taxonomy);
    const descriptions = {
      'compound-engineering': '涵盖需求讨论、计划编制、实现、评审与交付的工程协作技能集合。',
      superpowers: '覆盖需求澄清、计划、测试驱动开发、调试与代码评审的开发工作流集合。',
    };
    const summary = entry?.summary || (Object.hasOwn(descriptions, group.name) ? descriptions[group.name] : `包含 ${members.length} 个成员的技能集合。`);
    return { ...group, entityType: 'package', summary, summarySource: 'package',
      category: classification.categoryId, categoryMode: classification.mode, suggestedCategory,
      classificationPending: classification.mode === 'auto' && classification.categoryId !== suggestedCategory,
      memberCount: members.length, presentMemberCount: members.filter(skill => skill.status === 'present').length,
      firstSeen: members.map(skill => skill.firstSeen).sort()[0], changedAt: members.map(skill => skill.changedAt).sort().at(-1),
      locations: group.locations.length ? group.locations : members.flatMap(skill => skill.locations),
    };
  });
  const libraryItems = [...packages, ...skills.filter(skill => !skill.packageId)];
  const present = skills.filter(skill => skill.status === 'present');
  const stats = { packages: packages.filter(group => group.status === 'present').length, standalone: present.filter(skill => !skill.packageId).length, members: present.filter(skill => skill.packageId).length, entries: present.length };
  return { ...catalog, skills, packages, libraryItems, stats, structureRevision: structureFingerprint(catalog), categories: taxonomy, categoryIcons, settings: config.settings, configuredRoots: config.roots };
}
