import { ArrowRight, BookOpen, Sparkles } from 'lucide-react';
import { Badge, Button, Modal } from '../../components/ui';
import type { Scene } from '../knowledge/types';

export default function JourneyGuide({ scene, close, agent, campaign, knowledge, demand }: {
  scene: Scene; close: () => void; agent: () => void; campaign: () => void; knowledge: () => void; demand: () => void;
}) {
  const medical = scene === 'medical';
  const steps = medical ? [
    ['给出内容任务', '选择医美场景和预置虚构示例，点击开始任务。'],
    ['看执行记录与引用', '查看它检索了什么、读了什么；打开引用核对原文。'],
    ['确认内部 FAQ', '保存修订，人工确认草稿，再标记任务完成；可导出给同事。'],
  ] : [
    ['准备内容', '用预置虚构商品资料启动直播 Agent；也可直接新建活动、生成创意。'],
    ['核对并转入', '确认知识草稿、完成任务，选择目标活动，转为待确认创意。'],
    ['确认素材与计划', '核对商品事实、确认素材，创建计划并确认模拟启动。'],
    ['亲自体验购买', '在运行计划中点体验购买，核对订单后模拟付款。'],
    ['查看结果并复盘', '现场互动记录查看订单；需要完整消耗样例时另载入模拟批次。'],
    ['保存这一轮报告', '填写结论与下一步，保存报告快照，可另存 PDF。'],
  ];
  return <Modal title="第一次体验，从这里开始" wide onClose={close}>
    <p className="journey-guide-intro"><Badge>{medical ? '医美内容路线' : '直播电商演示路线'}</Badge>没有正式资料，也可以用预置虚构示例。点击入口只是打开表单，由你确认后开始。</p>
    <section className="notice"><h3>从真实问题开始：需求素材主线</h3><p>导入词表或问题记录 → 核对逐条原文与来源 → 配置筛选并预览 → 人工分类、分组、确认 → 转为选题 / FAQ → 检索已审核事实 → 核对引用、确认并导出草稿。</p><p>需求记录回答“用户在问什么”，事实资料提供回答依据；已确认短词可另存为可复用筛选词库。</p><Button kind="primary" onClick={demand}>从需求素材开始<ArrowRight size={14}/></Button></section><ol className="journey-guide-steps">{steps.map(([title, detail], i) => <li key={title}><span>{String(i + 1).padStart(2, '0')}</span><div><strong>{title}</strong><p>{detail}</p></div></li>)}</ol>
    <div className="notice">{medical ? '本路线产出内部沟通草稿，不创建商品计划。' : '一个活动可以有多份素材和多个计划。知识草稿确认、素材确认、计划启动分别进行。'} 演示不会产生真实广告花费或付款。</div>
    <div className="row-actions"><Button kind="primary" onClick={agent}><Sparkles size={15}/>从示例 Agent 开始</Button>{!medical && <Button onClick={campaign}>从新建活动开始<ArrowRight size={14}/></Button>}<Button kind="ghost" onClick={knowledge}><BookOpen size={14}/>我先准备知识资料</Button></div>
  </Modal>;
}
