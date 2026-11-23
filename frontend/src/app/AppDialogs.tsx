import { CheckCircle2, Clock3, LoaderCircle, RefreshCw, Sparkles } from 'lucide-react';
import { api, date, money, requestId, type Campaign, type Order } from '../api';
import { buyers } from '../domain';
import CampaignModal from '../components/CampaignModal';
import ModelStatus from '../components/ModelStatus';
import { Button, Details, Modal } from '../components/ui';
import type { useWorkspaceData } from './useWorkspaceData';

export default function AppDialogs({ data, dialog, close, campaign, trace, closeTrace, switchCampaign, go }: {
  data: ReturnType<typeof useWorkspaceData>; dialog: string; close: () => void; campaign?: Campaign;
  trace: Order | null; closeTrace: () => void; switchCampaign: (id: string) => void; go: (route: string) => void;
}) {
  const { state, busy, error, act, campaignId, refresh, analytics, toast } = data;
  if (!state) return null;
  return <>
    {['campaign', 'campaign-edit', 'campaign-latest'].includes(dialog) && <CampaignModal
      key={dialog} campaign={dialog === 'campaign-edit' ? campaign : undefined}
      prefill={dialog === 'campaign-latest' ? campaign : undefined} latestProduct={dialog === 'campaign-latest'}
      product={state.product} busy={busy} error={error} close={close}
      save={body => act(async () => {
        const saved = await api<Campaign>(dialog === 'campaign-edit' ? `/campaigns/${campaignId}` : '/campaigns', dialog === 'campaign-edit' ? 'PUT' : 'POST', { ...body, request_id: requestId() });
        switchCampaign(saved.id); close();
        if (dialog !== 'campaign-edit') go('creative');
      }, '活动已保存')}/>}
    {dialog === 'logs' && <Modal title="执行记录" wide onClose={close}><div className="log-list">{state.logs.slice().reverse().slice(0, 60).map(log => <div className="log-item" key={log.id}><Clock3 size={18}/><div><strong>{log.action}</strong><p>{log.detail}</p><small>{date(log.created_at)}</small></div></div>)}</div></Modal>}
    {dialog === 'settings' && <Modal title="工作空间设置" onClose={close}>
      <ModelStatus initial={state.model}/>
      <Details items={[["内容生成", state.model.label], ["数据保存", '本机工作空间'], ["平台状态", '广告投放与付款为模拟操作']]}/>
      <details><summary>模型连接与配置</summary><p>在项目目录运行 configure-zhipu.cmd 配置密钥，运行 check-zhipu.cmd 检测连接。配置后重启服务生效。</p>
        <Button disabled={busy || state.model.mode === 'replay' || !state.model.configured} onClick={() => act(() => api('/model/check', 'POST'), '连接测试通过')}><Sparkles size={15}/>测试模型连接</Button>
      </details>
      <div className="modal-footer"><Button disabled={busy} onClick={() => act(refresh, '数据已更新')}><RefreshCw size={15}/>刷新数据</Button></div>
    </Modal>}
    {dialog === 'guide' && <Modal title="帮助" onClose={close}>
      <div className="guide-list">
        <div><h3>内容任务</h3><p>选择资料并填写目标，在任务详情核对结果和引用。</p></div>
        <div><h3>直播准备</h3><p>创建场次并确认货盘，再设置画面、话术与互动。</p></div>
        <div><h3>效果分析</h3><p>选择活动、数据来源和日期，查看图表、明细及复盘。</p></div>
      </div>
      <div className="modal-footer"><Button onClick={() => { close(); go('agent?agent=new'); }}>新建内容任务</Button><Button onClick={() => { close(); go('agent?tab=demand'); }}>需求分析</Button><Button onClick={() => { close(); go('live?pane=session'); }}>场次管理</Button></div>
    </Modal>}
    {trace && <Modal title="订单来源链路" onClose={closeTrace}><Details items={[
      ['营销活动', state.campaigns.find(c => c.id === trace.campaign_id)?.name],
      ['投放计划', state.plans.find(p => p.id === trace.plan_id)?.name || trace.plan_id],
      ['素材版本', `${state.creatives.find(c => c.id === trace.creative_id)?.title || trace.creative_id} · V${state.creatives.find(c => c.id === trace.creative_id)?.version || 1}`],
      ['配置版本', `V${trace.plan_config_version || 1}`], ['订单编号', trace.id],
      ['测试买家', `${trace.buyer_id} · ${buyers[trace.buyer_type]}`], ['数量', trace.quantity || 1], ['模拟金额', money(trace.amount)],
    ]}/><p className="workspace-inline-note">{analytics?.label} · 模拟业务关联记录</p></Modal>}
    {busy && <div className="busy-indicator" role="status"><LoaderCircle size={16}/>正在保存…</div>}
    {toast && <div className="toast" role="status"><CheckCircle2 size={16}/>{toast}</div>}
  </>;
}
