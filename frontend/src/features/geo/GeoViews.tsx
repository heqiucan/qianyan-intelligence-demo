import { useState } from 'react';
import { ArrowRight, Bot, Check, ChevronRight, Database, FileText, Pause, Play, Plus, Search, ShieldCheck } from 'lucide-react';
import { percent, platforms, steps, summarize, type Project, type Question, type Section } from './model';
export const stamp = (date: string) => new Date(date).toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' });
export const DraftStatus = ({ value }: { value: string }) => <span className={'geo-status ' + (value === 'draft' ? 'warn' : 'good')}>{({ draft: '待审核', approved: '已审核', recorded: '已登记' } as Record<string, string>)[value]}</span>;
type Props = { project: Project; update: (fn: (project: Project) => Project) => void; navigate: (section: Section, item?: string) => void };
export function KnowledgeView({ project, update, add }: Props & { add: () => void }) {
  return <><div className="geo-section-head"><div><h2>品牌事实与信源</h2><p className="geo-muted">{project.sources.filter(s => s.approved).length} 份已审核 · {project.sources.filter(s => !s.approved).length} 份待核对</p></div><button className="button primary" onClick={add}><Plus size={16}/>添加资料</button></div>
    <div className="geo-source-list">{project.sources.map(source => <article key={source.id} className="geo-source"><div className="geo-source-heading"><Database size={20}/><div><h3>{source.title}</h3><span className="geo-muted">{source.kind} · 本地资料</span></div><span className={'geo-status ' + (source.approved ? 'good' : 'warn')}>{source.approved ? '已审核' : '待核对'}</span></div><p>{source.text}</p><button className="geo-link" onClick={() => update(p => ({ ...p, sources: p.sources.map(s => s.id === source.id ? { ...s, approved: !s.approved } : s) }))}><ShieldCheck size={15}/>{source.approved ? '撤回审核' : '确认事实'}</button></article>)}</div>
    {!project.sources.length && <div className="geo-empty"><Database size={32}/><p>还没有品牌资料</p><button className="button" onClick={add}>添加第一份资料</button></div>}
  </>;
}
export function MonitorView({ project, navigate, add }: Props & { add: () => void }) {
  const [search, setSearch] = useState(''), [platform, setPlatform] = useState('全部平台'), [status, setStatus] = useState('全部状态'), [batchId, setBatchId] = useState('');
  const batch = project.batches.find(b => b.id === batchId) || project.batches.at(-1);
  const questions = project.questions.filter(q => q.text.includes(search));
  const rows = (batch?.observations || []).filter(row => questions.some(q => q.id === row.questionId) && (platform === '全部平台' || row.platform === platform) && (status === '全部状态' || (status === '疑似误述' ? row.status === 'ok' && row.inaccurate : status === '未提及' ? row.status === 'ok' && !row.mentioned : row.status === 'failed')));
  return <><div className="geo-section-head"><h2>目标问题 <span className="geo-muted">{project.questions.length}</span></h2><button className="button" onClick={add}><Plus size={16}/>添加问题</button></div>
    <div className="geo-filters"><label className="geo-search"><Search size={16}/><input aria-label="搜索目标问题" placeholder="搜索问题" value={search} onChange={e => setSearch(e.target.value)}/></label><select aria-label="监测平台" value={platform} onChange={e => setPlatform(e.target.value)}>{['全部平台', ...platforms].map(p => <option key={p}>{p}</option>)}</select><select aria-label="回答状态" value={status} onChange={e => setStatus(e.target.value)}>{['全部状态', '疑似误述', '未提及', '采样失败'].map(s => <option key={s}>{s}</option>)}</select><select aria-label="采样批次" value={batch?.id || ''} onChange={e => setBatchId(e.target.value)}>{!project.batches.length && <option value="">尚无采样</option>}{project.batches.map((b, i) => <option key={b.id} value={b.id}>批次 {i + 1} · {stamp(b.date)}</option>)}</select></div>
    <div className="geo-question-chips">{questions.map(q => <span key={q.id}><b>{q.priority}</b>{q.text}</span>)}</div>
    <div className="geo-table-scroll"><table className="geo-table"><thead><tr>{['问题 / 意图', '平台', '品牌提及', '来源引用', '诊断信号', '证据'].map(h => <th key={h}>{h}</th>)}</tr></thead><tbody>{rows.map(row => {
      const question = project.questions.find(q => q.id === row.questionId)!;
      return <tr key={row.id}><td><strong>{question.text}</strong><small>{question.intent}</small></td><td>{row.platform}</td><td>{row.status === 'failed' ? '—' : row.mentioned ? <span className="geo-good">已提及</span> : '未提及'}</td><td>{row.status === 'failed' ? '—' : row.cited ? '有引用' : '无引用'}</td><td><span className={'geo-status ' + (row.status === 'failed' || row.inaccurate ? 'warn' : '')}>{row.status === 'failed' ? '采样失败' : row.inaccurate ? '疑似误述' : row.mentioned ? '待持续观察' : '覆盖缺口'}</span></td><td><button className="geo-icon" title="查看回答证据" aria-label={`查看回答证据 ${question.text} ${row.platform}`} onClick={() => navigate('monitor', row.id)}><ChevronRight size={19}/></button></td></tr>;
    })}</tbody></table></div>{!rows.length && <p className="geo-empty">{!project.batches.length ? '添加目标问题后，可运行一次模拟采样。' : '当前筛选没有匹配记录。'}</p>}
  </>;
}
export function OptimizeView({ project, update, navigate, start }: Props & { start: (question: Question) => void }) {
  const rows = project.batches.at(-1)?.observations || [];
  const issues = project.questions.filter(q => rows.some(r => r.questionId === q.id && r.status === 'ok' && (r.inaccurate || !r.mentioned || !r.cited)));
  const ready = project.sources.some(s => s.approved);
  return <><div className="geo-section-head"><h2>诊断与优化队列</h2><span className="geo-status">本地任务模拟 · 不调用模型</span></div>
    {!ready && <p className="geo-notice">请先审核至少一份品牌资料，再创建优化任务。</p>}
    <div className="geo-issue-list">{issues.map(q => {
      const inaccurate = rows.some(r => r.questionId === q.id && r.inaccurate && r.status === 'ok');
      return <div className="geo-issue" key={q.id}><span className={'geo-status ' + (inaccurate ? 'warn' : '')}>{inaccurate ? '事实核对' : '内容覆盖'}</span><div><h3>{q.text}</h3><p className="geo-muted">{inaccurate ? '回答与产品接入边界不一致；需人工核实。' : '部分样例回答未提及品牌或未提供来源；原因待验证。'}</p></div><button className="button" disabled={!ready} onClick={() => start(q)}><Bot size={16}/>{project.tasks.some(t => t.questionId === q.id) ? '查看任务' : '创建优化任务'}</button></div>;
    })}</div>{!issues.length && <p className="geo-empty">尚无可诊断的回答，先到问题监测进行采样。</p>}
    <section className="geo-section"><div className="geo-section-head"><h2>Agent 协作任务</h2><span className="geo-muted">{project.tasks.length} 个任务</span></div>{project.tasks.map(task => <article className="geo-task" id={'geo-task-' + task.id} key={task.id}><div className="geo-section-head"><h3>{project.questions.find(q => q.id === task.questionId)?.text}</h3><span className={'geo-status ' + (task.status === 'review' ? 'good' : '')}>{task.status === 'review' ? '等待人工审核' : task.status === 'paused' ? '已暂停' : '模拟执行中'}</span></div>
      <ol className="geo-agent-steps">{steps.map((step, index) => <li key={step} className={index < task.step ? 'done' : index === task.step ? 'current' : ''}><span>{index < task.step ? <Check size={14}/> : index + 1}</span>{step}</li>)}</ol>
      <div className="geo-actions">{task.status !== 'review' ? <button className="button" onClick={() => update(p => ({ ...p, tasks: p.tasks.map(t => t.id === task.id ? { ...t, status: t.status === 'paused' ? 'running' : 'paused' } : t) }))}>{task.status === 'running' ? <Pause size={15}/> : <Play size={15}/>}{task.status === 'running' ? '暂停任务' : '继续任务'}</button> : <button className="button primary" onClick={() => navigate('content', task.draftId)}><FileText size={15}/>审核内容</button>}</div>
    </article>)}{!project.tasks.length && <p className="geo-empty">尚无优化任务</p>}</section>
  </>;
}
export function ContentView({ project, navigate }: Props) {
  const [filter, setFilter] = useState('all');
  const drafts = project.drafts.filter(d => filter === 'all' || d.status === filter);
  return <><div className="geo-section-head"><h2>内容审核与发布</h2><select aria-label="内容状态" value={filter} onChange={e => setFilter(e.target.value)}><option value="all">全部内容</option><option value="draft">待审核</option><option value="approved">已审核</option><option value="recorded">已登记</option></select></div><div className="geo-table-scroll"><table className="geo-table"><thead><tr><th>内容标题</th><th>事实依据</th><th>状态</th><th>操作</th></tr></thead><tbody>{drafts.map(d => <tr key={d.id}><td><strong>{d.title}</strong><small>{d.url || '尚未登记发布地址'}</small></td><td>{d.sources.length} 份资料快照</td><td><DraftStatus value={d.status}/></td><td><button className="geo-link" onClick={() => navigate('content', d.id)}>查看内容<ArrowRight size={15}/></button></td></tr>)}</tbody></table></div>{!drafts.length && <div className="geo-empty"><FileText size={32}/><p>当前没有内容产物</p><button className="button" onClick={() => navigate('optimize')}>前往诊断与 Agent</button></div>}</>;
}
export function ReportTable({ project }: { project: Project }) {
  return <><div className="geo-table-scroll"><table className="geo-table"><thead><tr>{['样例批次', '记录时间', '有效 / 全部', '品牌提及率', '引用率', '疑似误述'].map(h => <th key={h}>{h}</th>)}</tr></thead><tbody>{project.batches.map((batch, index) => { const m = summarize(batch.observations); return <tr key={batch.id}><td>批次 {index + 1}</td><td>{stamp(batch.date)}</td><td>{m.valid} / {m.total}</td><td>{percent(m.mentions, m.valid)}</td><td>{percent(m.citations, m.valid)}</td><td>{m.errors}</td></tr>; })}</tbody></table></div><div className="geo-next"><div><ShieldCheck size={20}/><span>咨询与成交：未接入。品牌提及不等于获客；发布登记不等于外部收录。</span></div></div></>;
}
