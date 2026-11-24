import { LayoutDashboard, Package, Sparkles, Megaphone, ChartNoAxesCombined, ListTodo, BrainCircuit, FileText, ScanLine, Fingerprint, ShieldCheck, GitBranch } from 'lucide-react';

export const workspaceLink = (page = 'overview') => `./index.html#/${page}`;
export const chapters = [
  { id: 'home', label: '起点', english: 'THE BEGINNING' },
  { id: 'journey', label: '流程', english: 'THE JOURNEY' },
  { id: 'difference', label: '不同', english: 'THE DIFFERENCE' },
  { id: 'start', label: '开始', english: 'YOUR NEXT CHAPTER' },
];
export const stages = [
  { title: '商品资料', icon: Package, heading: '好的创意，\n从真实的商品开始。', text: '把价格、规格、卖点和资料来源放在一起。每次创作，都从一份明确的商品资料出发。', output: '一份可引用的商品档案', link: 'product' },
  { title: 'AI 创意', icon: Sparkles, heading: '同一个商品，\n找到不同的表达。', text: '围绕目标受众与营销场景，生成文案和脚本草稿。比较不同版本，让你的判断成为创意的一部分。', output: '可以编辑、比较的创意版本', link: 'creative' },
  { title: '内容核对', icon: ScanLine, heading: '有说服力，\n也要有依据。', text: '对照商品资料核对文案里的关键数字。指出冲突、标明缺失依据，把发布前的决定留给你。', output: '逐条核对结果与修订建议', link: 'creative' },
  { title: '广告投流', icon: Megaphone, heading: '让每次投放，\n都有清晰的起点。', text: '将确认的创意关联到投放计划，设置预算和周期。保留素材与配置版本，后续调整有据可查。', output: '关联创意版本的模拟投放计划', link: 'ads' },
  { title: '成交追踪', icon: ChartNoAxesCombined, heading: '从一次点击，\n看见后续的连接。', text: '在演示链路中关联广告入口、商品浏览与模拟订单。区分数据来源，理解每一个指标的统计范围。', output: '可以追溯来源的测试成交记录', link: 'analytics' },
  { title: '优化复盘', icon: BrainCircuit, heading: '让这一轮的发现，\n成为下一轮的起点。', text: '基于已经计算的指标形成复盘，把建议变成新草稿。人工确认，再进入观察，留下完整的调整记录。', output: '优化草稿、观察记录与报告快照', link: 'optimize' },
];
export const modules = [
  { id: 'overview', title: '增长工作台', english: 'Growth overview', icon: LayoutDashboard, text: '目标、进度与下一步行动；也可把任务交给 AI Agent，生成待你确认的草稿。' },
  { id: 'product', title: '商品与品牌', english: 'Product foundation', icon: Package, text: '集中维护商品资料与来源；知识库检索让生成只依据已核对的资料。' },
  { id: 'creative', title: '营销与创意', english: 'Creative studio', icon: Sparkles, text: '生成、修订、核对与确认，让每个创意留下版本。' },
  { id: 'ads', title: '广告投放', english: 'Campaign control', icon: Megaphone, text: '连接素材、预算与周期，演示计划执行和调整。' },
  { id: 'analytics', title: '效果与获客', english: 'Performance insights', icon: ChartNoAxesCombined, text: '查看成交与新客，追溯指标背后的记录与口径。' },
  { id: 'tasks', title: '异常与待办', english: 'Action center', icon: ListTodo, text: '从异常发现到处理记录，让问题有后续。' },
  { id: 'optimize', title: 'AI 优化复盘', english: 'Intelligent iteration', icon: BrainCircuit, text: '用数据支撑复盘，把建议接到下一版优化草稿。' },
  { id: 'reports', title: '活动报告', english: 'Campaign reports', icon: FileText, text: '保存本轮数据与结论，生成可以回看的报告快照。' },
];
export const differences = [
  { icon: ShieldCheck, title: '表达有依据', text: '关键数字对照商品事实。缺少证据的描述被单独标出，交给人工核查。', label: 'FACTS BEFORE CLAIMS' },
  { icon: GitBranch, title: '动作有来路', text: '资料、素材与计划保留版本。沿着关联记录，找到一次调整从哪里开始。', label: 'CONNECTED BY CONTEXT' },
  { icon: Fingerprint, title: '数据有边界', text: '历史演示、现场互动与模拟批次分开统计。不能计算的指标，解释原因。', label: 'CONTEXT BEFORE NUMBERS' },
  { icon: BrainCircuit, title: '建议有下一步', text: '复盘建议可以形成草稿，经过确认再观察。让优化成为可跟进的动作。', label: 'INSIGHT INTO ACTION' },
];
export const questions = [
  { q: '这个官网和工作台是什么关系？', a: '官网用于介绍产品与交互讲解。点击“进入工作台”，即可打开现有业务 Demo，操作商品资料、创意、模拟投放、效果分析等八个模块。官网中的流程预览是独立示例，不会修改工作台数据。' },
  { q: '现在可以真实投放广告、完成付款吗？', a: '当前版本的广告执行与付款都是模拟，不会消耗真实广告预算，也不会扣款。工作台会保存演示中的活动、创意、计划、测试订单和操作记录，供完整流程演示与复盘。' },
  { q: 'AI 在哪些环节参与？', a: '工作台支持接入智谱模型，用于创意生成、重新生成与优化复盘，并按记录标明生成来源。演示回放是单独标注的模式。内容核对还包含规则检查；涉及价格、促销承诺和发布的最终决定，需要人工确认。' },
  { q: '支持多平台投放和直播吗？', a: '当前 Demo 以单店、单商品推广为演示场景。真实抖音广告账户、直播业务、多商品与跨平台协同属于后续扩展方向，本页不将其展示为已经接通的能力。' },
];
