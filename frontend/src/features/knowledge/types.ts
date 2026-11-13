export type Scene = 'medical' | 'live';
export type Channel = 'internal' | 'douyin';
export interface Space { id: string; name: string; scene: Scene; is_demo: boolean }
export interface TextPage { page: number | null; text: string }
export interface Document {
  id: string; title: string; space_id: string; scene: Scene; kind: 'facts' | 'rules' | 'script';
  channel: Channel; status: string; availability: string; version: number; chunk_count: number;
  valid_from: string | null; valid_until: string | null; filename: string; is_demo: boolean;
  pages: TextPage[]; chunks: { id: string; text: string; locator: string }[];
}
export interface Evidence {
  id: string; document_id: string; title: string; version: number; kind: string;
  filename: string; locator: string; text: string; matched_terms: string[];
  is_demo: boolean; valid_until: string | null;
}
export interface SearchResult {
  space: Space; query: string; channel: Channel; terms: string[]; hits: Evidence[];
  signature: string; can_generate: boolean; note: string;
}
export interface DraftBlock { text: string; citation_ids: string[] }
export interface KnowledgeDraft {
  id: string; title: string; space_id: string; scene: Scene; query: string; channel: Channel; task: string;
  blocks: DraftBlock[]; sources: Evidence[]; source: 'model' | 'replay'; model_name?: string;
  missing: string[]; source_warnings: string[]; status: string; revision: number;
  can_confirm: boolean; edited_by?: string; created_at: string; confirmed_at?: string;
  writing_mode?: 'evidence_composed';
  agent_task_id?: string; can_transfer?: boolean; transfer_note?: string; linked_campaign_id?: string;
  transfers?: { creative_id: string; campaign_id: string; campaign_name: string; revision: number }[];
}
export const kindLabels: Record<string, string> = { facts: '事实资料', rules: '审核要求', script: '历史脚本' };
export const sceneLabels: Record<Scene, string> = { medical: '医美获客', live: '直播电商' };
