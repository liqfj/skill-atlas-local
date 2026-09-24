import { createHash } from 'node:crypto';

const entries = {
  archify: [null, '需要把系统架构、调用时序、数据流或状态关系画成可交互图时。'],
  aihot: [null, '想了解近期 AI 新闻、模型与产品发布，或查看论文精选时。'],
  last30days: [null, '需要调查某个话题最近 30 天的真实讨论和趋势时。'],
  'emotion-companion': [null, '希望倾诉、缓解压力或获得陪伴式对话时；不替代专业诊疗。'],
  'xiaohongshu-skills': [null, '需要在小红书完成搜索、发布、互动或运营任务时。'],
  understand: [null, '需要建立代码库的架构、组件与调用关系全景时。'],
  'understand-chat': [null, '已有代码知识图谱，需要查找实现或询问组件关系时。'],
  'understand-dashboard': [null, '希望以交互页面浏览代码知识图谱时。'],
  'understand-diff': [null, '审查 Git 变更或 PR，判断改动范围和潜在风险时。'],
  'understand-domain': [null, '需要从代码中理解业务概念、领域关系和业务流程时。'],
  'understand-explain': [null, '需要深入解释某个文件、函数或模块时。'],
  'understand-knowledge': [null, '需要整理 Wiki 知识库中的实体、关系与主题时。'],
  'understand-onboard': [null, '为新成员准备项目入门和上手指南时。'],
  brainstorming: [null, '需求方向或实现方案尚未明确，需要先展开讨论时。'],
  'writing-plans': [null, '已有需求或规格，需要在实现前拆解多步骤计划时。'],
  'executing-plans': [null, '已有书面实施计划，需要在独立会话中按检查点执行时。'],
  'systematic-debugging': [null, '遇到缺陷、测试失败或意外行为，需要先定位根因时。'],
  'test-driven-development': [null, '实现功能或修复缺陷前，需要用失败测试明确行为时。'],
  'verification-before-completion': [null, '准备宣告完成、提交或创建 PR 前，需要核对验证证据时。'],
  'requesting-code-review': [null, '完成任务、实现重要功能或准备合并，需要代码评审时。'],
  'receiving-code-review': [null, '收到代码评审反馈，需要核实意见再决定修正方式时。'],
  'writing-skills': [null, '创建、修改技能或在部署前验证技能行为时。'],
  'using-git-worktrees': [null, '新功能工作需要与当前目录隔离，或准备执行实施计划时。'],
  'finishing-a-development-branch': [null, '实现和测试完成，需要决定合并、创建 PR 或清理分支时。'],
  'subagent-driven-development': [null, '在当前会话执行具有独立子任务的实施计划时。'],
  'dispatching-parallel-agents': [null, '有两个或更多不共享状态、没有顺序依赖的任务时。'],
  'ce-agent-native-architecture': ['设计以代理为主要执行者的应用，涵盖自主代理、MCP 工具与循环执行的功能。', '规划代理驱动的应用架构或开发代理工具时。'],
  'ce-agent-native-audit': ['按代理原生架构原则进行综合评审，并给出评分。', '需要评估应用对自主代理的支持程度时。'],
  'ce-brainstorm': ['通过协作讨论探索需求和方案，形成与任务规模相称的需求文档。', '需求模糊、范围不清或尚未确定实现方向时。'],
  'ce-clean-gone-branches': ['清理远端跟踪分支已消失的本地分支，并处理关联工作树。', '整理失效分支和对应 worktree 时；涉及删除操作。'],
  'ce-code-review': ['组织分层角色的代码评审，按置信度筛选、合并并去重发现的问题。', '创建 PR 前评审代码变更时。'],
  'ce-commit': ['根据实际变更生成清晰的提交说明并创建 Git 提交，优先遵循仓库约定。', '明确要求提交暂存或未暂存的工作时。'],
  'ce-commit-push-pr': ['完成提交、推送和创建 PR，也可仅撰写或改写 PR 描述。', '明确要求交付分支或整理 PR 描述时。'],
  'ce-compound': ['把刚解决的问题整理为团队可复用的经验文档。', '问题已解决，需要沉淀原因、方案与经验时。'],
  'ce-compound-refresh': ['对照当前代码审查已有经验文档，更新、合并或清理过时内容。', '明确要求整理 docs/solutions 下的经验与模式文档时。'],
  'ce-debug': ['系统复现问题、追踪错误并定位根因，支持从缺陷记录或堆栈开始排障。', '遇到错误、测试失败或多次修复仍未解决的问题时。'],
  'ce-demo-reel': ['为可观察的功能录制 GIF、终端演示或截图，作为 PR 的演示材料。', '交付界面或命令行功能，需要展示行为及前后变化时。'],
  'ce-dhh-rails-style': ['按 DHH 和 37signals 风格编写、重构或评审 Ruby / Rails 代码。', '处理 Rails 模型、控制器、REST 或 Hotwire 模式时。'],
  'ce-doc-review': ['通过多个角色的评审发现需求或计划文档中的问题。', '已有需求或计划文档，需要完善内容时。'],
  'ce-frontend-design': ['设计和实现前端界面，关注布局、字体、色彩与动效，并通过截图验证。', '新建或修改网页、后台、组件及交互体验时。'],
  'ce-gemini-imagegen': ['使用 Gemini 图像 API 生成和编辑图像，支持风格转换、多轮修订与多图组合。', '需要文生图、图片编辑、标志或产品示意图时；需要相应 API。'],
  'ce-ideate': ['围绕主题提出有依据的创意，并批判性评估各个方向。', '希望发现改进机会或先比较多个想法时。'],
  'ce-optimize': ['围绕可测量目标进行迭代实验，比较结果并保留改进。', '优化搜索相关性、聚类质量、构建性能或提示词效果时。'],
  'ce-plan': ['把多步骤目标整理为结构化计划，也可通过交互评审深化已有计划。', '软件功能、研究、活动或学习目标需要拆解执行时。'],
  'ce-polish-beta': ['启动开发服务，在浏览器中共同查看功能并迭代打磨。', '已有可运行功能，需要边看边改时；属于测试版流程。'],
  'ce-product-pulse': ['按指定时间窗口汇总用户体验、产品表现、质量、错误及待调查信号。', '需要日常产品简报、周报或发布后检查时。'],
  'ce-proof': ['通过 Proof 共享、批注、编辑和同步 Markdown，组织人工参与的文档评审。', '需要共同评审规格、计划或草稿时；涉及 Proof 外部服务。'],
  'ce-release-notes': ['汇总 compound-engineering 插件发布变化，或按版本回答历史变更问题。', '想了解插件最近更新或某个技能的版本变化时。'],
  'ce-report-bug': ['提交 compound-engineering 插件的问题报告。', '发现插件自身缺陷，需要报告问题时。'],
  'ce-resolve-pr-feedback': ['评估 PR 评审意见的有效性，并组织修复及处理评审线程。', '需要逐项回应和修复代码评审反馈时。'],
  'ce-riffrec-feedback-analysis': ['分析 Riffrec 产品反馈会话包及音视频，区分配置、快速报错与深入分析流程。', '收到录屏反馈、Riffrec 会话包，或需要设置反馈采集时。'],
  'ce-sessions': ['跨 Claude Code、Codex 和 Cursor 检索编程代理会话历史并回答相关问题。', '回顾过去做过什么、尝试过哪些方案或如何排查问题时。'],
  'ce-setup': ['检查 compound-engineering 的工具依赖、插件版本和仓库配置，并引导补齐环境。', '排查缺失工具、验证安装或准备上手时。'],
  'ce-simplify-code': ['在保持行为不变的前提下精简近期修改的代码，改善可读性、复用与效率。', '功能完成后需要整理和优化改动代码时。'],
  'ce-slack-research': ['检索 Slack 中的讨论、决策和约束，综合形成带分析的研究摘要。', '需要了解团队讨论脉络或组织背景时；需要 Slack 访问权限。'],
  'ce-strategy': ['创建或维护产品战略文档，明确问题、方案、用户、指标与工作方向。', '启动产品、调整路线或需要为后续计划补充战略依据时。'],
  'ce-test-browser': ['对当前 PR 或分支影响的页面运行浏览器测试。', '网页变更需要回归验证时。'],
  'ce-test-xcode': ['使用 XcodeBuildMCP 在模拟器上构建和测试 iOS 应用，检查行为与崩溃。', '修改 iOS 代码后或创建 PR 前验证应用时。'],
  'ce-update': ['检查 compound-engineering 插件版本，并在过期时建议更新命令。', '在 Claude Code 中检查插件更新或排查旧版问题时；不适用于其他工具的缓存布局。'],
  'ce-work': ['按任务推进实现，兼顾质量并完成所需功能。', '需求和实施方向明确，进入执行阶段时。'],
  'ce-work-beta': ['在常规实施流程中加入实验性的外部 Codex 委派模式。', '需要测试外部代理协作实施时；属于测试版流程。'],
  'ce-worktree': ['创建隔离 Git 工作树，用于并行开发或 PR 评审。', '希望开展新工作而不干扰当前检出目录时。'],
  lfg: ['自动执行计划、实现、评审、测试、提交、推送和 PR 流程，并跟踪修复 CI。', '仅在明确要求无人值守执行完整软件任务并给出功能说明时。'],
  'using-superpowers': ['规定会话开始时发现和调用技能的工作流程。', '使用 Superpowers 技能体系，需要确认技能调用规范时。'],
  'xhs-auth': ['管理小红书登录状态，支持登录检查、二维码或手机号登录及退出。', '需要登录小红书、检查当前身份或退出时。'],
  'xhs-content-ops': ['组合小红书搜索、详情、发布和互动能力完成复合运营任务。', '开展竞品分析、热点追踪、内容创作或互动管理时。'],
  'xhs-explore': ['搜索和浏览小红书笔记，查看详情、首页内容及用户资料。', '需要发现内容、了解笔记详情或浏览用户主页时。'],
  'xhs-interact': ['对小红书内容发表评论、回复、点赞或收藏。', '明确要求对指定内容进行社交互动时。'],
  'xhs-publish': ['发布小红书图文、视频或长文，支持定时发布、标签与可见性设置。', '需要向小红书发布内容时。'],
};

export function descriptionHash(skill) {
  return createHash('sha256').update(JSON.stringify([skill.metadata.name, skill.metadata.description])).digest('hex');
}

export function validateLocalIntroductions(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).length > 1000) throw new Error('INVALID_LOCAL_INTRODUCTIONS');
  return Object.fromEntries(Object.entries(value).map(([name, entry]) => {
    if (!name.trim() || name.length > 128 || !entry || typeof entry.text !== 'string' || !entry.text.trim() || entry.text.length > 4000 || typeof entry.whenToUse !== 'string' || entry.whenToUse.length > 2000) throw new Error('INVALID_LOCAL_INTRODUCTIONS');
    return [name, { text: entry.text.trim(), whenToUse: entry.whenToUse.trim() }];
  }));
}

export function seedIntroduction(skill, presetSummary = '', localEntries = {}) {
  if (skill.introduction) return skill.introduction;
  const local = Object.hasOwn(localEntries, skill.metadata.name) ? localEntries[skill.metadata.name] : null;
  const entry = Object.hasOwn(entries, skill.metadata.name) ? entries[skill.metadata.name] : null;
  const originalChinese = /\p{Script=Han}/u.test(skill.metadata.description);
  const text = local?.text || entry?.[0] || presetSummary || (originalChinese ? skill.metadata.description : '');
  if (!text) return null;
  return {
    text, whenToUse: local?.whenToUse ?? entry?.[1] ?? '', source: local ? 'local' : entry || presetSummary ? 'preset' : 'original',
    sourceHash: descriptionHash(skill), revision: 1, updatedAt: new Date().toISOString(),
  };
}
