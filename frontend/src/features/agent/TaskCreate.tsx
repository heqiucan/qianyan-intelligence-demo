import { useState } from 'react';
import { BookOpen, Send } from 'lucide-react';
import type { ModelInfo } from '../../api';
import { Field, Submit } from '../../components/ui';
import { type Scene, type Space, sceneLabels } from '../knowledge/types';
import type { HandoffContext } from '../journey/CreativeHandoff';
import { type AgentIntent, type AgentTask, type CreateTaskInput, presets } from './types';

export default function TaskCreate({ model, spaces, handoff, intent, busy, create, dirtyChanged }: {
  model: ModelInfo; spaces: Space[]; handoff: HandoffContext; intent?: AgentIntent; busy: boolean;
  create: (input: CreateTaskInput) => Promise<boolean>; dirtyChanged: (value: boolean) => void;
}) {
  const initialScene = intent?.scene || 'live';
  const initialSession = handoff.sessions?.find(session => session.id === intent?.liveSessionId);
  const initialItem = initialSession?.items.find(item => item.id === intent?.liveItemId);
  const [scene, setScene] = useState<Scene>(initialScene);
  const [goal, setGoal] = useState(initialItem && initialScene === 'live'
    ? `为${initialItem.product_snapshot.name}（${initialItem.sku_label}）准备直播讲解稿，分开场、规格展示和收尾。只使用本场已确认货盘中的事实，缺失信息列为待核实。`
    : presets[initialScene]);
  const [liveSession, setLiveSession] = useState(initialScene === 'live' ? intent?.liveSessionId || '' : '');
  const [liveItem, setLiveItem] = useState(initialScene === 'live' ? intent?.liveItemId || '' : '');
  const [sourceMode, setSourceMode] = useState<AgentTask['source_mode']>(liveSession && liveItem ? 'catalog' : 'demo');
  const [spaceId, setSpaceId] = useState(''), [channel, setChannel] = useState('internal');
  const [linkedCampaign, setLinkedCampaign] = useState(initialScene === 'live' ? intent?.campaignId || initialSession?.campaign_id || '' : '');
  const session = handoff.sessions?.find(item => item.id === liveSession);
  const item = session?.items.find(entry => entry.id === liveItem);
  const eligibleSpaces = spaces.filter(space => space.scene === scene);
  const changeScene = (next: Scene) => {
    if (next === scene) return;
    setScene(next); setGoal(presets[next]); setSpaceId(''); setLinkedCampaign('');
    setLiveSession(''); setLiveItem(''); setSourceMode('demo'); setChannel('internal'); dirtyChanged(true);
  };
  const submit = () => create({
    scene, goal, source_mode: sourceMode,
    ...(scene === 'live' && liveSession ? { live_session_id: liveSession, live_item_id: liveItem } : {}),
    ...(scene === 'live' && linkedCampaign ? { campaign_id: linkedCampaign } : {}),
    ...(sourceMode === 'knowledge' ? { space_id: spaceId, channel } : { channel: 'internal' }),
  });

  return <form className="agent-composer" onSubmit={event => { event.preventDefault(); void submit(); }}>
    <fieldset className="agent-scene-fieldset" disabled={busy}>
      <legend>业务场景</legend>
      <div className="agent-scene-options">{(['medical', 'live'] as Scene[]).map(value => <label key={value}>
        <input type="radio" name="agent-scene" value={value} checked={scene === value} onChange={() => changeScene(value)}/>
        <span>{sceneLabels[value]}</span>
      </label>)}</div>
    </fieldset>
    <Field label="希望 Agent 完成的任务"><textarea required minLength={4} maxLength={1500} rows={5} disabled={busy} value={goal} onChange={event => { setGoal(event.target.value); dirtyChanged(true); }}/></Field>
    <div className="agent-form-grid">
      <Field label="使用哪些资料"><select value={sourceMode} disabled={busy} onChange={event => { setSourceMode(event.target.value as AgentTask['source_mode']); dirtyChanged(true); }}>
        {liveSession && <option value="catalog">本场已确认货盘</option>}
        <option value="demo">预置虚构示例</option><option value="knowledge">已审核知识库</option>
      </select></Field>
      {sourceMode === 'knowledge' && <>
        <Field label="资料空间"><select value={spaceId} disabled={busy} required onChange={event => { setSpaceId(event.target.value); dirtyChanged(true); }}>
          <option value="">请选择{sceneLabels[scene]}资料空间</option>{eligibleSpaces.map(space => <option key={space.id} value={space.id}>{space.name}{space.is_demo ? '（示例）' : ''}</option>)}
        </select></Field>
        <Field label="资料渠道范围"><select value={channel} disabled={busy} onChange={event => { setChannel(event.target.value); dirtyChanged(true); }}><option value="internal">内部资料</option><option value="douyin">抖音渠道资料</option></select></Field>
      </>}
    </div>
    {scene === 'live' && <Field label="关联营销活动（可选）"><select disabled={busy || Boolean(liveSession)} value={linkedCampaign} onChange={event => { setLinkedCampaign(event.target.value); dirtyChanged(true); }}>
      <option value="">独立任务，转入创意时选择</option>{handoff.campaigns.map(campaign => <option key={campaign.id} value={campaign.id}>{campaign.name} · {campaign.product_snapshot.name}</option>)}
    </select></Field>}
    {liveSession && <p className="agent-binding">绑定场次：{session?.title || liveSession}{session && ` · 货盘 V${session.version}`}<br/>商品：{item?.product_snapshot.name || '沿用来源货盘'} · SKU：{item?.sku_label || liveItem || '未指定'}</p>}
    <p className="agent-scope-note"><BookOpen size={15}/><span>{sourceMode === 'catalog'
      ? '仅使用人工确认的本场商品快照；不是平台核验或库存同步。'
      : sourceMode === 'demo' ? '创建独立的虚构示例资料空间，结果与引用均保留示例标记。'
        : '仅使用所选空间和渠道中已审核、有效的资料；缺失事实需补充并审核。'}</span></p>
    <div className="agent-start">
      <div><strong>{model.mode === 'replay' ? '本地规则演示 · 未调用模型' : `当前模型：${model.model_name}`}</strong>
        <p>{model.mode === 'replay' ? '正文为资料摘录回放。' : '每轮最多 7 次模型请求。'}</p>
      </div>
      <Submit busy={busy}><Send size={15}/>开始任务</Submit>
    </div>
    <p className="agent-boundary">资料范围固定于本任务。直播稿经人工确认并完成任务后，可转为活动创意草稿。</p>
  </form>;
}
