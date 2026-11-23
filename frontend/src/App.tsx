import { useState } from 'react';
import { ArrowLeft, ArrowRight, BrainCircuit, Plus, Sparkles, X } from 'lucide-react';
import { type Creative, type Order } from './api';
import { Button, Field, Submit } from './components/ui';
import { routeWith } from './navigation';
import AppShell from './app/AppShell';
import AppDialogs from './app/AppDialogs';
import ScopeFilter from './app/ScopeFilter';
import WorkspaceTabs from './app/WorkspaceTabs';
import { pageFor } from './app/pages';
import { useWorkspaceData } from './app/useWorkspaceData';
import { useWorkspaceNavigation } from './app/useWorkspaceNavigation';
import Overview from './features/Overview';
import AgentWorkspace from './features/agent/AgentWorkspace';
import DemandWorkspace from './features/demand/DemandWorkspace';
import type { View as DemandView } from './features/demand/types';
import KnowledgeWorkspace from './features/knowledge/KnowledgeWorkspace';
import type { Scene } from './features/knowledge/types';
import ProductPage from './features/ProductPage';
import CreativeStudio from './features/CreativeStudio';
import CampaignList from './features/CampaignList';
import AdsPage from './features/AdsPage';
import AnalyticsPage from './features/AnalyticsPage';
import MetricsSummary from './features/MetricsSummary';
import Consumer from './features/Consumer';
import FeedbackPages from './Feedback';
import LiveCatalog from './features/live/LiveCatalog';
import LiveWorkspace from './features/live/LiveWorkspace';
import LiveResults, { LiveReports } from './features/live/LiveResults';

export default function App() {
  const data = useWorkspaceData();
  const navigation = useWorkspaceNavigation();
  const { route, go, markDirty, markLiveDirty } = navigation;
  const { state, campaignId, dataset, batchId, planId, dateFrom, dateTo, analytics, analyticsError, busy, error, auth, act, refresh } = data;
  const [dialog, setDialog] = useState('');
  const [trace, setTrace] = useState<Order | null>(null);
  const [planCreative, setPlanCreative] = useState('');
  const params = new URLSearchParams(route.split('?')[1] || '');
  const page = pageFor(route);
  const view = params.get('view') || '';
  const campaign = state?.campaigns.find(item => item.id === campaignId);
  const creatives = state?.creatives.filter(item => item.campaign_id === campaignId) || [];
  const plans = state?.plans.filter(item => item.campaign_id === campaignId) || [];
  const batches = state?.batches.filter(item => item.campaign_id === campaignId) || [];
  navigation.liveSessionIds.current = state?.live_sessions.filter(item => item.campaign_id === campaignId).map(item => item.id) || [];
  const switchCampaign = (id: string) => {
    if (id === campaignId) return true;
    if (!navigation.canLeave()) return false;
    markDirty(false); data.setCampaignId(id); data.setPlanId(''); data.setBatchId('');
    if (dataset === 'batch') data.setDataset('session');
    return true;
  };
  const inspect = (section: string) => go('analytics?section=' + section);
  const openKnowledge = (spaceId?: string) => go('product?tab=knowledge' + (spaceId ? '&space=' + encodeURIComponent(spaceId) : '') + '&returnTo=' + encodeURIComponent(route));
  const handoff = {
    sessions: state?.live_sessions, campaigns: state?.campaigns || [], campaignId,
    transferred: async (creative: Creative) => {
      markDirty(false); await refresh(); switchCampaign(creative.campaign_id);
      data.setToast('已转为活动创意草稿'); go('creative?item=' + encodeURIComponent(creative.id));
    },
  };
  const availablePlans = dataset === 'history' ? data.historyOptions : dataset === 'batch'
    ? batches.filter(b => b.id === batchId).map(b => ({ id: String(b.plan_id), name: String(b.plan_snapshot?.name || plans.find(p => p.id === b.plan_id)?.name || b.plan_id) })) : plans;
  const scope = <ScopeFilter {...data} batches={batches} plans={availablePlans}/>;
  const feedbackProps = { state: state!, campaignId, dataset, batchId, planId, dateFrom, dateTo, busy, act, go,
    setDataset: data.setDataset, setBatchId: data.setBatchId, setPlanId: data.setPlanId, dirtyChanged: markDirty };
  const knowledgeProps = { model: state?.model!, dirtyChanged: markDirty, initialSpaceId: params.get('space') || undefined,
    initialDraftId: params.get('draft') || undefined, initialScene: (['medical', 'live'].includes(params.get('scene') || '') ? params.get('scene') : undefined) as Scene | undefined, handoff };

  if (auth) return <div className="access-page"><form className="panel access-card" onSubmit={event => {
    event.preventDefault(); sessionStorage.setItem('demo-token', String(new FormData(event.currentTarget).get('token'))); void act(refresh);
  }}><h1>进入浙衍 AI</h1><Field label="访问码"><input name="token" type="password" required/></Field><Submit busy={busy}>进入工作台</Submit>{error && <p role="alert">{error}</p>}</form></div>;
  if (!state) return <div className="access-page"><div className="loading"><Sparkles size={32}/><h2>正在打开工作空间</h2>{error && <><p role="alert">{error}</p><Button onClick={() => act(refresh)}>重试连接</Button></>}</div></div>;
  if (route.startsWith('shop/')) return <Consumer key={route} plan={state.plans.find(p => p.id === route.split('/')[1])} busy={busy} error={error} act={act} back={() => go('ads')} viewOrder={plan => {
    switchCampaign(plan.campaign_id); data.setDataset('session'); data.setDateFrom(''); data.setDateTo(''); data.setPlanId(plan.id); go('analytics?section=orders');
  }}/>;

  const demandView = (['tasks', 'library', 'results', 'content', 'attention'].includes(view) ? view : 'tasks') as DemandView;
  const demandSelected = page.id === 'agent' && params.get('tab') === 'demand';
  const knowledgeSelected = params.get('tab') === 'knowledge';
  const returnTo = params.get('returnTo');
  const agentReturn = returnTo || (params.get('live') ? 'live?pane=session&live=' + encodeURIComponent(params.get('live')!) : params.get('campaign') ? 'creative' : '');
  const taskTarget = (id: string) => routeWith(route, { agent: id || undefined });
  const pending = state.tasks.filter(task => task.campaign_id === campaignId && !['resolved', 'ignored'].includes(task.status)).length + creatives.filter(c => c.status === 'draft').length;

  return <>
    <AppShell key={navigation.editorEpoch} route={route} go={go} pending={pending} openDialog={setDialog} actions={<>
      {!['agent', 'product', 'codex'].includes(page.id) && <select aria-label="选择营销活动" value={campaignId} onChange={event => switchCampaign(event.target.value)}>{state.campaigns.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select>}
      {page.id === 'overview' && <Button kind="primary" onClick={() => go('agent?agent=new')}><Plus size={15}/>新建任务</Button>}
    </>}>
      {error && <div className="error-banner" role="alert"><span>{error}</span><button className="button ghost" aria-label="关闭错误提示" onClick={() => data.setError('')}><X size={16}/></button></div>}
      {page.id === 'overview' && <>{scope}<Overview state={state} campaign={campaign} campaignId={campaignId} analytics={analytics} go={go} inspect={inspect} setDialog={setDialog}/></>}
      {page.id === 'agent' && <>
        <WorkspaceTabs label="Agent 任务类型" selected={demandSelected ? 'demand' : 'content'} items={[{ id: 'content', label: '内容任务', route: 'agent' }, { id: 'demand', label: '需求分析', route: 'agent?tab=demand' }]} go={go}/>
        {demandSelected ? <DemandWorkspace view={demandView} model={state.model} initialSpaceId={params.get('space') || undefined} initialTaskId={params.get('task') || undefined}
          taskSelected={(id, space) => navigation.navigateChecked(routeWith(route, { task: id || undefined, space }))} go={go} dirtyChanged={markDirty}/>
          : <>{agentReturn && <Button kind="ghost" onClick={() => go(agentReturn)}><ArrowLeft size={14}/>返回来源业务</Button>}
            <AgentWorkspace model={state.model} dirtyChanged={markDirty} openKnowledge={openKnowledge} handoff={handoff} initialStatus={params.get('status') === 'attention' ? 'attention' : undefined}
              taskSelected={id => navigation.navigateChecked(taskTarget(id))} intent={params.has('agent') ? { token: route, taskId: params.get('agent')!, scene: params.get('scene') === 'medical' ? 'medical' : 'live', campaignId: params.get('campaign') || '', liveSessionId: params.get('live') || '', liveItemId: params.get('line') || '' } : undefined}/></>}
      </>}
      {page.id === 'product' && <>
        <WorkspaceTabs label="商品与知识功能" selected={params.get('tab') || 'profile'} items={[{ id: 'catalog', label: '商品目录', route: 'product?tab=catalog' }, { id: 'profile', label: '品牌与商品资料', route: 'product' }, { id: 'knowledge', label: '知识库', route: 'product?tab=knowledge' }]} go={go}/>
        {(returnTo || params.has('returnTask')) && <Button kind="ghost" onClick={() => go(returnTo || 'agent?tab=demand&view=content&space=' + encodeURIComponent(params.get('space') || '') + '&task=' + encodeURIComponent(params.get('returnTask')!))}><ArrowLeft size={14}/>返回来源任务</Button>}
        {knowledgeSelected ? <KnowledgeWorkspace key={'knowledge:' + (params.get('space') || '')} {...knowledgeProps}/>
          : params.get('tab') === 'catalog' ? <LiveCatalog act={act} busy={busy} dirtyChanged={markDirty} legacy={() => go('product')}/>
          : <><ProductPage product={state.product} busy={busy} error={error} act={act} dirtyChanged={markDirty}/><div className="row-actions"><Button disabled={navigation.dirty.current} onClick={() => go('creative')}>查看活动创意<ArrowRight size={15}/></Button><Button disabled={navigation.dirty.current} onClick={() => setDialog('campaign-latest')}>使用最新商品创建活动</Button></div></>}
      </>}
      {page.id === 'creative' && <>
        <WorkspaceTabs label="营销与创意功能" selected={knowledgeSelected ? 'knowledge' : view === 'campaigns' ? 'campaigns' : 'content'} items={[{ id: 'content', label: '创意素材', route: 'creative' }, { id: 'campaigns', label: '活动管理', route: 'creative?view=campaigns' }, { id: 'knowledge', label: '知识草稿', route: 'creative?tab=knowledge' }]} go={go}/>
        {knowledgeSelected ? <KnowledgeWorkspace key={'draft:' + (params.get('draft') || params.get('space') || '')} {...knowledgeProps} initialTab="drafts"/>
          : view === 'campaigns' ? <CampaignList state={state} create={() => setDialog('campaign')} select={id => { if (switchCampaign(id)) go('creative'); }}/>
          : <CreativeStudio key={campaignId} latestProduct={state.product} useLatestProduct={() => setDialog('campaign-latest')} go={go} initialCreativeId={params.get('item') || undefined} creatives={creatives} campaign={campaign} busy={busy} error={error} act={act} useCreative={creative => { setPlanCreative(creative.id); go('ads'); }} openProduct={() => go('product')} dirtyChanged={markDirty} modelLabel={state.model.label}/>}
      </>}
      {page.id === 'live' && <LiveWorkspace key={campaignId} toolGroup={params.get('tools') || undefined} moduleId={params.get('module') || undefined} featureId={params.get('feature') || undefined} pane={params.get('pane') || undefined} sessions={state.live_sessions} campaign={campaign} busy={busy} act={act} go={go} selectedId={params.get('live') || undefined} dirtyChanged={markLiveDirty}/>}
      {page.id === 'ads' && <AdsPage key={campaignId} initialScenarios={params.get('scenarios') === '1'} state={state} campaignId={campaignId} busy={busy} error={error} act={act} go={go} initialCreative={planCreative} clearCreative={() => setPlanCreative('')} loadedBatch={batch => { data.setDataset('batch'); data.setBatchId(batch.id); data.setPlanId(''); go('analytics'); }}/>}
      {page.id === 'analytics' && <>
        <WorkspaceTabs label="效果与复盘视图" selected={view || 'analytics'} items={[{ id: 'analytics', label: '效果分析', route: 'analytics' }, { id: 'optimize', label: '优化复盘', route: 'analytics?view=optimize' }, { id: 'reports', label: '活动报告', route: 'analytics?view=reports' }, { id: 'live', label: '场次复盘', route: 'analytics?view=live' }, { id: 'live-reports', label: '场次报告', route: 'analytics?view=live-reports' }]} go={go}/>
        {!['live', 'live-reports'].includes(view) && scope}
        {view === 'optimize' || view === 'reports' ? <FeedbackPages key={campaignId + view} {...feedbackProps} page={view} reportId={params.get('report') || undefined}/>
          : view === 'live' ? <LiveResults state={state} campaignId={campaignId} selectedId={params.get('live') || undefined} go={go} dirtyChanged={markDirty}/>
          : view === 'live-reports' ? <LiveReports key={campaignId} campaignId={campaignId}/>
          : analyticsError ? <div className="error-banner" role="alert">{analyticsError}<Button onClick={() => act(refresh)}>重试读取效果</Button></div>
          : dataset === 'batch' && !batchId ? <p>请选择一个模拟数据批次。<Button onClick={() => go('ads?scenarios=1')}>选择批次</Button></p>
          : !analytics ? <p role="status">正在读取效果数据…</p>
          : <><MetricsSummary analytics={analytics} onSelect={section => go('analytics?section=' + section)}/><AnalyticsPage analytics={analytics} focus={params.get('section') || 'overview'} onSelectView={section => go('analytics?section=' + section)} trace={setTrace} selectPlan={data.setPlanId}/><Button onClick={() => go('analytics?view=optimize')}><BrainCircuit size={16}/>生成复盘</Button></>}
      </>}
      {page.id === 'tasks' && <>
        <WorkspaceTabs label="待办范围" selected={view || 'issues'} items={[{ id: 'issues', label: '活动异常', route: 'tasks' }, { id: 'creative', label: '创意待审核', route: 'tasks?view=creative' }, { id: 'agent', label: 'Agent 待处理', route: 'agent?status=attention' }, { id: 'demand', label: '需求待处理', route: 'agent?tab=demand&view=attention' }]} go={go}/>
        {view === 'creative' ? <section className="workspace-section"><h2>创意待审核</h2>{creatives.filter(c => c.status === 'draft').map(creative => <button key={creative.id} className="workspace-action-row" onClick={() => go('creative?item=' + encodeURIComponent(creative.id))}><span><strong>{creative.title}</strong><small>{creative.product_snapshot.name} · V{creative.version}</small></span><ArrowRight size={16}/></button>)}{!creatives.some(c => c.status === 'draft') && <p>当前活动暂无待审核创意。</p>}</section>
          : <>{scope}<FeedbackPages key={campaignId} {...feedbackProps} page="tasks"/></>}
      </>}
    </AppShell>
    <AppDialogs data={data} dialog={dialog} close={() => setDialog('')} campaign={campaign} trace={trace} closeTrace={() => setTrace(null)} switchCampaign={switchCampaign} go={go}/>
  </>;
}
