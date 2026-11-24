import { useEffect, useRef, useState } from 'react';
import { ArrowLeft, ArrowRight, Bot, Download, GitCompareArrows, RefreshCw, Sparkles } from 'lucide-react';
import { api, generationSource, requestId, type Campaign, type Creative, type Product } from '../api';
import { Button, Empty } from '../components/ui';
import type { Act } from '../domain';
import CreativeOrigin from './journey/CreativeOrigin';
import FactWorkspace from './creative/FactWorkspace';
import CreativeLibrary from './creative/CreativeLibrary';
import CreativeDialogs, { type CreativeDialog } from './creative/CreativeDialogs';
import GenerationPanel, { type GenerationSettings } from './creative/GenerationPanel';
import '../components/product-basis.css';

interface Props {
  creatives: Creative[]; campaign?: Campaign; busy: boolean; error: string; act: Act;
  latestProduct: Product; useLatestProduct: () => void;
  useCreative: (creative: Creative) => void; openProduct: () => void;
  dirtyChanged: (dirty: boolean) => void; modelLabel: string;
  go: (route: string) => void; initialCreativeId?: string;
}

export default function CreativeStudio({
  creatives, campaign, latestProduct, useLatestProduct, busy, error, act,
  useCreative, openProduct, dirtyChanged, modelLabel, go, initialCreativeId,
}: Props) {
  const [generationOpen, setGenerationOpen] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [settings, setSettings] = useState<GenerationSettings>({ recipe: 'spec', tone: '自然', angle: '场景' });
  const [dialog, setDialog] = useState<CreativeDialog | null>(null);
  const [pending, setPending] = useState<{ routeId: string; creative: Creative } | null>(null);
  const mutationLock = useRef(false);
  const mounted = useRef(true);
  const routeId = initialCreativeId || '';
  const currentRoute = useRef(routeId);
  currentRoute.current = routeId;
  // Keep the accepted response visible even if the subsequent state refresh fails.
  const selected = pending?.routeId === routeId ? pending.creative : creatives.find(creative => creative.id === routeId);
  const isDetail = Boolean(routeId || selected);

  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);

  useEffect(() => {
    setPending(null);
    setDialog(null);
  }, [routeId]);

  useEffect(() => {
    const focusedId = sessionStorage.getItem('focus-creative');
    if (!focusedId) return;
    sessionStorage.removeItem('focus-creative');
    if (!initialCreativeId && creatives.some(creative => creative.id === focusedId)) {
      go(`creative?item=${encodeURIComponent(focusedId)}`);
    }
  }, [initialCreativeId, creatives, go]);

  const openCreative = (creative: Creative) => go(`creative?item=${encodeURIComponent(creative.id)}`);
  const mutateCreative = async (work: () => Promise<Creative | undefined>, message: string, generation = false) => {
    if (busy || mutationLock.current) return false;
    mutationLock.current = true;
    setGenerating(generation);
    let accepted: Creative | undefined;
    try {
      const refreshed = await act(async () => {
        accepted = await work();
        if (accepted && mounted.current && currentRoute.current === routeId) {
          dirtyChanged(false);
          setPending({ routeId, creative: accepted });
          setDialog(null);
          setGenerationOpen(false);
        }
      }, message);
      // Navigate after act has refreshed the parent, so the URL resolves on remount.
      if (refreshed && accepted && mounted.current && currentRoute.current === routeId) openCreative(accepted);
      return Boolean(accepted);
    } finally {
      mutationLock.current = false;
      if (mounted.current) setGenerating(false);
    }
  };
  const regenerate = (creative: Creative) => {
    void mutateCreative(
      () => api<Creative>(`/creatives/${creative.id}/regenerate`, 'POST', { ...settings, request_id: requestId() }),
      '已生成新版本草稿', true,
    );
  };
  const startAgent = () => {
    if (campaign) go(`overview?agent=new&scene=live&campaign=${encodeURIComponent(campaign.id)}&launch=${requestId()}`);
  };
  const actionsBusy = busy || generating;

  return <div className="studio-page">
    {isDetail ? <>
      <div className="studio-page-heading">
        <Button kind="ghost" disabled={actionsBusy} onClick={() => go('creative')}><ArrowLeft size={15}/>返回素材列表</Button>
        {selected && <div className="row-actions">
          <Button onClick={() => setDialog({ kind: 'preview', creative: selected })}><Download size={14}/>预览 / 导出</Button>
          <Button onClick={() => setDialog({ kind: 'compare', creative: selected })}><GitCompareArrows size={14}/>版本对比</Button>
        </div>}
      </div>
      {selected ? <>
        <p className="studio-mode-note">来源：{generationSource(selected)} · 编辑后保存为新版本</p>
        {selected.live_context && <div className="notice studio-binding">
          <span>所属场次：{selected.live_context.session_title} · 货盘 V{selected.live_context.session_version} · {selected.live_context.sku_label}</span>
          <Button onClick={() => go(`creative?tab=live&live=${encodeURIComponent(selected.live_context!.session_id)}`)}>查看本场货盘<ArrowRight size={14}/></Button>
        </div>}
        <CreativeOrigin key={selected.id} creative={selected} go={go}/>
        <FactWorkspace
          key={selected.id}
          creative={selected}
          busy={actionsBusy}
          openProduct={openProduct}
          dirtyChanged={dirtyChanged}
          save={body => mutateCreative(
            () => api<Creative>(`/creatives/${selected.id}/revise`, 'POST', { ...body, request_id: requestId() }),
            '新版本草稿已保存',
          )}
          approve={() => setDialog({ kind: 'approve', creative: selected })}
          useCreative={() => useCreative(selected)}
        />
      </> : <Empty text="当前活动中没有这份素材，请返回列表选择。"/>}
    </> : <>
      <div className="studio-page-heading">
        <div><h2>活动素材</h2><p className="muted">{creatives.length} 个版本 · {campaign?.product_snapshot.name || '未选择活动'}</p></div>
        <div className="row-actions">
          <Button disabled={actionsBusy || !campaign} onClick={startAgent}><Bot size={15}/>Agent 创作</Button>
          <button type="button" className="button primary" aria-expanded={generationOpen} aria-controls="creative-generation" disabled={actionsBusy} onClick={() => setGenerationOpen(value => !value)}>
            <Sparkles size={15}/>{generationOpen ? '收起生成设置' : '生成创意'}
          </button>
        </div>
      </div>
      {generationOpen && <GenerationPanel
        campaign={campaign} latestProduct={latestProduct} settings={settings} change={setSettings}
        busy={actionsBusy} modelLabel={modelLabel} useLatestProduct={useLatestProduct} openProduct={openProduct}
        generate={() => {
          if (!campaign) return;
          void mutateCreative(async () => {
            const generated = await api<Creative[]>(`/campaigns/${campaign.id}/generate`, 'POST', { ...settings, request_id: requestId() });
            return generated[0];
          }, '创意草稿已生成', true);
        }}
      />}
      <CreativeLibrary
        scopeId={campaign?.id || ''}
        creatives={creatives} busy={actionsBusy} edit={openCreative} openDialog={setDialog}
        regenerate={regenerate} useCreative={useCreative}
      />
      {!creatives.length && <Button kind="ghost" onClick={openProduct}>查看商品依据<ArrowRight size={14}/></Button>}
    </>}
    {generating && <p className="notice" role="status"><RefreshCw size={14}/>{!modelLabel.includes('回放') ? '正在等待模型生成，返回后保存为草稿。' : '正在读取演示回放并创建草稿。'}</p>}
    {dialog && <CreativeDialogs
      dialog={dialog} creatives={creatives} busy={actionsBusy} error={error}
      close={() => setDialog(null)} edit={creative => { setDialog(null); openCreative(creative); }}
      approve={creative => { void mutateCreative(
        () => api<Creative>(`/creatives/${creative.id}/approve`, 'POST'), '素材已人工确认',
      ); }}
    />}
  </div>;
}
