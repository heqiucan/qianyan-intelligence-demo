import {
  ArrowRight, Bot, Database, FileCheck2, FolderOpen, Globe2,
  MessageSquare, ScanSearch, ShieldAlert, Target,
} from 'lucide-react';
import { percent, platforms, summarize, type Project, type Section } from './model';

export function PlatformChart({ project }: { project: Project }) {
  const rows = project.batches.at(-1)?.observations || [];
  return (
    <section className="geo-section">
      <div className="geo-section-head">
        <h2>平台可见性</h2>
        <span className="geo-legend"><i />品牌提及 <i className="citation" />来源引用</span>
      </div>
      <div className="geo-platform-chart">
        {platforms.map((platform, index) => {
          const metrics = summarize(rows.filter(row => row.platform === platform));
          return (
            <div className="geo-platform-row" key={platform}>
              <div className={'geo-platform-icon platform-' + index}>{platform.slice(0, 1)}</div>
              <div className="geo-bars">
                <strong>{platform}<small>{metrics.valid} 个有效样本</small></strong>
                <div className="geo-bar-track">
                  <span style={{ width: metrics.valid ? percent(metrics.mentions, metrics.valid) : '0%' }} />
                </div>
                <div className="geo-bar-track citation">
                  <span style={{ width: metrics.valid ? percent(metrics.citations, metrics.valid) : '0%' }} />
                </div>
              </div>
              <div className="geo-bar-values">
                <b>{percent(metrics.mentions, metrics.valid)}</b>
                <span>{percent(metrics.citations, metrics.valid)}</span>
              </div>
            </div>
          );
        })}
      </div>
      <p className="geo-muted">最新样例批次 · 失败采样不计入分母</p>
    </section>
  );
}

export function TrendChart({ project }: { project: Project }) {
  return (
    <section className="geo-section">
      <div className="geo-section-head">
        <h2>采样批次对比</h2>
        <span className="geo-muted">品牌提及率 · 样例</span>
      </div>
      {project.batches.length ? (
        <div className="geo-trend" role="img" aria-label="最近六批品牌提及率对比">
          {project.batches.slice(-6).map((batch, index) => {
            const metrics = summarize(batch.observations);
            const rate = percent(metrics.mentions, metrics.valid);
            return (
              <div className="geo-trend-column" key={batch.id}>
                <strong>{rate}</strong>
                <div className="geo-trend-track"><span style={{ height: rate === '—' ? '0%' : rate }} /></div>
                <small>批次 {Math.max(0, project.batches.length - 6) + index + 1}</small>
              </div>
            );
          })}
        </div>
      ) : <p className="geo-empty">尚无采样批次</p>}
      <p className="geo-muted">样例复测使用固定规则，不代表内容优化产生了提升。</p>
    </section>
  );
}

export default function GeoOverview({ project, navigate, sample }: {
  project: Project;
  navigate: (section: Section) => void;
  sample: () => void;
}) {
  const metrics = summarize(project.batches.at(-1)?.observations || []);
  const stats = [
    {
      label: '品牌提及率',
      value: percent(metrics.mentions, metrics.valid),
      foot: `${metrics.mentions} / ${metrics.valid} 个有效样本`,
      icon: MessageSquare,
      section: 'monitor' as Section,
    },
    {
      label: '来源引用率',
      value: percent(metrics.citations, metrics.valid),
      foot: `${metrics.citations} 条回答包含引用`,
      icon: Globe2,
      section: 'monitor' as Section,
    },
    {
      label: '待处理信号',
      value: String(metrics.errors + metrics.failed),
      foot: `${metrics.errors} 条疑似误述 · ${metrics.failed} 条失败`,
      icon: ShieldAlert,
      section: 'optimize' as Section,
    },
    {
      label: '内容待审核',
      value: String(project.drafts.filter(draft => draft.status === 'draft').length),
      foot: `${project.drafts.length} 份内容产物`,
      icon: FileCheck2,
      section: 'content' as Section,
    },
  ];
  const stages = [
    { title: '信源准备', icon: Database, count: `${project.sources.filter(source => source.approved).length} 份已审核`, tab: 'knowledge' as Section },
    { title: '问题观测', icon: ScanSearch, count: `${project.questions.length} 个目标问题`, tab: 'monitor' as Section },
    { title: '诊断优化', icon: Bot, count: `${project.tasks.length} 个任务`, tab: 'optimize' as Section },
    { title: '内容审核', icon: FileCheck2, count: `${project.drafts.filter(draft => draft.status === 'approved').length} 份已通过`, tab: 'content' as Section },
    { title: '效果复测', icon: Target, count: `${project.batches.length} 个批次`, tab: 'reports' as Section },
  ];

  return (
    <>
      <div className="geo-project-heading">
        <div className="geo-project-identity">
          <FolderOpen size={30} aria-hidden="true" />
          <div><h2>{project.brand}</h2><p>{project.name} · 项目总览</p></div>
        </div>
        <div className="geo-actions">
          <button className="button" onClick={() => navigate('knowledge')}><Database size={16} />关联资料</button>
          <button className="button primary" disabled={!project.questions.length} onClick={sample}><ScanSearch size={16} />模拟采样</button>
        </div>
      </div>
      <div className="geo-project-materials">
        <div>
          <h3>项目关联资料</h3>
          <p className="geo-muted">{project.sources.length} 份本地资料 · {project.sources.filter(source => source.approved).length} 份已审核 · 未连接共享知识库</p>
        </div>
        <button className="geo-link" onClick={() => navigate('knowledge')}>查看资料<ArrowRight size={15} /></button>
      </div>
      <div className="geo-stats">
        {stats.map((stat, index) => (
          <button key={stat.label} className={'geo-stat accent-' + index} onClick={() => navigate(stat.section)}>
            <span>{stat.label}<stat.icon size={19} /></span>
            <strong>{stat.value}</strong>
            <small>{stat.foot}<ArrowRight size={14} /></small>
          </button>
        ))}
      </div>
      <div className="geo-two-columns"><PlatformChart project={project} /><TrendChart project={project} /></div>
      <section className="geo-section">
        <div className="geo-section-head">
          <h2>优化工作流</h2>
          <button className="geo-link" onClick={() => navigate('optimize')}>查看优化任务<ArrowRight size={15} /></button>
        </div>
        <div className="geo-pipeline">
          {stages.map((stage, index) => (
            <button key={stage.title} onClick={() => navigate(stage.tab)}>
              <stage.icon size={22} />
              <strong>{stage.title}</strong>
              <small>{stage.count}</small>
              <span className="geo-step-number">0{index + 1}</span>
            </button>
          ))}
        </div>
      </section>
      <div className="geo-next">
        <div><ShieldAlert size={20} /><span>{metrics.errors ? '样例中包含疑似误述，建议优先核对资料依据。' : '保持资料审核与回答证据同步。'}</span></div>
        <button className="geo-link" onClick={() => navigate(metrics.errors ? 'optimize' : 'knowledge')}>去处理<ArrowRight size={15} /></button>
      </div>
    </>
  );
}
