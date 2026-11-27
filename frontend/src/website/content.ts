import { Store, Building2, Radio, Package, Sparkles, Megaphone, ChartNoAxesCombined, BrainCircuit, ScanLine, Fingerprint, ShieldCheck, GitBranch } from 'lucide-react';
import { pages } from '../app/pages';

export const workspaceLink = (page = 'overview') => `./index.html#/${page}`;
export const chapters = [
  { id: 'home', label: '起点', english: 'THE BEGINNING' },
  { id: 'journey', label: '流程', english: 'THE JOURNEY' },
  { id: 'difference', label: '不同', english: 'THE DIFFERENCE' },
  { id: 'start', label: '开始', english: 'YOUR NEXT CHAPTER' },
];
// Journey steps follow real workbench pages and tabs (see app/pages.ts) and deep-link into them.
// `path` is the breadcrumb shown on the homepage; `link` is the matching workbench route.
export const stages = [
  { title: '商品与知识', icon: Package, heading: '好的创意，\n从真实的商品开始。', text: '在商品目录与品牌资料中维护价格、规格和卖点，并通过知识库保留资料来源。每次创作，都从一份明确的资料出发。', output: '一份可引用的商品档案', path: ['商品与知识', '商品目录'], link: 'product?tab=catalog' },
  { title: '营销与创意', icon: Sparkles, heading: '同一个商品，\n找到不同的表达。', text: '围绕目标受众与营销场景，生成文案和脚本草稿。比较不同版本，让你的判断成为创意的一部分。', output: '可以编辑、比较的创意版本', path: ['营销工作台', '内容创意'], link: 'creative' },
  { title: '创意核对', icon: ScanLine, heading: '有说服力，\n也要有依据。', text: '在创意素材的事实核对中，对照商品资料检查关键数字。指出冲突、标明缺失依据，把确认的决定留给你。', output: '逐条核对结果与修订建议', path: ['营销工作台', '内容创意', '事实核对'], link: 'creative' },
  { title: '广告投放', icon: Megaphone, heading: '让每次投放，\n都有清晰的起点。', text: '将确认的创意关联到投放计划，设置预算和周期。保留素材与配置版本，后续调整有据可查。', output: '关联创意版本的投放计划', path: ['广告投放'], link: 'ads' },
  { title: '效果分析', icon: ChartNoAxesCombined, heading: '从一次点击，\n看见后续的连接。', text: '在效果与复盘中，关联广告入口、商品浏览与订单。区分数据来源，理解每个指标的统计范围。', output: '可以追溯来源的成交记录', path: ['效果与复盘', '效果分析'], link: 'analytics' },
  { title: '优化复盘', icon: BrainCircuit, heading: '让这一轮的发现，\n成为下一轮的起点。', text: '基于已经计算的指标形成复盘，把建议变成新草稿。人工确认后再进入观察，并留下报告与调整记录。', output: '优化草稿、观察记录与报告快照', path: ['效果与复盘', '优化复盘'], link: 'analytics?view=optimize' },
];
// The homepage cards mirror the workbench sidebar: names, icons and routes come from app/pages.ts,
// so the two can never drift apart. Only the English label and the blurb are written here.
const moduleCopy: Record<string, { step: string; english: string; text: string }> = {
  overview: { step: '每日入口', english: 'Work overview', text: '今日工作、待办与审核、异常提醒，一眼看清下一步该做什么。' },
  geo: { step: 'GEO 优化', english: 'GEO workbench', text: '管理 GEO 项目、问题与资料，查看 AI 回答中的品牌表现，并生成内容草稿。' },
  live: { step: '直播场景', english: 'Live workbench', text: '场次管理、现场控制、直播素材与场次复盘，共用同一份商品资料。' },
  marketing: { step: '对应 STEP 02 – 06', english: 'Marketing workbench', text: '活动管理、需求选题、内容创意、广告投放、效果复盘与咨询助手。' },
  product: { step: '对应 STEP 01', english: 'Product & knowledge', text: '维护商品目录、品牌资料与知识库，让生成只依据已核对的资料。' },
  agent: { step: '协助全流程', english: 'Agent center', text: '把内容与需求任务交给 AI Agent，生成待你确认的草稿。' },
};
export const modules = pages.map(page => ({ id: page.route, title: page.label, icon: page.icon, ...moduleCopy[page.id] }));
export const differences = [
  { icon: ShieldCheck, title: '表达有依据', text: '关键数字对照商品事实。缺少证据的描述被单独标出，交给人工核查。', label: 'FACTS BEFORE CLAIMS' },
  { icon: GitBranch, title: '动作有来路', text: '资料、素材与计划保留版本。沿着关联记录，找到一次调整从哪里开始。', label: 'CONNECTED BY CONTEXT' },
  { icon: Fingerprint, title: '数据有边界', text: '历史数据、现场互动与批次数据分开统计。不能计算的指标，解释原因。', label: 'CONTEXT BEFORE NUMBERS' },
  { icon: BrainCircuit, title: '建议有下一步', text: '复盘建议可以形成草稿，经过确认再观察。让优化成为可跟进的动作。', label: 'INSIGHT INTO ACTION' },
];
export const questions = [
  { q: '这个官网和工作台是什么关系？', a: '官网用于介绍产品与交互讲解。点击“进入工作台”，即可打开工作台，操作商品资料、创意、广告投放、效果分析等六个工作台。官网中的流程预览仅用于讲解，不会修改工作台数据。' },
  { q: '广告投放和付款是怎么工作的？', a: '工作台中的广告投放用于规划预算、周期与素材关联，并保留配置版本与操作记录。目前尚未接入真实广告账户与支付系统。' },
  { q: 'AI 在哪些环节参与？', a: '工作台支持接入智谱模型，用于创意生成、重新生成与优化复盘，并按记录标明生成来源。内容核对还包含规则检查；涉及价格、促销承诺和发布的最终决定，需要人工确认。' },
  { q: '支持多平台投放和直播吗？', a: '当前版本以单店、单商品推广为主要场景，并提供直播工作台管理场次与素材。抖音广告账户、多商品与跨平台协同属于后续扩展方向。' },
];

export const audiences = [
  { icon: Store, title: '电商商家与店主', text: '一个人要同时管商品、文案和投放。让 AI 帮你起草，由系统核对价格和卖点，你只做最后的确认。' },
  { icon: Building2, title: '品牌运营团队', text: '多人协作时，资料、创意和计划各有版本。每次调整都能回看来路，复盘时不再靠记忆。' },
  { icon: Radio, title: '直播与内容团队', text: '场次、货盘与话术在同一个工作台里。现场控制与事后复盘，使用同一份商品资料。' },
];
export const compareCase = {
  before: { label: '普通 AI 文案', text: ['青禾保温杯，仅需 ', '79 元', '，', '1 L', ' 大容量，', '保温 24 小时', '。'], issues: ['价格与资料不符（资料：99 元）', '容量与资料不符（资料：500 ml）', '“保温 24 小时”缺少检测依据'] },
  after: { label: '经过事实核对', text: ['青禾保温杯，', '99 元', '，', '500 ml', ' 随行容量，奶油白配色。'], checks: ['价格已对照商品资料', '容量已对照商品资料', '无依据的承诺已移除，等待你确认'] },
};
