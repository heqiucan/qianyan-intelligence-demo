export const platforms = ['豆包', 'DeepSeek', 'Kimi'] as const;
export const steps = ['资料核对', '回答诊断', '内容起草', '事实核验', '人工审核'] as const;
export const sections = [
  ['projects', '项目管理'],
  ['monitor', '问题监测'],
  ['optimize', '诊断优化'],
  ['content', '内容管理'],
  ['reports', '效果报告'],
] as const;
export type Section = typeof sections[number][0] | 'overview' | 'knowledge';

export interface Question {
  id: string;
  text: string;
  intent: string;
  priority: string;
}

export interface Source {
  id: string;
  title: string;
  kind: string;
  text: string;
  approved: boolean;
}

export interface Observation {
  id: string;
  questionId: string;
  platform: string;
  status: 'ok' | 'failed';
  mentioned: boolean;
  cited: boolean;
  inaccurate: boolean;
  answer: string;
  reference: string;
}

export interface Batch {
  id: string;
  date: string;
  observations: Observation[];
}

export interface Draft {
  id: string;
  questionId: string;
  title: string;
  body: string;
  status: 'draft' | 'approved' | 'recorded';
  url: string;
  sources: string[];
  // Older v1 drafts retain title-only references without invented source text.
  sourceSnapshots?: Source[];
}

export interface Task {
  id: string;
  questionId: string;
  step: number;
  status: 'running' | 'paused' | 'review';
  draftId: string;
}

export interface Project {
  id: string;
  name: string;
  brand: string;
  questions: Question[];
  sources: Source[];
  batches: Batch[];
  drafts: Draft[];
  tasks: Task[];
}

export interface Store {
  version: 1;
  projects: Project[];
}

export const storageKey = 'zheyan-geo-prototype-v1';
export const id = () => crypto.randomUUID();
export const percent = (n: number, total: number) => total ? `${Math.round(n / total * 100)}%` : '—';

export function projectRoute(projectId: string, section: Section = 'overview', item?: string) {
  const params = new URLSearchParams({ project: projectId, view: section });
  if (item) params.set('item', item);
  return `geo?${params}`;
}

export function resolveGeoRoute(route: string, store: Store) {
  const params = new URLSearchParams(route.split('?')[1] || '');
  const projectId = params.get('project');
  const project = store.projects.find(candidate => candidate.id === projectId);
  const view = params.get('view');
  const validViews: readonly string[] = [...sections.map(([key]) => key), 'overview', 'knowledge'];
  const section: Section = validViews.includes(view || '')
    ? view as Section
    : project ? 'overview' : 'projects';
  return { project, projectId, section, item: params.get('item') };
}

export function restoreStore(raw: string | null): Store {
  if (raw === null) return initialStore();
  const value = JSON.parse(raw) as Store;
  const collections = ['questions', 'sources', 'batches', 'drafts', 'tasks'] as const;
  if (
    value?.version !== 1 ||
    !Array.isArray(value.projects) ||
    !value.projects.every(project =>
      project && typeof project.id === 'string' && typeof project.name === 'string' &&
      typeof project.brand === 'string' && collections.every(key => Array.isArray(project[key]))
    )
  ) {
    throw new Error('Invalid GEO local store');
  }
  // Reload never resumes a simulated job without an explicit user action.
  return {
    ...value,
    projects: value.projects.map(project => ({
      ...project,
      tasks: project.tasks.map(task => task.status === 'running' ? { ...task, status: 'paused' } : task),
    })),
  };
}

export function summarize(rows: Observation[]) {
  const valid = rows.filter(row => row.status === 'ok');
  return {
    total: rows.length,
    valid: valid.length,
    failed: rows.length - valid.length,
    mentions: valid.filter(row => row.mentioned).length,
    citations: valid.filter(row => row.cited).length,
    errors: valid.filter(row => row.inaccurate).length,
  };
}

export function sampleBatch(project: Project): Batch {
  const batchId = id();
  // Fixed fixtures, never fetched externally or improved automatically by publishing.
  const observations = project.questions.flatMap((question, qi) =>
    platforms.map((platform, pi): Observation => {
      const status = (qi * platforms.length + pi) % 11 === 10 ? 'failed' : 'ok';
      const mentioned = (qi + pi) % 3 !== 2;
      const cited = mentioned && (qi + pi) % 2 === 0;
      const inaccurate = mentioned && qi === 1 && pi === 0;
      let answer = '固定样例回答：建议比较商品资料、适用场景和可核验依据。本条未出现目标品牌。';
      if (status === 'failed') {
        answer = '固定样例失败：模拟请求超时。本条不计入提及率和引用率；未发送外部请求。';
      } else if (inaccurate) {
        answer = `固定错误样例（无事实依据）：${project.brand}的所有商品都适用于任何气温与场景。`;
      } else if (mentioned) {
        answer = `固定样例回答：可以了解${project.brand}，具体商品信息与适用范围需核对已审核资料。样例不代表平台实际回答或推荐。`;
      }
      return {
        id: `${batchId}-${qi}-${pi}`,
        questionId: question.id,
        platform,
        status,
        mentioned,
        cited,
        inaccurate,
        answer,
        reference: cited ? 'https://example.com/product-guide' : '',
      };
    })
  );
  return { id: batchId, date: new Date().toISOString(), observations };
}

export function createProject(name: string, brand: string): Project {
  return { id: id(), name, brand, questions: [], sources: [], batches: [], drafts: [], tasks: [] };
}

export function initialStore(): Store {
  const project = createProject('青禾紫色羽绒服 · 商品营销', '青禾');
  // Keep the original sample identifier usable by saved overview/knowledge links.
  project.id = 'sample-live';
  project.questions = [
    ['q1', '有哪些适合冬季通勤的紫色羽绒服？', '品类发现', '高'],
    ['q2', '青禾紫色羽绒服适用于哪些气温与场景？', '商品核实', '高'],
    ['q3', '青禾紫色羽绒服的尺码和搭配怎么选？', '方案比较', '中'],
    ['q4', '购买青禾紫色羽绒服前需要核对哪些商品资料？', '购买决策', '中'],
  ].map(([id, text, intent, priority]) => ({ id, text, intent, priority }));
  project.sources = [
    {
      id: 's1',
      title: '青禾紫色羽绒服 · 演示商品资料',
      kind: '产品文档',
      text: '虚构营销示例：青禾品牌的紫色羽绒服。保暖温度、充绒量、材质、价格与检测结果尚无已核实依据，不可作宣传事实。',
      approved: true,
    },
    {
      id: 's2',
      title: '青禾 · 演示营销边界',
      kind: '品牌资料',
      text: '青禾紫色羽绒服用于商品营销流程演示。冬季通勤与穿搭为待验证的受众场景假设；销量、评价和外部平台推荐均未接入。',
      approved: true,
    },
    {
      id: 's3',
      title: '选购问题 · 待核对',
      kind: 'FAQ',
      text: '待核对：尺码表、洗护说明、填充物信息、价格与售后政策。',
      approved: false,
    },
  ];
  const first = sampleBatch(project);
  first.date = '2026-11-23T14:00:00Z';
  const second = sampleBatch(project);
  second.date = '2026-11-24T14:00:00Z';
  project.batches = [first, second];
  return { version: 1, projects: [project] };
}

export function makeDraft(project: Project, question: Question, draftId: string): Draft {
  const sources = project.sources.filter(source => source.approved);
  return {
    id: draftId,
    questionId: question.id,
    title: question.text,
    status: 'draft',
    url: '',
    sources: sources.map(source => source.title),
    sourceSnapshots: sources.map(source => ({ ...source })),
    body: [
      `# ${question.text}`,
      '',
      '## 已核对信息',
      ...sources.map(source => `- ${source.text}`),
      '',
      '## 适用范围',
      '以上仅基于已审核资料，不代表平台推荐或效果保证。',
      '',
      '## 待补充',
      '请补充与本问题直接相关的实例和依据，再进行人工审核。',
    ].join('\n'),
  };
}

export function advanceTask(project: Project, taskId: string): Project {
  const task = project.tasks.find(item => item.id === taskId);
  if (!task || task.status !== 'running') return project;
  if (task.step < 3) {
    return {
      ...project,
      tasks: project.tasks.map(item => item.id === taskId ? { ...item, step: item.step + 1 } : item),
    };
  }
  const question = project.questions.find(item => item.id === task.questionId);
  if (!question) return project;
  return {
    ...project,
    tasks: project.tasks.map(item => item.id === taskId ? { ...item, step: 4, status: 'review' } : item),
    drafts: project.drafts.some(item => item.id === task.draftId)
      ? project.drafts
      : [...project.drafts, makeDraft(project, question, task.draftId)],
  };
}

export function exportText(name: string, text: string, type = 'text/markdown;charset=utf-8') {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = name;
  anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function report(project: Project) {
  const batch = project.batches.at(-1);
  const metrics = summarize(batch?.observations || []);
  const evidence = (batch?.observations || []).map(row => [
    `### ${row.platform} · ${project.questions.find(question => question.id === row.questionId)?.text}`,
    `状态：${row.status}`,
    row.answer,
    `引用：${row.reference || '无'}`,
  ].join('\n')).join('\n\n');
  return [
    `# ${project.name}`,
    '',
    '样例数据，未连接外部平台；不代表真实品牌表现。',
    '',
    `品牌：${project.brand}`,
    `采样时间：${batch?.date || '尚无采样'}`,
    `有效样本：${metrics.valid}/${metrics.total}`,
    `提及率：${percent(metrics.mentions, metrics.valid)}`,
    `引用率：${percent(metrics.citations, metrics.valid)}`,
    `疑似误述：${metrics.errors}`,
    `采样失败：${metrics.failed}`,
    '',
    '## 回答证据',
    evidence,
    '',
    '## 归因边界',
    '咨询和成交未接入。内容登记不等于外部收录；样例复测不推断优化效果。',
  ].join('\n');
}
