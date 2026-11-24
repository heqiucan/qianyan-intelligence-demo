// REAL numbers come from the cleaned term library (795 terms). DEMO numbers are placeholders until the backend logs real searches.

export const TOTAL_TERMS = 795;

// REAL: how the 795 terms are handled (from terms_clean.xlsx)
export const HANDLING = [
  { key: 'auto', label: '可自动推荐', count: 723 },
  { key: 'review', label: '需人工复核', count: 47 },
  { key: 'handoff', label: '转人工顾问', count: 24 },
  { key: 'exclude', label: '已排除', count: 1 },
] as const;

// REAL: terms per service category
export const SERVICE_TERMS = [
  { label: '双眼皮', count: 246 },
  { label: '皮肤 / 激光', count: 125 },
  { label: '吸脂 / 溶脂', count: 93 },
  { label: '丰胸 / 胸部', count: 77 },
  { label: '玻尿酸 / 填充 / 童颜针', count: 55 },
  { label: '隆鼻 / 鼻部', count: 43 },
  { label: '眼部其他', count: 43 },
  { label: '抗衰仪器', count: 42 },
  { label: '除皱针 / 肉毒', count: 39 },
  { label: '私密整形', count: 25 },
  { label: '脱毛', count: 5 },
  { label: '耳部整形', count: 2 },
];

// REAL: what facts the client still has to provide, counted from the term library
export const GAPS = [
  { title: '价格信息', count: 358, detail: '价格类搜索词 358 个。资料里没有已审核的报价，系统不会给出具体价格，只会引导面诊。' },
  { title: '恢复期与风险说明', count: 21, detail: '问效果、恢复、风险的搜索词 21 个。需要机构提供经审核的说明。' },
  { title: '门店所在城市', count: 19, detail: '提到具体城市的搜索词 19 个（广州、成都、南京等）。需要确认门店覆盖哪些城市。' },
  { title: '其他机构的中立话术', count: 33, detail: '提到其他机构或品牌的搜索词 33 个。系统不会复述对方名称，需要确认统一的中立说法。' },
  { title: '私密项目的人工转接', count: 24, detail: '私密类搜索词 24 个。需要人工顾问的话术与转接方式。' },
];

// DEMO: placeholder activity numbers (not real searches)
export const KPI = [
  { label: '本周搜索次数', value: '1,284', foot: '示例数据' },
  { label: '给出机构推荐', value: '912', foot: '占搜索 71%' },
  { label: '转人工顾问', value: '37', foot: '占搜索 3%' },
  { label: '点击预约面诊', value: '126', foot: '占推荐 14%' },
];

export const FUNNEL = [
  { label: '顾客搜索', value: 1284 },
  { label: '匹配到服务', value: 1106 },
  { label: '给出机构推荐', value: 912 },
  { label: '点击预约面诊', value: 126 },
];

// DEMO volumes on REAL terms (tier-A price terms, one per service)
export const TOP_TERMS = [
  { term: '双眼皮多少钱', service: '双眼皮', volume: 186, handling: '可自动推荐' },
  { term: '祛斑价格表', service: '皮肤 / 激光', volume: 142, handling: '可自动推荐' },
  { term: '吸脂价格', service: '吸脂 / 溶脂', volume: 117, handling: '可自动推荐' },
  { term: '丰胸手术多少钱', service: '丰胸 / 胸部', volume: 98, handling: '可自动推荐' },
  { term: '玻尿酸多少钱一支', service: '填充', volume: 76, handling: '可自动推荐' },
  { term: '隆鼻手术多少钱', service: '隆鼻 / 鼻部', volume: 64, handling: '可自动推荐' },
  { term: '除皱针多少钱', service: '除皱针', volume: 51, handling: '可自动推荐' },
  { term: '面部提升一次多少钱', service: '抗衰仪器', volume: 43, handling: '可自动推荐' },
];
