import { useState } from 'react';
import { ArrowLeft, ChevronRight, Plus } from 'lucide-react';
import { ReportDetail } from './ReportDetail';
import { ReportForm } from './ReportForm';
import { readableTime, reportRoute, sourceText, useFeedbackParams } from './shared';
import { Btn, Empty } from './sharedUI';
import { records, type FeedbackProps, type FeedbackReport } from './types';

export function ReportsPage(props: FeedbackProps) {
  const reports = records(props.state, 'reports').filter(item => item.campaign_id === props.campaignId);
  const params = useFeedbackParams();
  const reportId = props.reportId ?? params.get('report') ?? '';
  const view = props.view || (reportId === 'new' ? 'create' : reportId ? 'detail' : 'list');
  const copyId = params.get('from');
  const source = reports.find(item => item.id === copyId);
  const [created, setCreated] = useState<FeedbackReport>();
  const selected = reports.find(item => item.id === reportId)
    || (created?.id === reportId && created.campaign_id === props.campaignId ? created : undefined);

  if ((view === 'detail' && !selected) || (view === 'create' && copyId && !source)) {
    return (
      <div className="feedback-page feedback-report-page">
        <div className="feedback-section-heading"><h2>报告不可用</h2><Btn onClick={() => props.go(reportRoute())}><ArrowLeft size={15} />返回报告列表</Btn></div>
        <Empty>当前活动中未找到这份报告。</Empty>
      </div>
    );
  }

  if (view === 'create') {
    return <ReportForm key={`${props.campaignId}-${copyId || 'new'}`} props={props} source={source} saved={report => {
      setCreated(report);
      props.go(reportRoute(report.id));
    }} />;
  }

  if (view === 'detail' && selected) return <ReportDetail report={selected} go={props.go} />;

  return (
    <div className="feedback-page feedback-report-page">
      <header className="feedback-section-heading">
        <div><h2>活动报告 <span className="subtle">{reports.length} 份</span></h2><p className="muted feedback-small">模拟投放与支付 · 已保存快照</p></div>
        <Btn primary disabled={props.busy || !props.campaignId} onClick={() => props.go(reportRoute('new'))}><Plus size={16} />创建报告</Btn>
      </header>
      {reports.length ? (
        <div className="table-wrap feedback-report-list">
          <table className="data-table">
            <thead><tr><th scope="col">报告</th><th scope="col">统计窗口</th><th scope="col">生成时间</th><th scope="col">操作</th></tr></thead>
            <tbody>{reports.slice().reverse().map(report => (
              <tr key={report.id}>
                <td><strong>{report.title}</strong><span className="feedback-table-meta">{report.snapshot?.analytics?.label || sourceText(report.snapshot?.analytics?.dataset)}</span></td>
                <td>{report.snapshot?.analytics?.window || '未提供'}</td>
                <td>{readableTime(report.created_at)}</td>
                <td><Btn onClick={() => props.go(reportRoute(report.id))}>查看详情<ChevronRight size={15} /></Btn></td>
              </tr>
            ))}</tbody>
          </table>
        </div>
      ) : <Empty>当前活动暂无报告。</Empty>}
    </div>
  );
}
