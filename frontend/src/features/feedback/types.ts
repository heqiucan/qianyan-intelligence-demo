import type { Analytics, Campaign, Creative, Plan, State } from '../../api';

export interface FeedbackProps {
  page: 'tasks' | 'optimize' | 'reports';
  state: State;
  campaignId: string;
  dataset: string;
  batchId: string;
  planId: string;
  dateFrom: string;
  dateTo: string;
  busy: boolean;
  act: (fn: () => Promise<unknown>, success?: string) => Promise<unknown>;
  go: (page: string) => void;
  setDataset: (value: string) => void;
  setBatchId: (value: string) => void;
  setPlanId: (value: string) => void;
  reportId?: string;
  view?: 'list' | 'create' | 'detail';
  dirtyChanged?: (dirty: boolean) => void;
}

interface FeedbackRecord {
  id: string;
  campaign_id: string;
  created_at: string;
}

export type TaskStatus = 'pending' | 'processing' | 'review' | 'resolved' | 'ignored';

export interface FeedbackTask extends FeedbackRecord {
  title: string;
  detail: string;
  status: TaskStatus;
  rule: string;
  object_type: string;
  object_id: string;
  batch_id?: string;
  plan_id?: string;
  note?: string;
  evidence?: unknown;
  history?: { from: TaskStatus; to: TaskStatus; note: string; created_at: string; operator: string }[];
}

export interface FeedbackBatch extends FeedbackRecord {
  label: string;
  plan_id: string;
  plan_snapshot?: Plan;
}

export interface FeedbackAdjustment extends FeedbackRecord {
  plan_id: string;
  insight_id?: string;
  status: 'draft' | 'applied';
  before: Partial<Plan>;
  after: Pick<Plan, 'budget' | 'start_date' | 'end_date'>;
  applied_config_version?: number;
}

export interface FeedbackObservation extends FeedbackRecord {
  status: 'waiting_confirmation' | 'observing' | 'reviewed';
  adjustment_id?: string | null;
  creative_id?: string | null;
  plan_id?: string | null;
  baseline_dataset: string;
  baseline_batch_id?: string | null;
  config_version?: number;
  start_at?: string | null;
  metric?: string;
  note?: string;
  review_note?: string;
  comparison?: unknown;
}

export interface FeedbackInsight extends FeedbackRecord {
  source?: string;
  model_name?: string;
  edited_by?: string;
  status?: string;
  facts: string[];
  hypotheses: string[];
  missing: string[];
  recommendation: string;
  dataset?: string;
  analytics_snapshot?: Analytics & { dataset_id?: string };
  result_adjustment_id?: string;
  result_creative_id?: string;
  dismiss_reason?: string;
  reason?: string;
}

export interface FeedbackReport extends FeedbackRecord {
  title: string;
  conclusion?: string;
  next_action?: string;
  simulation?: boolean;
  snapshot?: {
    campaign?: Campaign;
    analytics?: Analytics;
    model_label?: string;
    creatives?: Creative[];
    plans?: Plan[];
    tasks?: FeedbackTask[];
    adjustments?: FeedbackAdjustment[];
    observations?: FeedbackObservation[];
  };
}

interface FeedbackCollections {
  tasks: FeedbackTask[];
  batches: FeedbackBatch[];
  adjustments: FeedbackAdjustment[];
  observations: FeedbackObservation[];
  reports: FeedbackReport[];
}

// The shared API exposes legacy records; narrow them at this feature boundary.
export function records<K extends keyof FeedbackCollections>(state: State, collection: K): FeedbackCollections[K] {
  return (state[collection] || []) as unknown as FeedbackCollections[K];
}
