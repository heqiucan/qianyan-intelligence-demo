import { useEffect, useRef, useState } from 'react';
import { ArrowDown, ArrowRight, ArrowUp, ArrowUpRight, Check, ChevronDown, Menu, Pause, Play, Sparkles, X } from 'lucide-react';
import ParticleField from './ParticleField';
import type { ParticleScene } from './particleEngine';
import JourneyPreview from './JourneyPreview';
import { chapters, differences, modules, questions, workspaceLink } from './content';

function Brand({ footer = false }: { footer?: boolean }) {
  return <a className={`qy-brand${footer ? ' qy-brand-footer' : ''}`} href="#home" aria-label="Qianyan Intelligence，返回官网首页"><svg viewBox="0 0 44 44" fill="none" aria-hidden="true"><ellipse cx="21" cy="20" rx="16" ry="9" transform="rotate(-42 21 20)" /><ellipse cx="21" cy="20" rx="16" ry="9" transform="rotate(42 21 20)" /><path d="m26 27 11 12" /><circle cx="21" cy="20" r="2" fill="currentColor" stroke="none" /></svg><span>Qianyan<small>Intelligence</small></span></a>;
}

export default function Website() {
  const [chapter, setChapter] = useState('home');
  const [scene, setScene] = useState<ParticleScene>('orbit');
  const [paused, setPaused] = useState(false);
  const [reduced, setReduced] = useState(() => window.matchMedia('(prefers-reduced-motion: reduce)').matches);
  const [menuOpen, setMenuOpen] = useState(false);
  const menuButton = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    const media = window.matchMedia('(prefers-reduced-motion: reduce)');
    const update = () => setReduced(media.matches);
    media.addEventListener('change', update);
    const escape = (event: KeyboardEvent) => { if (event.key === 'Escape') { setMenuOpen(false); if (document.activeElement?.closest('.qy-mobile-menu')) menuButton.current?.focus(); } };
    document.addEventListener('keydown', escape);
    const chapterObserver = new IntersectionObserver(entries => {
      for (const entry of entries) if (entry.isIntersecting) setChapter(entry.target.id);
    }, { rootMargin: '-15% 0px -65% 0px', threshold: 0 });
    document.querySelectorAll('[data-chapter]').forEach(element => chapterObserver.observe(element));
    const revealObserver = new IntersectionObserver(entries => {
      for (const entry of entries) if (entry.isIntersecting) { entry.target.classList.add('qy-is-visible'); revealObserver.unobserve(entry.target); }
    }, { threshold: .08 });
    document.querySelectorAll('[data-reveal]').forEach(element => revealObserver.observe(element));
    return () => { media.removeEventListener('change', update); document.removeEventListener('keydown', escape); chapterObserver.disconnect(); revealObserver.disconnect(); };
  }, []);

  const sectionLink = (id: string, label: string) => <a href={`#${id}`} aria-current={chapter === id ? 'location' : undefined} onClick={() => setMenuOpen(false)}>{label}</a>;
  return <div className="qy-site">
    <a className="qy-skip-link" href="#journey">跳到产品流程</a>
    <header className={`qy-header${chapter !== 'home' ? ' qy-header-scrolled' : ''}`}>
      <Brand />
      <nav className="qy-desktop-nav" aria-label="官网主导航">{sectionLink('approach', '产品理念')}{sectionLink('journey', '工作流程')}{sectionLink('capabilities', '核心能力')}{sectionLink('difference', '我们的不同')}</nav>
      <div className="qy-header-actions"><a className="qy-header-cta" href={workspaceLink()}>进入工作台<ArrowUpRight size={16} /></a><button className="qy-menu-button" ref={menuButton} aria-expanded={menuOpen} aria-controls="qy-mobile-menu" aria-label={menuOpen ? '收起导航' : '展开导航'} onClick={() => setMenuOpen(value => !value)}>{menuOpen ? <X size={22} /> : <Menu size={22} />}</button></div>
      <nav id="qy-mobile-menu" className="qy-mobile-menu" aria-label="移动端官网导航" hidden={!menuOpen}>{sectionLink('approach', '产品理念')}{sectionLink('journey', '工作流程')}{sectionLink('capabilities', '核心能力')}{sectionLink('difference', '我们的不同')}{sectionLink('start', '开始体验')}</nav>
    </header>

    <nav className="qy-chapter-rail" aria-label="页面章节">{chapters.map((item, index) => <a key={item.id} href={`#${item.id}`} className={chapter === item.id ? 'active' : ''} aria-label={`第 ${index + 1} 节：${item.label}`} aria-current={chapter === item.id ? 'location' : undefined}><span>{item.label}</span><b>0{index}</b><i /></a>)}</nav>

    <main>
      <section id="home" data-chapter className="qy-hero" aria-labelledby="qy-title">
        <ParticleField scene={scene} paused={paused || reduced} />
        <div className="qy-hero-vignette" aria-hidden="true" />
        <div className="qy-hero-caption"><span className="qy-live-dot" />A NEW PERSPECTIVE ON GROWTH<span className="qy-caption-right">人来决定，AI 来协同。</span></div>
        <div className="qy-hero-content">
          <div className="qy-hero-title"><p className="qy-kicker">让增长，有迹可循。</p><h1 id="qy-title">Qianyan<br /><span>Intelligence<span className="qy-title-period">.</span></span></h1></div>
          <div className="qy-hero-description"><p>把每一次灵感，<br />连接到下一步增长。</p><span>从商品到创意，从投放到复盘。<br />为电商商家与品牌运营，连接完整营销链路。</span><a className="qy-primary-button" href="#journey">探索产品流程<ArrowDown size={16} /></a></div>
        </div>
        <div className="qy-hero-footer"><a className="qy-scroll-cue" href="#approach"><span className="qy-scroll-line" />SCROLL TO EXPLORE</a><div className="qy-scene-controls" aria-label="背景粒子形态">{([{ id: 'orbit', label: '轨道', en: 'ORBIT' }, { id: 'flow', label: '流动', en: 'FLOW' }, { id: 'converge', label: '聚合', en: 'FOCUS' }] as const).map((item, index) => <button key={item.id} aria-label={`${item.label}粒子形态`} aria-pressed={scene === item.id} onClick={() => setScene(item.id)}><span>0{index + 1}</span>{item.en}</button>)}</div><button className="qy-motion-button" onClick={() => setPaused(value => !value)} disabled={reduced} aria-label={reduced ? '系统已启用减少动态效果' : paused ? '播放背景动效' : '暂停背景动效'}>{paused || reduced ? <Play size={12} /> : <Pause size={12} />}<span>{reduced ? '静态模式' : paused ? '播放动效' : '暂停动效'}</span></button></div>
      </section>

      <section id="approach" data-chapter className="qy-section qy-approach">
        <div className="qy-section-eyebrow" data-reveal><span>01 / THE CONNECTION</span><span>从零散动作，到完整链路</span></div>
        <div className="qy-approach-heading" data-reveal><h2>创意不止于生成。<br />增长，需要<span>连接。</span></h2><div><p>商品资料、创意版本、广告计划、成交记录……<br className="qy-desktop-break" />当它们散落在不同地方，下一步往往无从判断。</p><p>Qianyan Intelligence 将这些环节放回同一条线上。<br className="qy-desktop-break" />让内容有依据，让投放可追踪，让复盘接上行动。</p></div></div>
        <div className="qy-connection-line" data-reveal>{['商品事实', '营销创意', '广告投流', '成交与获客', '持续优化'].map((label, index) => <div key={label}><span>0{index + 1}</span><strong>{label}</strong>{index < 4 && <ArrowRight size={20} />}</div>)}</div>
        <div className="qy-approach-footer"><span>为电商商家 · 品牌运营 · 增长团队设计</span><a href="#journey" className="qy-text-link">看看它如何工作<ArrowDown size={15} /></a></div>
      </section>

      <section id="journey" data-chapter className="qy-section qy-journey-section">
        <div className="qy-section-eyebrow" data-reveal><span>02 / THE JOURNEY</span><span>点击步骤，体验产品逻辑</span></div>
        <div className="qy-section-heading" data-reveal><h2>从一件商品，<br />走到下一次<span>更好的决策。</span></h2><p>六个环节，一条连续的工作流。<br />每一步，都为下一步留下依据。</p></div>
        <JourneyPreview />
      </section>

      <section id="capabilities" data-chapter className="qy-section qy-capabilities">
        <div className="qy-section-eyebrow" data-reveal><span>03 / THE WORKSPACE</span><span>让日常运营，各就其位</span></div>
        <div className="qy-section-heading" data-reveal><h2>一个工作空间。<br /><span>八种能力，协同向前。</span></h2><a className="qy-outline-button" href={workspaceLink()}>打开完整工作台<ArrowUpRight size={16} /></a></div>
        <div className="qy-module-grid">{modules.map((item, index) => <a key={item.id} href={workspaceLink(item.id)} className="qy-module" data-reveal><div className="qy-module-top"><item.icon size={22} strokeWidth={1.4} /><span>0{index + 1}</span></div><h3>{item.title}</h3><span className="qy-module-en">{item.english}</span><p>{item.text}</p><ArrowUpRight className="qy-module-arrow" size={19} /></a>)}</div>
        <p className="qy-module-footnote"><span className="qy-live-dot" />点击功能，进入现有 Demo 对应模块。</p>
      </section>

      <section id="difference" data-chapter className="qy-section qy-difference">
        <div className="qy-section-eyebrow" data-reveal><span>04 / THE DIFFERENCE</span><span>让智能，经得起回看</span></div>
        <div className="qy-difference-intro" data-reveal><h2>有灵感。<br />也有<span>来路。</span></h2><div className="qy-proof-orbit" aria-hidden="true"><div className="qy-proof-ring qy-proof-ring-one" /><div className="qy-proof-ring qy-proof-ring-two" /><div className="qy-proof-core"><Sparkles size={30} strokeWidth={1.2} /><span>Intelligence<br /><strong>with context.</strong></span></div><span className="qy-proof-tag qy-proof-tag-one"><Check size={12} />事实依据</span><span className="qy-proof-tag qy-proof-tag-two"><Check size={12} />人工确认</span><span className="qy-proof-tag qy-proof-tag-three"><Check size={12} />来源追踪</span></div><p>我们关心 AI 能给出什么，<br />也关心它依据什么、如何使用、怎样验证。</p></div>
        <div className="qy-principle-grid">{differences.map((item, index) => <article key={item.title} data-reveal><div className="qy-principle-meta"><item.icon size={20} strokeWidth={1.5} /><span>0{index + 1}</span></div><h3>{item.title}</h3><p>{item.text}</p><span className="qy-tiny-label">{item.label}</span></article>)}</div>
      </section>

      <section className="qy-section qy-faq" aria-labelledby="qy-faq-title"><div data-reveal><span className="qy-kicker">A LITTLE MORE CONTEXT</span><h2 id="qy-faq-title">开始之前，<br />你可能想了解。</h2><p>把能力与边界，一起说清楚。</p></div><div className="qy-faq-list">{questions.map(item => <details key={item.q}><summary>{item.q}<ChevronDown size={18} /></summary><p>{item.a}</p></details>)}</div></section>

      <section id="start" data-chapter className="qy-start" aria-labelledby="qy-start-title"><div className="qy-start-orbit" aria-hidden="true" /><div className="qy-start-content" data-reveal><span className="qy-kicker">05 / YOUR NEXT CHAPTER</span><h2 id="qy-start-title">下一步增长，<br />从这里<span>开始。</span></h2><p>带着一个商品、一份灵感，<br className="qy-mobile-break" />走进完整的营销工作流。</p><a className="qy-primary-button" href={workspaceLink()}>进入工作台，亲自体验<ArrowUpRight size={18} /></a><span className="qy-start-note">业务 Demo · 广告投放与付款均为模拟</span></div></section>
    </main>

    <footer className="qy-footer"><div className="qy-footer-main"><Brand footer /><p>让增长，有迹可循。<span>Marketing connected. Decisions informed.</span></p><a className="qy-back-top" href="#home" aria-label="返回页面顶部"><ArrowUp size={19} /></a></div><div className="qy-footer-bottom"><span>© {new Date().getFullYear()} Qianyan Intelligence</span><span>面向电商商家与品牌运营的营销增长 Demo</span><a href={workspaceLink()}>进入工作台<ArrowUpRight size={13} /></a></div></footer>
    <noscript>请启用 JavaScript 浏览交互式产品介绍。业务演示入口：/index.html。</noscript>
  </div>;
}
