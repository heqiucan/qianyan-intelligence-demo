import { useState } from 'react';
import {
  ArrowRight, Bot, Check, ChevronRight, Database, FileText,
  Pause, Play, Plus, Search, ShieldCheck,
} from 'lucide-react';
import { percent, platforms, steps, summarize, type Project, type Question, type Section } from './model';

export const stamp = (date: string) => new Date(date).toLocaleString('zh-CN', {
  month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit',
});

export const DraftStatus = ({ value }: { value: string }) => (
  <span className={'geo-status ' + (value === 'draft' ? 'warn' : 'good')}>
    {({ draft: '待审核', approved: '已审核', recorded: '已登记' } as Record<string, string>)[value]}
  </span>
);

type Props = {
  project: Project;
  update: (fn: (project: Project) => Project) => void;
  navigate: (section: Section, item?: string) => void;
};

export function KnowledgeView({ project, update, add }: Props & { add: () => void }) {
  return (
    <>
      <div className="geo-section-head">
        <div>
          <h2>项目关联资料</h2>
          <p className="geo-muted">
            {project.sources.filter(source => source.approved).length} 份已审核 ·{' '}
            {project.sources.filter(source => !source.approved).length} 份待核对 · 本地资料，未连接共享知识库
          </p>
        </div>
        <button className="button primary" onClick={add}><Plus size={16} />添加资料</button>
      </div>
      <div className="geo-source-list">
        {project.sources.map(source => (
          <article key={source.id} className="geo-source">
            <div className="geo-source-heading">
              <Database size={20} />
              <div><h3>{source.title}</h3><span className="geo-muted">{source.kind} · 本地资料</span></div>
              <span className={'geo-status ' + (source.approved ? 'good' : 'warn')}>
                {source.approved ? '已审核' : '待核对'}
              </span>
            </div>
            <p>{source.text}</p>
            <button
              className="geo-link"
              onClick={() => update(current => ({
                ...current,
                sources: current.sources.map(candidate => candidate.id === source.id
                  ? { ...candidate, approved: !candidate.approved }
                  : candidate),
              }))}
            >
              <ShieldCheck size={15} />{source.approved ? '撤回审核' : '确认事实'}
            </button>
          </article>
        ))}
      </div>
      {!project.sources.length && <div className="geo-empty">
        <Database size={32} />
        <p>还没有品牌资料</p>
        <button className="button" onClick={add}><Plus size={16} />添加第一份资料</button>
      </div>}
    </>
  );
}

export function MonitorView({ project, navigate, add }: Props & { add: () => void }) {
  const [search, setSearch] = useState('');
  const [platform, setPlatform] = useState('全部平台');
  const [status, setStatus] = useState('全部状态');
  const [batchId, setBatchId] = useState('');
  const batch = project.batches.find(candidate => candidate.id === batchId) || project.batches.at(-1);
  const questions = project.questions.filter(question => question.text.includes(search));
  const rows = (batch?.observations || []).filter(row => {
    const matchesQuestion = questions.some(question => question.id === row.questionId);
    const matchesPlatform = platform === '全部平台' || row.platform === platform;
    const matchesStatus = status === '全部状态' || (
      status === '疑似误述' ? row.status === 'ok' && row.inaccurate
      : status === '未提及' ? row.status === 'ok' && !row.mentioned
      : row.status === 'failed'
    );
    return matchesQuestion && matchesPlatform && matchesStatus;
  });

  return (
    <>
      <div className="geo-section-head">
        <h2>目标问题 <span className="geo-muted">{project.questions.length}</span></h2>
        <button className="button" onClick={add}><Plus size={16} />添加问题</button>
      </div>
      <div className="geo-filters">
        <label className="geo-search">
          <Search size={16} />
          <input aria-label="搜索目标问题" placeholder="搜索问题" value={search} onChange={event => setSearch(event.target.value)} />
        </label>
        <select aria-label="监测平台" value={platform} onChange={event => setPlatform(event.target.value)}>
          {['全部平台', ...platforms].map(value => <option key={value}>{value}</option>)}
        </select>
        <select aria-label="回答状态" value={status} onChange={event => setStatus(event.target.value)}>
          {['全部状态', '疑似误述', '未提及', '采样失败'].map(value => <option key={value}>{value}</option>)}
        </select>
        <select aria-label="采样批次" value={batch?.id || ''} onChange={event => setBatchId(event.target.value)}>
          {!project.batches.length && <option value="">尚无采样</option>}
          {project.batches.map((candidate, index) => (
            <option key={candidate.id} value={candidate.id}>批次 {index + 1} · {stamp(candidate.date)}</option>
          ))}
        </select>
      </div>
      <div className="geo-question-chips">
        {questions.map(question => <span key={question.id}><b>{question.priority}</b>{question.text}</span>)}
      </div>
      <div className="geo-table-scroll">
        <table className="geo-table">
          <thead><tr>
            {['问题 / 意图', '平台', '品牌提及', '来源引用', '诊断信号', '证据'].map(heading => <th key={heading}>{heading}</th>)}
          </tr></thead>
          <tbody>
            {rows.map(row => {
              const question = project.questions.find(candidate => candidate.id === row.questionId)!;
              return (
                <tr key={row.id}>
                  <td><strong>{question.text}</strong><small>{question.intent}</small></td>
                  <td>{row.platform}</td>
                  <td>{row.status === 'failed' ? '—' : row.mentioned ? <span className="geo-good">已提及</span> : '未提及'}</td>
                  <td>{row.status === 'failed' ? '—' : row.cited ? '有引用' : '无引用'}</td>
                  <td>
                    <span className={'geo-status ' + (row.status === 'failed' || row.inaccurate ? 'warn' : '')}>
                      {row.status === 'failed' ? '采样失败' : row.inaccurate ? '疑似误述' : row.mentioned ? '待持续观察' : '覆盖缺口'}
                    </span>
                  </td>
                  <td>
                    <button
                      className="geo-icon"
                      title="查看回答证据"
                      aria-label={`查看回答证据 ${question.text} ${row.platform}`}
                      onClick={() => navigate('monitor', row.id)}
                    ><ChevronRight size={19} /></button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {!rows.length && <p className="geo-empty">
        {!project.batches.length ? '添加目标问题后，可运行一次模拟采样。' : '当前筛选没有匹配记录。'}
      </p>}
    </>
  );
}

export function OptimizeView({ project, update, navigate, start }: Props & { start: (question: Question) => void }) {
  const rows = project.batches.at(-1)?.observations || [];
  const issues = project.questions.filter(question => rows.some(row =>
    row.questionId === question.id && row.status === 'ok' && (row.inaccurate || !row.mentioned || !row.cited)
  ));
  const ready = project.sources.some(source => source.approved);
  return (
    <>
      <div className="geo-section-head">
        <h2>诊断与优化队列</h2>
        <span className="geo-status">本地任务模拟 · 不调用模型</span>
      </div>
      {!ready && <div className="geo-notice">
        <p>请先审核至少一份品牌资料，再创建优化任务。</p>
        <button className="geo-link" onClick={() => navigate('knowledge')}>查看关联资料<ArrowRight size={15} /></button>
      </div>}
      <div className="geo-issue-list">
        {issues.map(question => {
          const inaccurate = rows.some(row => row.questionId === question.id && row.inaccurate && row.status === 'ok');
          return (
            <div className="geo-issue" key={question.id}>
              <span className={'geo-status ' + (inaccurate ? 'warn' : '')}>{inaccurate ? '事实核对' : '内容覆盖'}</span>
              <div>
                <h3>{question.text}</h3>
                <p className="geo-muted">
                  {inaccurate ? '样例回答包含未经资料支持的断言；需人工核实。' : '部分样例回答未提及品牌或未提供来源；原因待验证。'}
                </p>
              </div>
              <button className="button" disabled={!ready} onClick={() => start(question)}>
                <Bot size={16} />{project.tasks.some(task => task.questionId === question.id) ? '查看任务' : '创建优化任务'}
              </button>
            </div>
          );
        })}
      </div>
      {!issues.length && <p className="geo-empty">尚无可诊断的回答，先到问题监测进行采样。</p>}
      <section className="geo-section">
        <div className="geo-section-head">
          <h2>Agent 协作任务</h2>
          <span className="geo-muted">{project.tasks.length} 个任务</span>
        </div>
        {project.tasks.map(task => (
          <article className="geo-task" id={'geo-task-' + task.id} key={task.id}>
            <div className="geo-section-head">
              <h3>{project.questions.find(question => question.id === task.questionId)?.text}</h3>
              <span className={'geo-status ' + (task.status === 'review' ? 'good' : '')}>
                {task.status === 'review' ? '等待人工审核' : task.status === 'paused' ? '已暂停' : '模拟执行中'}
              </span>
            </div>
            <ol className="geo-agent-steps">
              {steps.map((step, index) => (
                <li key={step} className={index < task.step ? 'done' : index === task.step ? 'current' : ''}>
                  <span>{index < task.step ? <Check size={14} /> : index + 1}</span>{step}
                </li>
              ))}
            </ol>
            <div className="geo-actions">
              {task.status !== 'review' ? (
                <button
                  className="button"
                  onClick={() => update(current => ({
                    ...current,
                    tasks: current.tasks.map(candidate => candidate.id === task.id
                      ? { ...candidate, status: candidate.status === 'paused' ? 'running' : 'paused' }
                      : candidate),
                  }))}
                >
                  {task.status === 'running' ? <Pause size={15} /> : <Play size={15} />}
                  {task.status === 'running' ? '暂停任务' : '继续任务'}
                </button>
              ) : (
                <button className="button primary" onClick={() => navigate('content', task.draftId)}>
                  <FileText size={15} />审核内容
                </button>
              )}
            </div>
          </article>
        ))}
        {!project.tasks.length && <p className="geo-empty">尚无优化任务</p>}
      </section>
    </>
  );
}

export function ContentView({ project, navigate }: Props) {
  const [filter, setFilter] = useState('all');
  const drafts = project.drafts.filter(draft => filter === 'all' || draft.status === filter);
  return (
    <>
      <div className="geo-section-head">
        <h2>内容管理</h2>
        <select aria-label="内容状态" value={filter} onChange={event => setFilter(event.target.value)}>
          <option value="all">全部内容</option>
          <option value="draft">待审核</option>
          <option value="approved">已审核</option>
          <option value="recorded">已登记</option>
        </select>
      </div>
      <div className="geo-table-scroll">
        <table className="geo-table">
          <thead><tr><th>内容标题</th><th>事实依据</th><th>状态</th><th>操作</th></tr></thead>
          <tbody>
            {drafts.map(draft => (
              <tr key={draft.id}>
                <td><strong>{draft.title}</strong><small>{draft.url || '尚未登记发布地址'}</small></td>
                <td>{draft.sources.length} 份{draft.sourceSnapshots ? '资料快照' : '资料标题记录'}</td>
                <td><DraftStatus value={draft.status} /></td>
                <td>
                  <button className="geo-link" onClick={() => navigate('content', draft.id)}>
                    查看内容<ArrowRight size={15} />
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {!drafts.length && <div className="geo-empty">
        <FileText size={32} />
        <p>当前没有内容产物</p>
        <button className="button" onClick={() => navigate('optimize')}>前往诊断优化<ArrowRight size={15} /></button>
      </div>}
    </>
  );
}

export function ReportTable({ project }: { project: Project }) {
  return (
    <>
      <div className="geo-table-scroll">
        <table className="geo-table">
          <thead><tr>
            {['样例批次', '记录时间', '有效 / 全部', '品牌提及率', '引用率', '疑似误述'].map(heading => <th key={heading}>{heading}</th>)}
          </tr></thead>
          <tbody>
            {project.batches.map((batch, index) => {
              const metrics = summarize(batch.observations);
              return (
                <tr key={batch.id}>
                  <td>批次 {index + 1}</td>
                  <td>{stamp(batch.date)}</td>
                  <td>{metrics.valid} / {metrics.total}</td>
                  <td>{percent(metrics.mentions, metrics.valid)}</td>
                  <td>{percent(metrics.citations, metrics.valid)}</td>
                  <td>{metrics.errors}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <div className="geo-next">
        <div><ShieldCheck size={20} /><span>咨询与成交：未接入。品牌提及不等于获客；发布登记不等于外部收录。</span></div>
      </div>
    </>
  );
}
