import { useEffect, useState } from 'react';
import { ArrowLeft, FileText } from 'lucide-react';
import { reportRoute, scope, scopeLabel, useSubmit } from './shared';
import { Btn, Field } from './sharedUI';
import type { FeedbackProps, FeedbackReport } from './types';

export function ReportForm({ props, source, saved }: {
  props: FeedbackProps;
  source?: FeedbackReport;
  saved: (report: FeedbackReport) => void;
}) {
  const campaign = props.state.campaigns.find(item => item.id === props.campaignId);
  const [initial] = useState(() => ({
    title: source ? `${source.title} · 新版`.slice(0, 120) : `${campaign?.name || '营销活动'} · 活动复盘`.slice(0, 120),
    conclusion: source?.conclusion || '',
    nextAction: source?.next_action || '',
  }));
  const [title, setTitle] = useState(initial.title);
  const [conclusion, setConclusion] = useState(initial.conclusion);
  const [nextAction, setNextAction] = useState(initial.nextAction);
  const [error, setError] = useState('');
  const [submitted, setSubmitted] = useState(false);
  const submit = useSubmit();
  const dirty = !submitted && (Boolean(source) || title !== initial.title || conclusion !== initial.conclusion || nextAction !== initial.nextAction);
  const { dirtyChanged } = props;

  useEffect(() => { dirtyChanged?.(dirty); }, [dirty, dirtyChanged]);
  useEffect(() => () => dirtyChanged?.(false), [dirtyChanged]);

  const save = async () => {
    let created: FeedbackReport | undefined;
    await props.act(async () => {
      setError('');
      try {
        created = await submit<FeedbackReport>('/reports', {
          ...scope(props), title: title.trim(), conclusion, next_action: nextAction,
        });
        setSubmitted(true);
        dirtyChanged?.(false);
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : '保存失败，请重试。');
        throw cause;
      }
    }, '报告已保存');
    // The mutation can succeed even when refreshing the parent state fails.
    if (created) saved(created);
  };

  return (
    <div className="feedback-page feedback-report-page">
      <header className="feedback-section-heading">
        <div><h2>创建活动报告</h2><p className="muted feedback-small">模拟投放与支付</p></div>
        <Btn onClick={() => props.go(reportRoute())} disabled={props.busy}><ArrowLeft size={15} />返回报告列表</Btn>
      </header>
      <form className="feedback-report-form" onSubmit={event => { event.preventDefault(); void save(); }}>
        <p className="feedback-scope">统计范围：{scopeLabel(props)}</p>
        {source && <p className="feedback-caution">沿用「{source.title}」的文字，数据取自当前统计范围。</p>}
        <fieldset disabled={props.busy} className="feedback-form-fields">
          <div className="form-grid">
            <Field label="报告标题" full><input value={title} required maxLength={120} onChange={event => setTitle(event.target.value)} /></Field>
            <Field label="运营结论（人工判断）">
              <textarea value={conclusion} maxLength={5000} rows={6} onChange={event => setConclusion(event.target.value)} placeholder="本轮发现与待验证结论" />
            </Field>
            <Field label="下一步行动">
              <textarea value={nextAction} maxLength={5000} rows={6} onChange={event => setNextAction(event.target.value)} placeholder="拟调整事项与待补充数据" />
            </Field>
          </div>
        </fieldset>
        {error && <p className="error-banner" role="alert">{error}</p>}
        <p className="feedback-caution">保存当前数据快照；人工结论不代表已验证的经营效果。</p>
        <div className="feedback-actions">
          <Btn type="submit" primary disabled={props.busy || !props.campaignId || !title.trim() || (props.dataset === 'batch' && !props.batchId)}>
            <FileText size={16} />保存报告
          </Btn>
          <Btn onClick={() => props.go(reportRoute())} disabled={props.busy}>取消</Btn>
        </div>
      </form>
    </div>
  );
}
