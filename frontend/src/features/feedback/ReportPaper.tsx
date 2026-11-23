import { money, number } from '../../api';
import { readableTime, sourceText, statusText } from './shared';
import { Evidence } from './sharedUI';
import type { FeedbackReport } from './types';

export function ReportPaper({ report }: { report: FeedbackReport }) {
  const snapshot = report.snapshot;
  const analytics = snapshot?.analytics;
  const metrics = analytics?.metrics;
  const rows = analytics?.rows || [];
  const orders = analytics?.orders || [];
  const tasks = snapshot?.tasks || [];
  const adjustments = snapshot?.adjustments || [];
  const observations = snapshot?.observations || [];
  const stats = [
    ['模拟广告消耗', money(metrics?.spend)], ['模拟支付金额', money(metrics?.revenue)],
    ['支付订单', number(metrics?.orders)], ['识别新客', number(metrics?.new_customers)],
    ['支付 ROI', number(metrics?.roi)], ['去重买家', number(metrics?.buyers)],
  ];

  return (
    <article className="feedback-report-paper" aria-label="活动报告预览">
      <header className="feedback-report-heading">
        <h2>{report.title}</h2>
        <p>{snapshot?.campaign?.name || '营销活动'} · {readableTime(report.created_at)}</p>
        <div className="feedback-report-badges">
          <span>模拟投放与支付</span><span>{snapshot?.model_label || '生成来源未记录'}</span><span>已保存快照</span>
        </div>
      </header>

      <section>
        <h3>目标与统计范围</h3>
        <dl className="feedback-report-info">
          <div><dt>活动目标</dt><dd>{snapshot?.campaign?.goal || '未填写'}</dd></div>
          <div><dt>受众假设</dt><dd>{snapshot?.campaign?.audience || '未填写'}</dd></div>
          <div><dt>主推卖点</dt><dd>{snapshot?.campaign?.selling_point || '未填写'}</dd></div>
          <div><dt>数据来源</dt><dd>{analytics?.label || sourceText(analytics?.dataset)}</dd></div>
          <div><dt>统计窗口</dt><dd>{analytics?.window || '未提供'}</dd></div>
          <div><dt>报告编号</dt><dd>{report.id}</dd></div>
        </dl>
        {analytics?.note && <p className="feedback-report-note">{analytics.note}</p>}
      </section>

      <section>
        <h3>统计结果</h3>
        <div className="feedback-report-stats">
          {stats.map(([label, value]) => <div key={label}><span>{label}</span><strong>{value}</strong></div>)}
        </div>
        <p className="feedback-report-note">“—”表示无法计算或未提供。支付 ROI 不代表利润；新客识别不证明广告增量。</p>
        {!!rows.length && (
          <div className="table-wrap">
            <table className="data-table">
              <thead><tr>{['计划 / 素材', '点击', '消耗', '订单', '支付金额', '支付 ROI'].map(label => <th scope="col" key={label}>{label}</th>)}</tr></thead>
              <tbody>{rows.map((row, index) => (
                <tr key={row.plan_id || index}>
                  <td>{row.name}</td><td>{number(row.clicks)}</td><td>{money(row.spend)}</td>
                  <td>{number(row.orders)}</td><td>{money(row.revenue)}</td><td>{number(row.roi)}</td>
                </tr>
              ))}</tbody>
            </table>
          </div>
        )}
        <details className="feedback-report-detail">
          <summary>订单与消耗依据</summary>
          <div className="feedback-report-evidence">
            <h4>对应订单（{orders.length} 笔）</h4>
            {orders.length ? (
              <ul>{orders.map(order => <li key={order.id}>{order.id} · {order.buyer_id} · {money(order.amount)} · {order.plan_id}</li>)}</ul>
            ) : <p>当前范围没有订单记录。</p>}
            <h4>消耗明细</h4>
            {analytics?.spend_entries?.length ? <Evidence value={analytics.spend_entries} /> : <p>当前范围未提供消耗明细。</p>}
          </div>
        </details>
      </section>

      <section>
        <h3>工作记录与后续观察</h3>
        <p>所选范围内：素材 {snapshot?.creatives?.length || 0} 个版本、计划 {snapshot?.plans?.length || 0} 个、调整 {adjustments.length} 项、待办 {tasks.length} 项、观察 {observations.length} 项。</p>
        <div className="feedback-report-work">
          {tasks.map(task => <p key={task.id}><strong>{task.title}</strong> · {statusText[task.status] || task.status}{task.note ? ` · ${task.note}` : ''}</p>)}
          {adjustments.map(adjustment => (
            <p key={adjustment.id}><strong>计划调整</strong> · {adjustment.plan_id} · {money(adjustment.before?.budget)} → {money(adjustment.after?.budget)} · {statusText[adjustment.status]}</p>
          ))}
          {observations.map(observation => (
            <p key={observation.id}><strong>观察任务</strong> · {statusText[observation.status]} · {observation.note || '待补充同口径数据'}</p>
          ))}
          {!tasks.length && !adjustments.length && !observations.length && <p>尚无异常处理或观察记录。</p>}
        </div>
      </section>

      <section className="feedback-report-human">
        <h3>运营结论 · 人工填写</h3>
        <p>{report.conclusion || '尚未填写人工结论。'}</p>
        <h4>下一步行动</h4>
        <p>{report.next_action || '尚未填写下一步行动。'}</p>
      </section>
      <footer>本报告来自演示系统，广告与支付均为模拟，不代表真实经营效果。事实、假设和人工判断应分别理解。</footer>
    </article>
  );
}
