import { useEffect, useState } from 'react';
import { api, date, type ModelInfo } from '../api';
import { Badge, Details } from './ui';

const outcomes: Record<string, string> = {running: '处理中', success: '已完成', replay: '本地回放', failed: '未完成', interrupted: '服务中断'};

export default function ModelStatus({initial, compact = false}: {initial: ModelInfo; compact?: boolean}) {
  const [info, setInfo] = useState(initial);
  const [pollError, setPollError] = useState('');
  useEffect(() => { setInfo(initial); }, [initial]);
  useEffect(() => {
    let disposed = false, running = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let controller: AbortController | undefined;
    const poll = async () => {
      if (disposed || running || document.visibilityState === 'hidden') return;
      running = true;
      controller = new AbortController();
      try {
        const result = await api<ModelInfo>('/model/status', 'GET', undefined, {signal: controller.signal, timeoutMs: 10000});
        if (!disposed) { setInfo(result); setPollError(''); }
      } catch {
        if (!disposed && !controller.signal.aborted) setPollError('暂时无法更新模型状态，以下为上次读取结果。');
      } finally {
        running = false;
        if (!disposed && !document.hidden) timer = setTimeout(poll, 5000);
      }
    };
    const visibility = () => {
      clearTimeout(timer);
      if (document.visibilityState === 'hidden') controller?.abort();
      else void poll();
    };
    document.addEventListener('visibilitychange', visibility);
    void poll();
    return () => { disposed = true; clearTimeout(timer); controller?.abort(); document.removeEventListener('visibilitychange', visibility); };
  }, []);
  const current = info.busy ? `${info.mode === 'replay' ? '回放处理中' : '模型占用中'} · ${info.operation_label || '任务处理'}` : '当前空闲';
  if (compact) return <div className="model-status" aria-label="模型运行状态"><span className="status-dot"/><span>{info.label}<small>{current}</small>{info.busy && <small>开始：{date(info.operation_started_at || '')}</small>}<small>上次接口成功：{info.last_success_at ? date(info.last_success_at) : '暂无记录'}</small>{pollError && <small role="status">{pollError}</small>}<small>投放与付款均为模拟</small></span></div>;
  return <section aria-label="模型状态与调用记录" style={{marginTop: 20}}>
    <div className="panel-header" style={{flexWrap: 'wrap', gap: 10}}><h3>模型状态与调用记录</h3><Badge tone={info.busy ? 'amber' : 'neutral'}>{current}</Badge></div>
    {pollError && <p role="status">{pollError}</p>}
    <Details items={[
      ['当前状态', info.status],
      ['开始时间', date(info.operation_started_at || '')],
      ['最近接口成功', info.last_success_at ? date(info.last_success_at) : '暂无真实接口成功记录'],
      ['最近未完成', date(info.last_failure_at || '')],
      ['接口请求数', `${info.call_count ?? 0} 次（本地保存的当前型号记录）`],
      ['实际费用', info.cost_note || '接口未返回计费金额，不估算费用。'],
    ]}/>
    {info.last_error && <p className="notice">最近未完成原因：{info.last_error}</p>}
    <p className="muted">历史记录保留在本地；重启后的连接需再次验证。回放不计为接口成功。仅保存任务类别、时间、结果状态及接口用量，不保存提示词、资料正文或密钥。</p>
    <details><summary>最近 {info.recent_calls?.length || 0} 条记录</summary>
      {!info.recent_calls?.length && <p className="muted">尚无调用记录。不会为读取状态而调用模型。</p>}
      {info.recent_calls?.map(call => <article key={call.id} style={{padding: '12px 0', borderBottom: '1px solid var(--border)', overflowWrap: 'anywhere'}}>
        <strong>{call.operation_label}</strong> · {outcomes[call.outcome] || '未知状态'}
        <p className="muted">{date(call.started_at)} → {call.finished_at ? date(call.finished_at) : '尚未结束'} · {call.provider === 'replay' ? '本地回放，未调用接口' : `${call.model || '配置待修正'} · ${call.remote_calls} 次接口请求`}</p>
        {call.provider_succeeded && call.outcome !== 'success' && <p className="muted">接口结果曾通过结构校验，业务操作未完成；请核对保存结果。</p>}
        {call.error_message && <p>{call.error_message}</p>}
        <p className="muted">{call.usage ? `接口返回用量：输入 ${call.usage.prompt_tokens ?? '未提供'} / 输出 ${call.usage.completion_tokens ?? '未提供'} / 合计 ${call.usage.total_tokens ?? '未提供'} tokens` : call.provider === 'replay' ? '没有接口 token 用量' : '接口未提供 token 用量'} · 计费金额未提供</p>
      </article>)}
    </details>
  </section>;
}
