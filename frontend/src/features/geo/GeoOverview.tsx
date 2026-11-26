import { ArrowRight, Bot, Database, FileCheck2, Globe2, MessageSquare, ScanSearch, ShieldAlert, Target } from 'lucide-react';
import { percent, platforms, summarize, type Project, type Section } from './model';

export function PlatformChart({ project }: { project: Project }) {
  const rows = project.batches.at(-1)?.observations || [];
  return <section className="geo-section"><div className="geo-section-head"><h2>平台可见性</h2><span className="geo-legend"><i/>品牌提及 <i className="citation"/>来源引用</span></div>
    <div className="geo-platform-chart">{platforms.map((platform, index) => {
      const m = summarize(rows.filter(row => row.platform === platform));
      return <div className="geo-platform-row" key={platform}><div className={'geo-platform-icon platform-' + index}>{platform.slice(0, 1)}</div><div className="geo-bars"><strong>{platform}<small>{m.valid} 个有效样本</small></strong><div className="geo-bar-track"><span style={{ width: percent(m.mentions, m.valid) === '—' ? '0%' : percent(m.mentions, m.valid) }}/></div><div className="geo-bar-track citation"><span style={{ width: percent(m.citations, m.valid) === '—' ? '0%' : percent(m.citations, m.valid) }}/></div></div><div className="geo-bar-values"><b>{percent(m.mentions, m.valid)}</b><span>{percent(m.citations, m.valid)}</span></div></div>;
    })}</div><p className="geo-muted">最新批次 · 失败采样不计入分母</p></section>;
}
export function TrendChart({ project }: { project: Project }) {
  return <section className="geo-section"><div className="geo-section-head"><h2>采样批次对比</h2><span className="geo-muted">品牌提及率 · 样例</span></div>
    {project.batches.length ? <div className="geo-trend" role="img" aria-label="最近六批品牌提及率对比">{project.batches.slice(-6).map((batch, i) => {
      const m = summarize(batch.observations), rate = percent(m.mentions, m.valid);
      return <div className="geo-trend-column" key={batch.id}><strong>{rate}</strong><div className="geo-trend-track"><span style={{ height: rate === '—' ? '0%' : rate }}/></div><small>批次 {Math.max(0, project.batches.length - 6) + i + 1}</small></div>;
    })}</div> : <p className="geo-empty">尚无采样批次</p>}
    <p className="geo-muted">样例复测使用固定规则，不代表内容优化产生了提升。</p></section>;
}
export default function GeoOverview({ project, navigate, sample }: { project: Project; navigate: (section: Section) => void; sample: () => void }) {
  const metrics = summarize(project.batches.at(-1)?.observations || []);
  const stats = [
    { label: '品牌提及率', value: percent(metrics.mentions, metrics.valid), foot: `${metrics.mentions} / ${metrics.valid} 个有效样本`, icon: MessageSquare, section: 'monitor' as Section },
    { label: '来源引用率', value: percent(metrics.citations, metrics.valid), foot: `${metrics.citations} 条回答包含引用`, icon: Globe2, section: 'monitor' as Section },
    { label: '待处理信号', value: String(metrics.errors + metrics.failed), foot: `${metrics.errors} 条疑似误述 · ${metrics.failed} 条失败`, icon: ShieldAlert, section: 'optimize' as Section },
    { label: '内容待审核', value: String(project.drafts.filter(draft => draft.status === 'draft').length), foot: `${project.drafts.length} 份内容产物`, icon: FileCheck2, section: 'content' as Section },
  ];
  return <>
    <div className="geo-project-heading"><div className="geo-project-identity"><img src="/brand-mark.svg" alt=""/><div><h2>{project.brand}</h2><p>AI 搜索可见性项目</p></div></div><button className="button primary" disabled={!project.questions.length} onClick={sample}><ScanSearch size={16}/>模拟采样</button></div>
    <div className="geo-stats">{stats.map((stat, index) => <button key={stat.label} className={'geo-stat accent-' + index} onClick={() => navigate(stat.section)}><span>{stat.label}<stat.icon size={19}/></span><strong>{stat.value}</strong><small>{stat.foot}<ArrowRight size={14}/></small></button>)}</div>
    <div className="geo-two-columns"><PlatformChart project={project}/><TrendChart project={project}/></div>
    <section className="geo-section"><div className="geo-section-head"><h2>优化工作流</h2><button className="geo-link" onClick={() => navigate('optimize')}>查看 Agent 任务<ArrowRight size={15}/></button></div><div className="geo-pipeline">{[
      { title: '信源准备', icon: Database, count: `${project.sources.filter(s => s.approved).length} 份已审核`, tab: 'knowledge' as Section },
      { title: '问题观测', icon: ScanSearch, count: `${project.questions.length} 个目标问题`, tab: 'monitor' as Section },
      { title: '诊断优化', icon: Bot, count: `${project.tasks.length} 个任务`, tab: 'optimize' as Section },
      { title: '内容审核', icon: FileCheck2, count: `${project.drafts.filter(d => d.status === 'approved').length} 份已通过`, tab: 'content' as Section },
      { title: '效果复测', icon: Target, count: `${project.batches.length} 个批次`, tab: 'reports' as Section },
    ].map((stage, index) => <button key={stage.title} onClick={() => navigate(stage.tab)}><stage.icon size={22}/><strong>{stage.title}</strong><small>{stage.count}</small><span className="geo-step-number">0{index + 1}</span></button>)}</div></section>
    <div className="geo-next"><div><ShieldAlert size={20}/><span>{metrics.errors ? '发现能力边界误述，建议优先核对产品事实。' : '保持资料审核与回答证据同步。'}</span></div><button className="geo-link" onClick={() => navigate(metrics.errors ? 'optimize' : 'knowledge')}>去处理<ArrowRight size={15}/></button></div>
  </>;
}
