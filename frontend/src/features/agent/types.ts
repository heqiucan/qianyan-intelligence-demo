import type { Evidence, KnowledgeDraft, Scene } from '../knowledge/types';

export type TaskStatus = 'queued' | 'running' | 'waiting_input' | 'waiting_review' | 'completed' | 'failed' | 'cancelled' | 'interrupted';
export interface AgentEvent {
  id: string; action: string; detail: string; status: string; at: string; attempt: number;
  source_ids?: string[];
}
export interface AgentTask {
  id: string; goal: string; scene: Scene; source_mode: 'demo' | 'knowledge'; space_id: string; space_name: string;
  campaign_id?: string | null; campaign_name?: string | null; product_name?: string | null;
  channel: string; source: 'replay' | 'model'; model_name: string | null; status: TaskStatus;
  attempt: number; model_calls: number; total_model_calls: number; steps: number; message: string;
  created_at: string; updated_at: string; notes: string[]; events: AgentEvent[];
  evidence: Evidence[]; draft: KnowledgeDraft | null; result_ids: string[];
  can_complete: boolean; completion_stale?: boolean; completed_revision?: number;
  limits: { attempts: number; model_calls: number; steps: number; seconds: number; searches: number };
  check: null | { passed: boolean; blocking: string[]; checks: string[]; note: string };
}
export const active = (status: TaskStatus) => status === 'queued' || status === 'running';
export const statusLabels: Record<TaskStatus, string> = {
  queued: '等待执行', running: '正在处理', waiting_input: '需要补充', waiting_review: '待你审阅',
  completed: '已确认完成', failed: '执行未完成', cancelled: '已取消', interrupted: '服务中断 · 可继续',
};
export const actionLabels: Record<string, string> = {
  created: '接收任务', start: '开始处理', choose_action: '选择下一步动作', search_knowledge: '关键词检索',
  read_evidence: '读取原文依据', prepare_generation: '确定生成依据', generate_draft: '撰写内容',
  generated: '收到草稿', check_draft: '核对引用与表达', repair: '按检查结果修订', save_draft: '保存草稿',
  request_input: '请求补充信息', failure: '保留进度', resume: '继续任务', cancel: '取消后续步骤',
  complete: '完成人工确认', interrupted: '保留中断现场',
  review_evidence: '逐段复核事实依据',
};
export const presets: Record<Scene, string> = {
  medical: '根据机构资料，整理咨询预约的内部 FAQ，说明预约流程、接待时间，以及预约和专业评估的区别。缺少的信息列为待核实。',
  live: '为青禾保温杯写一份约一分钟的直播口语讲解脚本，分开场、规格展示、收尾三段。只使用有依据的规格，不写未经核实的价格和优惠。',
};
