import { ArrowRight, BookOpen, ChartNoAxesCombined, Compass, Megaphone, Sparkles } from 'lucide-react';
import type { Scene } from '../knowledge/types';
import { Badge } from '../../components/ui';

export default function TaskStart({ scene, changeScene, startAgent, newCampaign, knowledge, analyze, guide }: {
  scene: Scene; changeScene: (scene: Scene) => void; startAgent: () => void; newCampaign: () => void;
  knowledge: (drafts: boolean) => void; analyze: () => void; guide: () => void;
}) {
  const medical = scene === 'medical';
  const choices = [
    { icon: Sparkles, title: '让 AI 生成内容', detail: medical ? '从机构资料整理预约 FAQ，逐段核对引用。' : '根据商品依据整理直播脚本，确认后转为活动创意。', action: startAgent, label: '开始内容任务' },
    { icon: medical ? BookOpen : Megaphone, title: medical ? '准备机构资料' : '推广一个商品', detail: medical ? '导入预约流程、机构说明，核对后加入知识库。' : '新建活动，把商品、素材、模拟计划放在一起。', action: medical ? () => knowledge(false) : newCampaign, label: medical ? '打开知识库' : '创建营销活动' },
    { icon: ChartNoAxesCombined, title: medical ? '查看知识草稿' : '分析已有结果', detail: medical ? '找到已保存的 FAQ，查看引用、修订和导出。' : '查看当前活动的测试订单，选择数据范围后复盘。', action: medical ? () => knowledge(true) : analyze, label: medical ? '查看已保存内容' : '打开效果看板' },
    { icon: Compass, title: '跟着示例走一遍', detail: medical ? '使用虚构机构资料，体验从任务到确认的过程。' : '从 AI 内容到测试购买，一步步完成演示。', action: guide, label: '查看体验路线' },
  ];
  return <section id="task-start" className="panel journey-start" aria-label="开始本次任务">
    <div className="journey-start-heading"><div><div className="eyebrow">START WITH A TASK</div><h2>这次，你想完成什么？</h2><p className="muted">选一个起点，系统带你走到下一步。无需先填完所有模块。</p></div>
      <div className="journey-scenes" role="group" aria-label="本次内容场景">{(['live', 'medical'] as Scene[]).map(value => <button key={value} type="button" aria-pressed={scene === value} onClick={() => changeScene(value)}>{value === 'live' ? '直播电商' : '医美营销'}</button>)}</div>
    </div>
    <div className="journey-start-grid">{choices.map((choice, index) => <button type="button" className="journey-choice" key={choice.title} onClick={choice.action}>
      <span className="journey-choice-top"><choice.icon size={21}/><small>0{index + 1}</small></span><strong>{choice.title}</strong><p>{choice.detail}</p><span className="journey-choice-action">{choice.label}<ArrowRight size={15}/></span>
    </button>)}</div>
    <p className="journey-scope"><Badge tone="neutral">{medical ? '内部内容任务' : '模拟业务流程'}</Badge>{medical ? '医美目前支持知识和内容准备；咨询、预约、到店台账尚未接入。下方商品活动保持原有范围。' : '投放与付款均为模拟。场景选择只决定任务入口，不改动已保存的活动与数据。'}</p>
  </section>;
}
