import { OptimizePage } from './features/feedback/OptimizePage';
import { ReportsPage } from './features/feedback/ReportsPage';
import { TasksPage } from './features/feedback/TasksPage';
import type { FeedbackProps } from './features/feedback/types';

export type { FeedbackProps } from './features/feedback/types';

export default function FeedbackPages(props: FeedbackProps) {
  if (props.page === 'tasks') return <TasksPage key={`tasks-${props.campaignId}`} {...props} />;
  if (props.page === 'reports') return <ReportsPage key={`reports-${props.campaignId}`} {...props} />;
  return <OptimizePage key={`optimize-${props.campaignId}`} {...props} />;
}
