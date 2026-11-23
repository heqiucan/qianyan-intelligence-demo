import { useEffect } from 'react';
import { ArrowLeft, Copy, Printer } from 'lucide-react';
import { ReportPaper } from './ReportPaper';
import { reportRoute } from './shared';
import { Btn } from './sharedUI';
import type { FeedbackReport } from './types';

export function ReportDetail({ report, go }: { report: FeedbackReport; go: (page: string) => void }) {
  useEffect(() => {
    const prepare = () => { document.body.dataset.printReport = 'true'; };
    const done = () => { delete document.body.dataset.printReport; };
    window.addEventListener('beforeprint', prepare);
    window.addEventListener('afterprint', done);
    return () => {
      done();
      window.removeEventListener('beforeprint', prepare);
      window.removeEventListener('afterprint', done);
    };
  }, []);

  const print = () => {
    document.body.dataset.printReport = 'true';
    try {
      window.print();
    } finally {
      delete document.body.dataset.printReport;
    }
  };

  return (
    <div className="feedback-page feedback-report-page">
      <nav className="feedback-report-toolbar feedback-no-print" aria-label="报告操作">
        <Btn onClick={() => go(reportRoute())}><ArrowLeft size={15} />返回报告列表</Btn>
        <div className="feedback-actions">
          <Btn onClick={() => go(reportRoute('new', report.id))}><Copy size={15} />沿用文字新建</Btn>
          <Btn onClick={print}><Printer size={16} />打印 / 另存 PDF</Btn>
        </div>
      </nav>
      <ReportPaper report={report} />
    </div>
  );
}
