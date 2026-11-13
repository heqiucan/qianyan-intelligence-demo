import { type ReactNode } from 'react';
import { BookOpen, Package, Sparkles } from 'lucide-react';
import { type ModelInfo } from '../../api';
import KnowledgeWorkspace from './KnowledgeWorkspace';
import type { HandoffContext } from '../journey/CreativeHandoff';
import type { Scene } from './types';
import './knowledge.css';

export default function KnowledgeModule({ mode, model, dirty, dirtyChanged, children, knowledgeSelected, navigateTab, spaceId, draftId, scene, handoff }: {
  mode: 'product' | 'creative'; model: ModelInfo; dirty: boolean;
  dirtyChanged: (v: boolean) => void; children: ReactNode; knowledgeSelected: boolean;
  navigateTab: (knowledge: boolean) => void; spaceId?: string; draftId?: string; scene?: Scene; handoff: HandoffContext;
}) {
  const choose = (knowledge: boolean) => {
    if (knowledge === knowledgeSelected) return;
    if (dirty && !confirm('当前内容尚未保存，确定切换并放弃修改？')) return;
    dirtyChanged(false); navigateTab(knowledge);
  };
  return <>
    <nav className="kb-module-tabs" aria-label={mode === 'product' ? '商品与品牌功能' : '营销与创意功能'}>
      <button aria-pressed={!knowledgeSelected} onClick={() => choose(false)}><Package size={16}/>{mode === 'product' ? '商品资料' : '活动创意'}</button>
      <button aria-pressed={knowledgeSelected} onClick={() => choose(true)}>{mode === 'product' ? <BookOpen size={16}/> : <Sparkles size={16}/>}{mode === 'product' ? '知识库与 RAG' : '行业知识草稿'}<span>资料与引用</span></button>
    </nav>
    {knowledgeSelected ? <KnowledgeWorkspace key={`${mode}:${spaceId || ''}:${draftId || ''}:${scene || ''}`} model={model} dirtyChanged={dirtyChanged} initialTab={mode === 'product' ? 'library' : 'drafts'} initialSpaceId={spaceId} initialDraftId={draftId} initialScene={scene} handoff={handoff}/> : children}
  </>;
}
