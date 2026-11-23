import { useState } from 'react';
import { Plus, Sparkles } from 'lucide-react';
import { InsightReview } from './InsightReview';
import { ObservationCard } from './ObservationCard';
import { readableTime, scope, scopeLabel, sourceText, statusText, useSubmit } from './shared';
import { Btn, Empty, Field } from './sharedUI';
import { records, type FeedbackInsight, type FeedbackProps } from './types';

type OptimizeView = 'new' | 'history' | 'observations';

export function OptimizePage(props: FeedbackProps) {
  const insights: FeedbackInsight[] = (props.state.insights || []).filter(item => item.campaign_id === props.campaignId);
  const observations = records(props.state, 'observations').filter(item => item.campaign_id === props.campaignId);
  const [view, setView] = useState<OptimizeView>(insights.length ? 'history' : 'new');
  const [selectedId, setSelectedId] = useState(() => localStorage.getItem(`insight-${props.campaignId}`) || '');
  const submit = useSubmit();
  const insight = insights.find(item => item.id === selectedId) || insights.at(-1);
  const chooseInsight = (id: string) => {
    setSelectedId(id);
    localStorage.setItem(`insight-${props.campaignId}`, id);
  };
  const tabs: { id: OptimizeView; label: string }[] = [
    { id: 'new', label: '新建复盘' },
    { id: 'history', label: `历史结果（${insights.length}）` },
    { id: 'observations', label: `观察任务（${observations.length}）` },
  ];

  return (
    <div className="feedback-page">
      <nav className="feedback-view-tabs tabs" aria-label="优化复盘视图">
        {tabs.map(tab => (
          <button type="button" className={`tab ${view === tab.id ? 'active' : ''}`} aria-pressed={view === tab.id} key={tab.id} onClick={() => setView(tab.id)}>
            {tab.label}
          </button>
        ))}
      </nav>

      {view === 'new' && (
        <section className="feedback-section" aria-label="新建复盘">
          <div className="feedback-section-heading"><h2>新建复盘</h2><span className="badge neutral">模拟数据</span></div>
          <p className="feedback-scope">{scopeLabel(props)}</p>
          <p className="muted feedback-small">{props.state.model.label} · 原因分析为待验证假设。</p>
          <div className="feedback-actions">
            <Btn primary disabled={props.busy || !props.campaignId || (props.dataset === 'batch' && !props.batchId)} onClick={() => {
              void props.act(async () => {
                const result = await submit<FeedbackInsight>('/insights', scope(props));
                chooseInsight(result.id);
                setView('history');
              }, '复盘已保存');
            }}><Sparkles size={16} />生成本轮复盘</Btn>
          </div>
        </section>
      )}

      {view === 'history' && (
        <section className="feedback-section" aria-label="历史复盘结果">
          <div className="feedback-section-heading">
            <h2>历史结果</h2><Btn onClick={() => setView('new')}><Plus size={15} />新建复盘</Btn>
          </div>
          {insight ? <>
            <div className="feedback-review-picker">
              <Field label="历史复盘记录">
                <select value={insight.id} onChange={event => chooseInsight(event.target.value)}>
                  {insights.slice().reverse().map(item => (
                    <option key={item.id} value={item.id}>
                      {readableTime(item.created_at)} · {sourceText(item.dataset)} · {statusText[item.status || 'pending']} · {item.id.slice(-5)}
                    </option>
                  ))}
                </select>
              </Field>
            </div>
            <InsightReview key={insight.id} insight={insight} props={props} />
          </> : <Empty>当前活动暂无复盘结果。</Empty>}
        </section>
      )}

      {view === 'observations' && (
        <section className="feedback-section" aria-label="观察任务">
          <div className="feedback-section-heading"><h2>观察任务</h2><span className="badge neutral">{observations.length} 项</span></div>
          <div className="feedback-observation-list">
            {observations.slice().reverse().map(observation => <ObservationCard key={observation.id} observation={observation} props={props} />)}
          </div>
          {!observations.length && <Empty>暂无观察任务。采纳建议后，先确认草稿，再开始观察。</Empty>}
        </section>
      )}
    </div>
  );
}
