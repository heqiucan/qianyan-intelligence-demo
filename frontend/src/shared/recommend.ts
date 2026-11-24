import { api, ApiError, requestId } from '../api';

// Shape of the agent's reply. The backend returns exactly this from POST /api/recommend.
export type Handling = 'auto' | 'review' | 'handoff';
export interface Citation { document: string; location: string; text: string }
export interface Benefit { text: string; citation: number }
export interface Recommendation {
  search_id?: string;   // present when the answer came from the real backend
  matched: { term: string; service: string | null; intent: string | null };
  handling: Handling;
  answer: string;
  citations: Citation[];
  recommendation: { clinic: string; benefits: Benefit[]; cta: string; ad_label: string } | null;
  gaps: string[];
}

const CLINIC = 'XX 医美机构（演示）';
const DOC = 'XX 医美服务说明（虚构演示资料）';

interface Service { name: string; keys: string[]; facts: string[]; benefits: [string, number][] }
const SERVICES: Service[] = [
  { name: '双眼皮', keys: ['双眼皮', '重睑'], facts: ['提供埋线与切开两种双眼皮方案。', '具体方式需经医生面诊评估后确定。'], benefits: [['先面诊评估，再制定个性化方案', 1], ['提供术前沟通与术后随访', 0]] },
  { name: '吸脂/溶脂', keys: ['吸脂', '溶脂'], facts: ['提供局部吸脂咨询服务。', '是否适合需经面诊与身体检查评估。'], benefits: [['先评估身体状况，再说明可选方案', 1]] },
  { name: '丰胸', keys: ['丰胸', '隆胸'], facts: ['提供丰胸方案咨询，包括假体与自体脂肪两类。', '方案选择以医生面诊评估为准。'], benefits: [['两类方案均可咨询，由医生按个人情况说明', 0]] },
  { name: '祛斑/激光', keys: ['祛斑', '嫩肤', '皮秒', '祛疤', '祛痘'], facts: ['提供激光类皮肤项目咨询。', '需先判断皮肤问题类型，再确定是否适合。'], benefits: [['先判断皮肤问题类型，再给建议', 1]] },
  { name: '玻尿酸/填充', keys: ['玻尿酸', '填充', '童颜针', '水光针'], facts: ['提供注射填充类项目咨询。', '注射前需经医生评估部位与产品选择。'], benefits: [['注射前由医生评估部位与产品', 1]] },
  { name: '除皱针', keys: ['除皱', '肉毒'], facts: ['提供除皱注射项目咨询。', '是否适合及注射方案需面诊后确定。'], benefits: [['面诊后确定是否适合及方案', 1]] },
  { name: '隆鼻', keys: ['隆鼻', '鼻'], facts: ['提供隆鼻方案咨询服务。', '具体方案需医生面诊评估。'], benefits: [['由医生面诊评估后说明方案', 1]] },
];
const INTENTS: [string, string[]][] = [
  ['价格咨询', ['多少钱', '价格', '费用', '价目', '钱']],
  ['方案对比', ['好还是', '哪个好', '还是', '区别']],
  ['找机构/口碑', ['医院', '机构', '哪家', '排名', '最好', '正规', '口碑', '怎么样']],
  ['效果/风险/恢复', ['效果', '多久', '恢复', '安全', '风险', '维持']],
  ['做法/原理', ['怎么做', '如何', '怎么']],
];
const COMPETITORS = ['艺星', 'yestar', '南医大', '艾维岚', '威塑', '叶子', '曙光', '军大', '大华', '铜雀台', '韩美', '海薇'];
const SENSITIVE = ['私密', '生殖'];

// Offline fallback: only used when the backend cannot be reached (so the demo never shows a blank screen).
async function mockRecommendation(query: string): Promise<Recommendation> {
  await new Promise(resolve => setTimeout(resolve, 600));
  const term = query.replace(/\s+/g, '');
  const lower = term.toLowerCase();
  const service = SERVICES.find(s => s.keys.some(k => term.includes(k))) ?? null;
  const intent = INTENTS.find(([, keys]) => keys.some(k => term.includes(k)))?.[0] ?? null;
  const matched = { term, service: service?.name ?? null, intent };

  if (SENSITIVE.some(k => term.includes(k))) {
    return { matched: { ...matched, service: '私密整形' }, handling: 'handoff', citations: [], recommendation: null,
      answer: '这类咨询涉及隐私和较高风险，系统不自动推荐，将转由人工顾问一对一沟通。', gaps: ['敏感话题：转人工顾问'] };
  }
  if (!service) {
    return { matched, handling: 'review', citations: [], recommendation: null,
      answer: '暂未匹配到相关服务。你可以换个说法，或联系人工顾问。', gaps: ['未匹配到服务类别：需补充词表或资料'] };
  }
  const citations: Citation[] = service.facts.map((text, i) => ({ document: DOC, location: `第 ${i + 1} 段`, text }));
  const neutral = COMPETITORS.some(c => lower.includes(c.toLowerCase()));
  const gaps: string[] = [];
  let body: string;
  if (intent === '价格咨询') { body = '费用因个人情况和方案而异，需要先面诊评估后才能确定。' + service.facts[0]; gaps.push('资料中暂无已审核的价格信息，系统不会给出具体报价'); }
  else if (intent === '方案对比') body = '不同方案各有适合的人群，不能一概而论，需要结合个人情况评估。' + service.facts[0];
  else if (intent === '效果/风险/恢复') { body = '效果、恢复期和风险因人而异，需由执业医师面诊评估后说明。' + service.facts[0]; gaps.push('缺少已审核的恢复期与风险说明资料'); }
  else if (intent === '找机构/口碑') body = `${CLINIC}提供${service.name}相关服务。` + service.facts[0];
  else body = service.facts.join('');
  const answer = (neutral ? '为保持中立，这里不对其他机构作评价。' : '') + body;
  return {
    matched, handling: neutral ? 'review' : 'auto', answer, citations, gaps,
    recommendation: { clinic: CLINIC, ad_label: '广告', cta: '预约面诊', benefits: service.benefits.map(([text, citation]) => ({ text, citation })) },
  };
}

// The real call. Falls back to the offline mock ONLY when the server is unreachable (status 0) or the route is missing (404).
export async function getRecommendation(query: string): Promise<Recommendation> {
  try {
    return await api<Recommendation>('/recommend', 'POST', { query, request_id: requestId() });
  } catch (error) {
    if (error instanceof ApiError && (error.status === 0 || error.status === 404)) return mockRecommendation(query);
    throw error;
  }
}

// Tells the backend that the customer clicked the booking button (feeds the dashboard funnel).
export async function trackBooking(searchId: string): Promise<void> {
  try { await api('/recommend/' + encodeURIComponent(searchId) + '/click', 'POST'); } catch { /* tracking must never break the page */ }
}
