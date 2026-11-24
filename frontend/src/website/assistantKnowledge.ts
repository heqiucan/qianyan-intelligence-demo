/**
 * Knowledge for the website's robot assistant (小千).
 *
 * The assistant answers from this file only. It does not call a model or any API, so the website keeps its
 * rule that page interactions never touch business data. Every answer below restates what the website
 * and the project README already say. When a fact in the project changes, update the matching entry here.
 */

export type Reply = { id: string; text: string; next: string[]; matched: boolean };

type Entry = {
  id: string;
  /** Question shown on the suggestion chips for this topic. */
  q: string;
  /** Phrases that point to this topic. Longer phrases weigh more. Latin keys match whole words only. */
  keys: string[];
  text: string;
  /** Topic ids offered as follow-up chips. */
  next: string[];
};

const entries: Entry[] = [
  { id: 'greet', q: '你好', keys: ['你好', '您好', '嗨', '哈喽', '在吗', 'hello', 'hi', 'hey', 'good morning'],
    text: '你好，我是小千。关于这个项目的问题都可以问我，也可以点下面的问题开始。',
    next: ['about', 'modules', 'try'] },
  { id: 'thanks', q: '谢谢', keys: ['谢谢', '感谢', '多谢', 'thanks', 'thank you', 'thx'],
    text: '不客气！还想了解什么，随时问我。',
    next: ['about', 'modules', 'real'] },
  { id: 'self', q: '你是谁？', keys: ['你是谁', '你叫什么', '你是什么', '你是机器人', 'who are you', 'your name', 'are you ai', 'are you a bot', 'are you real', 'are you human', '小千'],
    text: '我是小千，Qianyan Intelligence 官网上的项目问答小助手。我按官网和项目文档里写到的内容回答，不是大模型，也不会联网；遇到没写到的内容，我会直说答不准。',
    next: ['about', 'ai', 'try'] },
  { id: 'price', q: '是收费的吗？', keys: ['收费', '多少钱', '价格', '定价', '费用', '免费', '付费方案', 'pricing', 'price', 'cost', 'free', 'how much'],
    text: '官网没有介绍收费方案。当前版本是在本机运行的演示 Demo，没有连接付费模型，也不会产生真实广告消耗。',
    next: ['real', 'try', 'ai'] },
  { id: 'real', q: '现在能真实投放广告吗？', keys: ['真实投放', '真的投放', '真实广告', '真实付款', '付款', '支付', '扣款', '真实投', '能投放', '能真实', '真的能', 'real ads', 'real money', 'real campaign', 'payment', 'pay', 'simulated', 'simulation', 'is it real'],
    text: '现在不能。广告执行与付款都是模拟的，不会消耗真实广告预算，也不会扣款；没有接入抖音广告账户或支付系统，也没有连接付费模型。页面上的历史数据是虚构的演示数据，不代表实际经营结果。',
    next: ['data', 'limits', 'try'] },
  { id: 'kb', q: '知识库和 RAG 是什么？', keys: ['知识库', 'rag', '检索', '引用', '资料库', '向量', '语义', '导入资料', '上传资料', '导入', '上传', 'bm25', 'embedding', 'retrieval', 'knowledge base', 'knowledge', 'citation', 'citations', 'semantic', 'import', 'upload'],
    text: '「商品与品牌 → 知识库与 RAG」可以导入 TXT、Markdown、文本型 PDF，或直接粘贴文字。先核对解析内容、有效期和适用范围，人工标记「可用」后才会参与生成。\n检索结合了中文分词、关键词排序（BM25）和本地中文语义检索，结果会展示原文片段和页码。要注意：有引用不等于每句话都正确，仍需人工确认。',
    next: ['agent', 'check', 'medical'] },
  { id: 'agent', q: 'AI Agent 能做什么？', keys: ['agent', 'agents', '智能体', '交给ai', '交给 ai', '自动任务', '任务面板', 'ai处理'],
    text: '在「增长工作台 → 交给 AI 处理」里，可以把任务交给 AI Agent：它会先检索资料、读取依据、判断资料够不够，再生成并自检，最后保存成待审阅的草稿。你可以查看执行记录、补充要求、重试、取消、编辑、确认和导出。\n里面有独立的虚构示例，比如医美预约 FAQ 和直播讲解稿。广告投放、发布和支付仍然没有接入真实平台。',
    next: ['kb', 'medical', 'live'] },
  { id: 'demand', q: '怎么导入需求和词库？', keys: ['需求素材', '词库', '需求任务', '需求资料', 'csv', 'xlsx', 'excel', '关键词表', '搜索词', 'search terms', 'term list', 'keyword list', 'terms list'],
    text: '在「商品与品牌 → 需求素材与词库」导入 CSV / TXT / XLSX 需求资料和结构化词库，再到「增长工作台 → 需求任务工作台」配置并启动：先筛选预览，再批量处理（可撤销），结果可追溯，确认后交接到选题或内部 FAQ。\n目前处理的是本地导入或虚构样例，没有接入平台采集和真实线索系统。',
    next: ['agent', 'kb', 'medical'] },
  { id: 'medical', q: '医美内容是怎么做的？', keys: ['医美', '医疗美容', '美容', '整形', '双眼皮', '预约', '咨询', '门诊', 'clinic', 'medical', 'aesthetic', 'aesthetics', 'beauty', 'cosmetic', 'faq'],
    text: '医美内容是用虚构示例演示的：Agent 可以基于知识库生成带引用的医美预约 FAQ 草稿，再由人工确认。\n目前不包含医美咨询、预约和到店台账，也没有接入真实平台；人工确认也不等于通过医疗广告审查。',
    next: ['kb', 'agent', 'limits'] },
  { id: 'live', q: '支持直播吗？', keys: ['直播', '场次', '货盘', 'sku', '抖音', '带货', '讲解稿', 'douyin', 'live', 'livestream', 'live stream', 'streaming'],
    text: '单店直播筹备已支持多商品 / 多 SKU、直播场次、货盘排序和人工确认。Agent 可以生成直播讲解稿（先由模型选取原文事实，再组合成开场、规格展示和收尾三段）；成交会按场次保留，在「效果与获客 → 直播场次复盘」查看，也可以保存到活动报告。\n真实的抖音接口目前还没有接入。',
    next: ['agent', 'real', 'limits'] },
  { id: 'check', q: '内容核对是怎么做的？', keys: ['核对', '事实核对', '规则检查', '规则核对', '校验', '准确', '幻觉', '合规', '违规', '证据', '依据', 'hallucination', 'hallucinate', 'verify', 'fact check', 'fact-check', 'accuracy', 'accurate', 'compliance', 'evidence'],
    text: '内容核对会对照商品资料检查文案里的关键数字，指出冲突、标明缺失依据，并给出逐条核对结果和修订建议；规则检查在服务端实际执行。价格、促销承诺和发布的最终决定，仍然由人工确认。',
    next: ['difference', 'kb', 'ai'] },
  { id: 'ai', q: 'AI 在哪些环节参与？', keys: ['ai在哪', '哪些环节', '大模型', '模型', '智谱', '人工智能', '演示回放', 'ai', 'zhipu', 'llm', 'gpt', 'claude', 'openai', 'chatgpt', 'deepseek', 'model', 'models', 'artificial intelligence', 'which ai', 'what ai'],
    text: '工作台支持接入智谱的免费文本模型，用于创意生成、重新生成和优化复盘，并标明生成来源；没有配置模型时，会使用明确标注的「演示回放」。内容核对里还有服务端执行的规则检查。\n我自己不是大模型——我按官网和项目文档里的内容匹配答案，所以没写到的内容我会直说答不准。',
    next: ['real', 'agent', 'kb'] },
  { id: 'ads', q: '广告投放和成交追踪怎么做？', keys: ['广告投放', '投流', '投放', '成交', '追踪', '归因', '转化', '订单', '效果与获客', 'campaign', 'campaigns', 'ads', 'advertising', 'attribution', 'conversion', 'conversions', 'analytics', 'tracking', 'order', 'orders'],
    text: '广告投放把确认过的创意关联到投放计划，设置预算和周期，并保留素材与配置版本。成交追踪在演示链路里关联广告入口、商品浏览和模拟订单，区分数据来源，并说明每个指标的统计范围。\n这些全部是模拟，不会产生真实消耗。',
    next: ['optimize', 'real', 'data'] },
  { id: 'optimize', q: '优化复盘是什么？', keys: ['优化复盘', '复盘', '优化', '活动报告', '报告', '快照', 'optimize', 'optimise', 'optimization', 'optimisation', 'review', 'report', 'reports', 'iteration', 'snapshot'],
    text: '「AI 优化复盘」基于已经计算好的指标形成复盘，把建议变成新的优化草稿；人工确认后进入观察，并保留完整的调整记录。\n「活动报告」会保存本轮数据与结论，生成可以回看的报告快照。',
    next: ['ads', 'workflow', 'difference'] },
  { id: 'difference', q: '和其他工具有什么不同？', keys: ['不同', '区别', '优势', '特点', '亮点', '差异', '为什么选', '为什么用', '独特', '可信', 'different', 'difference', 'differ', 'advantage', 'unique', 'why use', 'why choose', 'selling point', 'trust', 'trustworthy', 'compared'],
    text: '核心是让智能经得起回看：\n表达有依据：关键数字对照商品事实，缺少证据的描述会被单独标出来。\n动作有来路：资料、素材与计划保留版本，可以沿记录追溯。\n数据有边界：历史演示、现场互动和模拟批次分开统计，算不了的指标会解释原因。\n建议有下一步：复盘建议先形成草稿，确认后再观察。',
    next: ['check', 'data', 'ai'] },
  { id: 'data', q: '示例数据是真的吗？', keys: ['虚构', '保温杯', '青禾', '示例数据', '演示数据', '假数据', '真实数据', '历史数据', '案例', 'thermos', 'cup', 'fictional', 'fake', 'sample data', 'demo data', 'dummy', 'mock', 'case'],
    text: '示例使用虚构的「青禾生活旗舰店」和售价 99 元的演示保温杯；订单都是模拟的，页面上的历史数据也不代表实际经营结果。你在本机编辑过的商品，以当前资料为准。',
    next: ['real', 'try', 'privacy'] },
  { id: 'privacy', q: '数据保存在哪里？', keys: ['隐私', '数据安全', '保存在', '存储', '本机', '本地', '安全', 'privacy', 'secure', 'security', 'storage', 'stored', 'where is data', 'offline', 'local', 'locally'],
    text: '工作台的业务数据保存在本机，中文语义检索的模型也在本机运行。官网里的流程预览是独立示例，不会写入业务数据。',
    next: ['data', 'real', 'tech'] },
  { id: 'tech', q: '用了哪些技术？', keys: ['技术栈', '技术', '架构', '怎么实现', '实现原理', '前端', '后端', '数据库', 'react', 'vite', 'fastapi', 'python', 'typescript', 'sqlite', 'stack', 'tech', 'architecture', 'backend', 'frontend', 'database'],
    text: '前端是 React + Vite + TypeScript，官网和工作台是两个独立入口；后端是 Python FastAPI。资料检索用 SQLite FTS5/BM25 加 jieba 中文分词，可叠加本地 BGE 中文语义检索；AI 生成接入智谱模型，也可使用演示回放。',
    next: ['kb', 'ai', 'privacy'] },
  { id: 'limits', q: '目前有哪些限制？', keys: ['限制', '局限', '边界', '不足', '缺点', '未来', '后续', '计划', '路线', '不支持', '还没', '未接入', '没有接入', 'roadmap', 'limit', 'limits', 'limitation', 'limitations', 'future', 'not supported', 'missing', 'next step'],
    text: '目前的边界：广告执行与付款都是模拟；没有接入真实的抖音广告账户、支付、平台采集、私信和真实咨询线索系统；医美咨询、预约和到店台账也还没有。资料空间只是内容分类，不是多租户权限系统。',
    next: ['real', 'live', 'try'] },
  { id: 'try', q: '怎么亲自体验？', keys: ['体验', '试用', '试试', '怎么用', '怎么开始', '如何开始', '开始使用', '进入工作台', '演示', '运行', '启动', '打开', 'demo', 'try', 'trial', 'get started', 'start', 'how to use', 'how do i use', 'use it', 'run', 'open'],
    text: '点页面里的「进入工作台」就能打开可操作的业务 Demo，也可以点任意一张功能卡片直接进入对应模块。\n第一次体验，建议顺着六步流程走：商品资料 → 创意 → 核对 → 投放 → 成交 → 复盘。\n本机运行时，双击项目根目录的 start-website.cmd 打开官网，或 start-demo.cmd 打开工作台。',
    next: ['modules', 'workflow', 'real'] },
  { id: 'site', q: '官网和工作台是什么关系？', keys: ['官网和工作台', '工作台和官网', '官网与工作台', '工作台与官网', '官网', '关系', 'website', 'workbench', 'homepage', 'home page'],
    text: '官网负责介绍产品、讲解流程；点「进入工作台」才是可以操作的业务 Demo，包含八个模块。官网里的流程预览是独立示例，不会修改工作台数据，也不会调用模型。',
    next: ['try', 'modules', 'ai'] },
  { id: 'modules', q: '有哪些功能模块？', keys: ['功能模块', '哪些功能', '什么功能', '功能列表', '模块', '八个', '八种', '能做什么', '可以做什么', '能干什么', 'features', 'feature', 'modules', 'capabilities', 'what can', 'what does it do'],
    text: '工作台共有八个模块：\n增长工作台（目标、进度与下一步，也可把任务交给 AI Agent）\n商品与品牌（商品资料与知识库）\n营销与创意\n广告投放\n效果与获客\n异常与待办\nAI 优化复盘\n活动报告\n点首屏的功能卡片，就能直接进入对应模块。',
    next: ['workflow', 'agent', 'kb'] },
  { id: 'workflow', q: '完整流程是怎样的？', keys: ['流程', '步骤', '六步', '六个环节', '怎么运作', '工作原理', '怎么工作', 'workflow', 'journey', 'steps', 'how does it work', 'how it works'],
    text: '完整流程有六步：商品资料 → AI 创意 → 内容核对 → 广告投流 → 成交追踪 → 优化复盘。\n每一步的结果都是下一步的依据：核对后的文案才会关联到投放计划，成交记录再回到复盘里。页面中部的「六步流程」可以逐步点开体验。',
    next: ['check', 'ads', 'optimize'] },
  { id: 'about', q: '这个项目是做什么的？', keys: ['做什么的', '项目是做什么', '项目做什么', '做什么', 'what does this project do', 'what is this project', '是什么项目', '什么项目', '介绍', '简介', '项目介绍', '千言', '目的', '用途', '定位', 'qianyan', 'what is this', 'what is qianyan', 'about', 'overview', 'purpose', 'what do you do'],
    text: 'Qianyan Intelligence 是一个面向电商商家与品牌运营团队的 AI 营销增长工作台。它把商品资料、AI 创意、内容核对、广告投流、成交追踪和优化复盘连成一条可以回看的链路：关键数字对照商品事实，每一步保留来路，价格、促销承诺和发布这类最终决定由人来确认。\n目前是可以本机运行的业务 Demo，广告投放与付款都是模拟的。',
    next: ['modules', 'workflow', 'try'] },
];

const byId = new Map(entries.map(entry => [entry.id, entry]));

export const starters = ['about', 'modules', 'ai', 'real', 'try'].map(id => byId.get(id)!.q);
export const greeting = byId.get('greet')!.text;

export const fallback: Reply = {
  id: 'fallback',
  text: '这个问题我暂时答不准。我只能回答官网和项目文档里写到的内容，不想随便猜。可以试试下面这些问题，或者点「进入工作台」亲自看看。',
  next: ['about', 'modules', 'ai'],
  matched: false,
};

const squash = (value: string) => value.toLowerCase().replace(/[\s,.，。！？!?、；;：:“”"'‘’（）()\-_/]+/g, '');
const isLatin = (key: string) => /^[a-z0-9 ]+$/.test(key);
const escapeRegExp = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Score a question against one topic: the sum of the lengths of the phrases it contains. */
function score(entry: Entry, raw: string, squashed: string): number {
  let total = 0;
  const seen = new Set<string>();
  for (const key of [...entry.keys, entry.q]) {
    const needle = squash(key);
    if (!needle || seen.has(needle)) continue;
    seen.add(needle);
    const hit = isLatin(key.toLowerCase())
      ? new RegExp(`(^|[^a-z0-9])${escapeRegExp(key.toLowerCase())}([^a-z0-9]|$)`).test(raw)
      : squashed.includes(needle);
    if (hit) total += needle.length;
  }
  return total;
}

export function chipsFor(ids: string[]): string[] {
  return ids.map(id => byId.get(id)?.q).filter((value): value is string => Boolean(value));
}

export function ask(query: string): Reply {
  const raw = query.toLowerCase().trim();
  const squashed = squash(query);
  if (!squashed) return fallback;
  let best: Entry | undefined;
  let bestScore = 0;
  for (const entry of entries) {
    if ((entry.id === 'greet' || entry.id === 'thanks') && squashed.length > 10) continue; // a greeting inside a real question should not win
    const value = score(entry, raw, squashed);
    if (value > bestScore) { best = entry; bestScore = value; }
  }
  if (!best || bestScore < 2) return fallback;
  return { id: best.id, text: best.text, next: best.next, matched: true };
}
