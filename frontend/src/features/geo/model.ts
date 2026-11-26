export const platforms = ['豆包', 'DeepSeek', 'Kimi'] as const;
export const steps = ['资料核对', '回答诊断', '内容起草', '事实核验', '人工审核'] as const;
export const sections = [['overview', '项目总览'], ['knowledge', '品牌知识'], ['monitor', '问题监测'], ['optimize', '诊断与 Agent'], ['content', '内容发布'], ['reports', '效果报告']] as const;
export type Section = typeof sections[number][0];
export interface Question { id: string; text: string; intent: string; priority: string }
export interface Source { id: string; title: string; kind: string; text: string; approved: boolean }
export interface Observation { id: string; questionId: string; platform: string; status: 'ok' | 'failed'; mentioned: boolean; cited: boolean; inaccurate: boolean; answer: string; reference: string }
export interface Batch { id: string; date: string; observations: Observation[] }
export interface Draft { id: string; questionId: string; title: string; body: string; status: 'draft' | 'approved' | 'recorded'; url: string; sources: string[] }
export interface Task { id: string; questionId: string; step: number; status: 'running' | 'paused' | 'review'; draftId: string }
export interface Project { id: string; name: string; brand: string; questions: Question[]; sources: Source[]; batches: Batch[]; drafts: Draft[]; tasks: Task[] }
export interface Store { version: 1; projects: Project[] }
export const storageKey = 'zheyan-geo-prototype-v1';
export const id = () => crypto.randomUUID();
export const percent = (n: number, total: number) => total ? `${Math.round(n / total * 100)}%` : '—';
export function summarize(rows: Observation[]) {
  const valid = rows.filter(row => row.status === 'ok');
  return { total: rows.length, valid: valid.length, failed: rows.length - valid.length, mentions: valid.filter(row => row.mentioned).length, citations: valid.filter(row => row.cited).length, errors: valid.filter(row => row.inaccurate).length };
}
export function sampleBatch(project: Project): Batch {
  const batchId = id();
  // Fixed fixtures, never fetched externally or improved automatically by publishing.
  const observations = project.questions.flatMap((question, qi) => platforms.map((platform, pi): Observation => {
    const status = (qi * platforms.length + pi) % 11 === 10 ? 'failed' : 'ok';
    const mentioned = (qi + pi) % 3 !== 2, cited = mentioned && (qi + pi) % 2 === 0;
    const inaccurate = mentioned && qi === 1 && pi === 0;
    return { id: `${batchId}-${qi}-${pi}`, questionId: question.id, platform, status, mentioned, cited, inaccurate,
      answer: status === 'failed' ? '样例采样失败：请求超时。本条不计入提及率和引用率。' : inaccurate
        ? `样例回答：${project.brand}能够自动同步所有平台的实时成交数据。`
        : mentioned ? `样例回答：可以了解${project.brand}。它提供商品资料整理、内容草稿和场次复盘等能力，具体接入范围需以已审核产品说明为准。`
        : '样例回答：建议比较资料管理、人工审核、内容输出和数据接入能力。本次回答未出现目标品牌。', reference: cited ? 'https://example.com/product-guide' : '' };
  }));
  return { id: batchId, date: new Date().toISOString(), observations };
}
export function createProject(name: string, brand: string): Project {
  return { id: id(), name, brand, questions: [], sources: [], batches: [], drafts: [], tasks: [] };
}
export function initialStore(): Store {
  const project = createProject('直播运营工具 · 品牌可见性', '浙衍 AI'); project.id = 'sample-live';
  project.questions = [['q1', '有哪些适合小团队的直播运营工具？', '品类发现', '高'], ['q2', '浙衍 AI 能自动同步真实直播成交吗？', '能力核实', '高'], ['q3', '如何管理多场直播的话术与商品资料？', '方案比较', '中'], ['q4', '直播复盘工具能提供哪些数据依据？', '购买决策', '中']].map(([id, text, intent, priority]) => ({ id, text, intent, priority }));
  project.sources = [
    { id: 's1', title: '直播工作台产品说明', kind: '产品文档', text: '支持场次、货盘、话术和本地互动模拟。真实平台在线人数及直播成交尚未接入。', approved: true },
    { id: 's2', title: '品牌与服务范围', kind: '品牌资料', text: '浙衍 AI 面向内容与运营团队，提供资料管理、内容草稿、人工审核与复盘流程。', approved: true },
    { id: 's3', title: '客户常见问题整理', kind: 'FAQ', text: '待核对：各平台接入范围、服务价格、部署方式。', approved: false },
  ];
  const first = sampleBatch(project); first.date = '2026-11-23T14:00:00Z';
  const second = sampleBatch(project); second.date = '2026-11-24T14:00:00Z';
  project.batches = [first, second];
  return { version: 1, projects: [project] };
}
export function makeDraft(project: Project, question: Question, draftId: string): Draft {
  const sources = project.sources.filter(source => source.approved);
  return { id: draftId, questionId: question.id, title: question.text, status: 'draft', url: '', sources: sources.map(source => source.title), body: `# ${question.text}\n\n## 已核对信息\n${sources.map(source => `- ${source.text}`).join('\n')}\n\n## 适用范围\n以上仅基于已审核资料，不代表平台推荐或效果保证。\n\n## 待补充\n请补充与本问题直接相关的实例和依据，再进行人工审核。` };
}
export function advanceTask(project: Project, taskId: string): Project {
  const task = project.tasks.find(item => item.id === taskId);
  if (!task || task.status !== 'running') return project;
  if (task.step < 3) return { ...project, tasks: project.tasks.map(item => item.id === taskId ? { ...item, step: item.step + 1 } : item) };
  const question = project.questions.find(item => item.id === task.questionId); if (!question) return project;
  return { ...project, tasks: project.tasks.map(item => item.id === taskId ? { ...item, step: 4, status: 'review' } : item), drafts: project.drafts.some(item => item.id === task.draftId) ? project.drafts : [...project.drafts, makeDraft(project, question, task.draftId)] };
}
export function exportText(name: string, text: string, type = 'text/markdown;charset=utf-8') {
  const url = URL.createObjectURL(new Blob([text], { type })); const anchor = document.createElement('a'); anchor.href = url; anchor.download = name; anchor.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
}
export function report(project: Project) {
  const batch = project.batches.at(-1), metrics = summarize(batch?.observations || []);
  return `# ${project.name}\n\n样例数据，未连接外部平台；不代表真实品牌表现。\n\n品牌：${project.brand}\n采样时间：${batch?.date || '尚无采样'}\n有效样本：${metrics.valid}/${metrics.total}\n提及率：${percent(metrics.mentions, metrics.valid)}\n引用率：${percent(metrics.citations, metrics.valid)}\n疑似误述：${metrics.errors}\n采样失败：${metrics.failed}\n\n## 回答证据\n${(batch?.observations || []).map(row => `### ${row.platform} · ${project.questions.find(q => q.id === row.questionId)?.text}\n状态：${row.status}\n${row.answer}\n引用：${row.reference || '无'}`).join('\n\n')}\n\n## 归因边界\n咨询和成交未接入。内容登记不等于外部收录；样例复测不推断优化效果。`;
}
