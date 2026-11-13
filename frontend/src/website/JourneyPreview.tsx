import { useState, type KeyboardEvent } from 'react';
import { ArrowRight, Check, ChevronRight, CircleCheck, FileCheck2, Layers, ScanLine, Sparkles, GitBranch, Eye, ShoppingBag, MousePointer2, ShieldCheck } from 'lucide-react';
import { stages, workspaceLink } from './content';

function Preview({ stage }: { stage: number }) {
  const [angle, setAngle] = useState(0);
  const [revised, setRevised] = useState(false);
  const [budget, setBudget] = useState(120);
  const [draft, setDraft] = useState(false);
  if (stage === 0) return <div className="qy-product-preview">
    <div className="qy-product-picture"><img src="/assets/product.svg" width="420" height="480" alt="演示案例：青禾奶油白保温杯插画" /><span>QINGHE / DAILY OBJECTS</span></div>
    <div className="qy-product-facts"><span className="qy-tiny-label">PRODUCT PROFILE · V1</span><h4>让日常，轻一点。</h4><p>青禾随行保温杯</p><dl><div><dt>演示售价</dt><dd>¥99<span>.00</span></dd></div><div><dt>商品容量</dt><dd>500 <span>ml</span></dd></div><div><dt>商品配色</dt><dd className="qy-cream"><i />奶油白</dd></div></dl><div className="qy-inline-note"><FileCheck2 size={15} />价格与规格，有资料来源</div></div>
  </div>;
  if (stage === 1) return <div className="qy-creative-preview">
    <div className="qy-preview-topline"><span><Sparkles size={16} />创意方向</span><span>两种表达 / 示例草稿</span></div>
    <div className="qy-segmented" aria-label="创意示例角度">{['通勤日常', '轻装出行'].map((label, i) => <button key={label} aria-pressed={angle === i} onClick={() => setAngle(i)}>{label}</button>)}</div>
    <div className="qy-copy-paper" key={angle}><span className="qy-tiny-label">CREATIVE {angle === 0 ? '01' : '02'}</span><h4>{angle === 0 ? <>早八的路上，<br />给自己一点从容。</> : <>出发之前，<br />把日常装进行囊。</>}</h4><p>{angle === 0 ? '500 ml 随行容量，奶油白配色。青禾保温杯，陪你走进每一个忙碌日常。' : '去公园，也去街角。带上 500 ml 青禾保温杯，为轻装出行多准备一份日常陪伴。'}</p><div><span>青禾随行保温杯</span><strong>¥99</strong></div></div>
    <p className="qy-preview-note">点击角度切换示例；真实生成请进入工作台。</p>
  </div>;
  if (stage === 2) return <div className="qy-check-preview">
    <div className="qy-preview-topline"><span><ScanLine size={16} />商品事实核对</span><span>人工确认前</span></div>
    <div className="qy-review-copy">{revised ? <>青禾保温杯，<em>99 元</em>，<em>500 ml</em> 随行容量，奶油白配色。</> : <>青禾保温杯，仅需 <mark>79 元</mark>，<mark>1 L</mark> 大容量，<mark>保温 24 小时</mark>。</>}</div>
    <div className="qy-check-rows"><div><span>价格</span><span>资料：99 元</span><strong>{revised ? '已修订' : '与资料冲突'}</strong></div><div><span>容量</span><span>资料：500 ml</span><strong>{revised ? '已修订' : '与资料冲突'}</strong></div><div><span>保温时长</span><span>缺少检测依据</span><strong>{revised ? '已移除承诺' : '需人工核查'}</strong></div></div>
    <button className="qy-outline-button" onClick={() => setRevised(value => !value)}><FileCheck2 size={15} />{revised ? '对比原始示例' : '查看建议文案'}<ArrowRight size={15} /></button>
    <p className="qy-preview-note">示意部分事实核对，不代表完整合规审查或平台过审。</p>
  </div>;
  if (stage === 3) return <div className="qy-plan-preview">
    <div className="qy-preview-topline"><span><Layers size={16} />新品推广计划</span><span className="qy-soft-pill">模拟投放</span></div>
    <div className="qy-plan-creative"><div className="qy-mini-product"><img src="/assets/product.svg" alt="计划关联的演示保温杯" /></div><div><small>已确认创意 · V2</small><h4>给日常一点从容</h4><p>商品成交 / 青禾随行保温杯</p></div><CircleCheck size={20} /></div>
    <label className="qy-budget-label">每日预算 <span>点击调整示例</span></label><div className="qy-budget-options">{[120, 180, 240].map(value => <button key={value} aria-pressed={value === budget} onClick={() => setBudget(value)}>¥{value}</button>)}</div>
    <div className="qy-plan-total"><span>示例周期 <b>7 天</b></span><span>计划预算 <b>¥{budget * 7}</b></span></div>
    <div className="qy-inline-note"><ShieldCheck size={15} />确认素材与预算后，由你决定下一步</div><p className="qy-preview-note">本页预算仅作示意，不创建计划，不产生广告消耗。</p>
  </div>;
  if (stage === 4) return <div className="qy-trace-preview">
    <div className="qy-preview-topline"><span><GitBranch size={16} />一次成交的来路</span><span>案例示意</span></div>
    <div className="qy-trace-path">{[{ icon: Layers, title: '模拟广告计划', detail: '推广计划 / 关联创意 V2' }, { icon: MousePointer2, title: '广告入口点击', detail: '保留计划与素材关联' }, { icon: Eye, title: '浏览商品详情', detail: '青禾随行保温杯' }, { icon: ShoppingBag, title: '模拟支付完成', detail: '示例：1 件 × ¥99 = ¥99' }].map((item, i) => <div key={item.title}><span className="qy-trace-icon"><item.icon size={17} /></span><div><h4>{item.title}</h4><p>{item.detail}</p></div><span className="qy-trace-index">0{i + 1}</span></div>)}</div>
    <p className="qy-preview-note">系统内测试链路示意；不等同于广告平台归因。</p>
  </div>;
  return <div className="qy-insight-preview">
    <div className="qy-preview-topline"><span><Sparkles size={16} />让建议接上行动</span><span>示例流程</span></div>
    <div className="qy-insight-card"><span className="qy-tiny-label">{draft ? 'NEXT CREATIVE · DRAFT' : 'OBSERVE → HYPOTHESIZE'}</span><h4>{draft ? '下一版，试试更清晰的开场。' : '把商品规格，放进开场表达。'}</h4><p>{draft ? '“500 ml 随行容量，奶油白配色。把日常的从容，带在身边。”' : '可以制作一版直接展示容量与外观的创意，与现有版本在一致的数据范围内观察。'}</p><div className="qy-inline-note"><GitBranch size={15} />{draft ? '来源：示例建议 → 新草稿 → 待人工确认' : '优化假设，仍需验证'}</div></div>
    <button className="qy-outline-button" onClick={() => setDraft(value => !value)}>{draft ? <Check size={15} /> : <Sparkles size={15} />}{draft ? '返回复盘建议' : '查看优化草稿'}<ArrowRight size={15} /></button>
    <p className="qy-preview-note">此处为讲解示例，不会保存草稿或宣称效果已经改善。</p>
  </div>;
}

export default function JourneyPreview() {
  const [stage, setStage] = useState(0);
  const selected = stages[stage];
  function handleKey(event: KeyboardEvent<HTMLButtonElement>, index: number) {
    let next = index;
    if (event.key === 'ArrowRight') next = (index + 1) % stages.length;
    else if (event.key === 'ArrowLeft') next = (index - 1 + stages.length) % stages.length;
    else if (event.key === 'Home') next = 0;
    else if (event.key === 'End') next = stages.length - 1;
    else return;
    event.preventDefault(); setStage(next); document.getElementById(`qy-stage-${next}`)?.focus();
  }
  return <div className="qy-journey">
    <div className="qy-stage-tabs" role="tablist" aria-label="探索六步营销流程">{stages.map((item, index) => <button key={item.title} id={`qy-stage-${index}`} role="tab" aria-selected={stage === index} aria-controls="qy-stage-panel" tabIndex={stage === index ? 0 : -1} onClick={() => setStage(index)} onKeyDown={event => handleKey(event, index)}><span>0{index + 1}</span><item.icon size={18} /><strong>{item.title}</strong>{index !== stages.length - 1 && <ChevronRight className="qy-stage-chevron" size={14} />}</button>)}</div>
    <div className="qy-stage-layout" id="qy-stage-panel" role="tabpanel" aria-labelledby={`qy-stage-${stage}`} tabIndex={0}>
      <div className="qy-stage-copy"><span className="qy-kicker">STEP 0{stage + 1} / 06</span><h3>{selected.heading.split('\n').map((line, i) => <span key={line}>{i > 0 && <br />}{line}</span>)}</h3><p>{selected.text}</p><div className="qy-stage-output"><span>这一环节留下什么</span><strong>{selected.output}</strong></div><a className="qy-text-link" href={workspaceLink(selected.link)}>在工作台中体验<ArrowRight size={16} /></a></div>
      <div className="qy-demo-window"><div className="qy-window-bar"><div className="qy-window-dots"><i /><i /><i /></div><span>Qianyan / {selected.title}</span><span className="qy-window-label">交互示例</span></div><div className="qy-window-body" key={stage}><Preview stage={stage} /></div></div>
    </div>
    <div className="qy-journey-bottom"><span>一个虚构保温杯案例，串起完整链路。</span><button className="qy-text-link" onClick={() => setStage(value => (value + 1) % stages.length)}>{stage === stages.length - 1 ? '回到商品起点' : '探索下一步'}<ArrowRight size={16} /></button></div>
  </div>;
}
