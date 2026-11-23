import { useState } from 'react';
import { ArrowUpRight, Check, Download, GitCompareArrows, Pencil, RefreshCw } from 'lucide-react';
import { generationSource, type Creative } from '../../api';
import { Badge, Button, Empty, Field } from '../../components/ui';
import { names } from '../../domain';
import Poster from '../../Poster';
import type { CreativeDialog } from './CreativeDialogs';

export function creativeFamilies(creatives: Creative[]) {
  const byId = new Map(creatives.map(creative => [creative.id, creative]));
  const families = new Map<string, Creative[]>();
  for (const creative of creatives) {
    let ancestor = creative;
    const visited = new Set<string>();
    while (!ancestor.family_id && ancestor.parent_id && !visited.has(ancestor.id)) {
      visited.add(ancestor.id);
      const parent = byId.get(ancestor.parent_id);
      if (!parent) break;
      ancestor = parent;
    }
    const id = ancestor.family_id || ancestor.id;
    families.set(id, [...(families.get(id) || []), creative]);
  }
  return [...families.values()];
}

interface Props {
  scopeId: string;
  creatives: Creative[]; busy: boolean; edit: (creative: Creative) => void;
  openDialog: (dialog: CreativeDialog) => void; regenerate: (creative: Creative) => void;
  useCreative: (creative: Creative) => void;
}

export default function CreativeLibrary({ scopeId, creatives, busy, edit, openDialog, regenerate, useCreative }: Props) {
  const storageKey = 'creative-list-filter:' + scopeId;
  const [filter, setFilter] = useState(() => {
    const saved = sessionStorage.getItem(storageKey) || '';
    return ['latest', 'all', 'draft', 'approved'].includes(saved) ? saved : 'latest';
  });
  const families = creativeFamilies(creatives);
  const candidates = filter === 'latest'
    ? families.map(items => items.slice().sort((a, b) => b.version - a.version)[0])
    : creatives.filter(creative => filter === 'all' || creative.status === filter);
  const seen = new Set<string>();
  const displayed = filter === 'all' ? candidates : candidates.filter(creative => {
    const copy = JSON.stringify([creative.title, creative.body, creative.script, creative.cta, creative.product_snapshot, creative.live_context]);
    if (seen.has(copy)) return false;
    seen.add(copy);
    return true;
  });

  return <section className="studio-library-section" aria-label="活动素材列表">
    <div className="studio-library-toolbar">
      <span className="muted">{families.length} 组素材 · 显示 {displayed.length} 份</span>
      <Field label="素材筛选"><select value={filter} onChange={event => { setFilter(event.target.value); sessionStorage.setItem(storageKey, event.target.value); }}>
        <option value="latest">每组最新版本</option><option value="all">全部版本（含重复历史）</option><option value="draft">待确认草稿</option><option value="approved">已确认素材</option>
      </select></Field>
    </div>
    {candidates.length > displayed.length && <p className="studio-mode-note">已收起 {candidates.length - displayed.length} 份相同内容，可在“全部版本”查看。</p>}
    <div className="creative-grid studio-library">{displayed.map(creative => <article className="creative-card" id={`creative-${creative.id}`} key={creative.id}>
      <div className="creative-preview"><Poster creative={creative}/><div className="preview-badges"><Badge tone={creative.status === 'approved' ? 'green' : 'amber'}>{names[creative.status]}</Badge><Badge tone="neutral">V{creative.version}</Badge></div></div>
      <div className="creative-content">
        <div className="creative-meta"><span>{creative.direction}</span><span>资料 V{creative.product_snapshot.version} · {creative.template === 'minimal' ? '极简' : '经典'}模板</span></div>
        <h3>{creative.title}</h3><p>{creative.body}</p>
        <small className="studio-card-source">{generationSource(creative)}{creative.live_context && ` · ${creative.live_context.session_title} · 货盘 V${creative.live_context.session_version}`}</small>
        <div className="creative-buttons">
          <Button disabled={busy} onClick={() => edit(creative)}><Pencil size={14}/>编辑</Button>
          <Button kind="ghost" onClick={() => openDialog({ kind: 'preview', creative })}><Download size={14}/>预览 / 导出</Button>
          {creative.status === 'draft'
            ? <Button disabled={busy} onClick={() => openDialog({ kind: 'approve', creative })}><Check size={14}/>确认素材</Button>
            : <Button kind="primary" disabled={busy} onClick={() => useCreative(creative)}>用于投放<ArrowUpRight size={14}/></Button>}
        </div>
        <details className="studio-version-actions"><summary>版本操作</summary><div className="row-actions">
          <Button kind="ghost" onClick={() => openDialog({ kind: 'compare', creative })}><GitCompareArrows size={14}/>版本对比</Button>
          <Button disabled={busy} onClick={() => regenerate(creative)}><RefreshCw size={14}/>单组重新生成</Button>
        </div></details>
      </div>
    </article>)}</div>
    {!displayed.length && <Empty text={creatives.length ? '当前筛选没有素材。' : '暂无素材，可生成创意或由 Agent 转入草稿。'}/>}
  </section>;
}
