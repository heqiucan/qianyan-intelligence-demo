import { useEffect, useRef, useState } from 'react';
import { ArrowDown, ArrowRight, ArrowUp, ArrowUpRight, Check, ChevronDown, Menu, Pause, Play, Sparkles, X } from 'lucide-react';
import ParticleField from './ParticleField';
import JourneyPreview from './JourneyPreview';
import RobotAssistant from './RobotAssistant';
import ThemeToggle from './ThemeToggle';
import { audiences, chapters, compareCase, differences, modules, questions, workspaceLink } from './content';

function Brand({ footer = false }: { footer?: boolean }) {
  return <a className={`qy-brand${footer ? ' qy-brand-footer' : ''}`} href="#home" aria-label="Qianyan Intelligence，返回官网首页"><svg viewBox="0 0 44 44" fill="none" aria-hidden="true"><circle cx="20" cy="20" r="12.5" stroke="currentColor" strokeWidth="5" /><path d="M22.5 22.5 38 38" stroke="#8b5cf6" strokeWidth="5" /></svg><span>Qianyan<small>Intelligence</small></span></a>;
}

export default function Website() {
  const [chapter, setChapter] = useState('home');
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
      <nav className="qy-desktop-nav" aria-label="官网主导航">{sectionLink('capabilities', '核心能力')}{sectionLink('journey', '工作流程')}{sectionLink('difference', '我们的不同')}{sectionLink('faq', '常见问题')}</nav>
      <div className="qy-header-actions"><ThemeToggle /><a className="qy-header-cta" href={workspaceLink()}>进入工作台<ArrowUpRight size={16} /></a><button className="qy-menu-button" ref={menuButton} aria-expanded={menuOpen} aria-controls="qy-mobile-menu" aria-label={menuOpen ? '收起导航' : '展开导航'} onClick={() => setMenuOpen(value => !value)}>{menuOpen ? <X size={22} /> : <Menu size={22} />}</button></div>
      <nav id="qy-mobile-menu" className="qy-mobile-menu" aria-label="移动端官网导航" hidden={!menuOpen}>{sectionLink('capabilities', '核心能力')}{sectionLink('journey', '工作流程')}{sectionLink('difference', '我们的不同')}{sectionLink('faq', '常见问题')}{sectionLink('start', '开始体验')}</nav>
    </header>

    <nav className="qy-chapter-rail" aria-label="页面章节">{chapters.map((item, index) => <a key={item.id} href={`#${item.id}`} className={chapter === item.id ? 'active' : ''} aria-label={`第 ${index + 1} 节：${item.label}`} aria-current={chapter === item.id ? 'location' : undefined}><span>{item.label}</span><b>0{index}</b><i /></a>)}</nav>

    <main>
      <section id="home" data-chapter className="qy-hero" aria-labelledby="qy-title">
        <ParticleField paused={paused || reduced} />
        <div className="qy-hero-vignette" aria-hidden="true" />
        <div className="qy-hero-content">
          <div className="qy-hero-intro">
            <p className="qy-kicker">让增长，有迹可循。</p>
            <h1 id="qy-title">一个让营销每一步<br />都<span className="qy-nowrap">有依据</span>的 AI 增长工作台。</h1>
            <p className="qy-hero-benefit">AI 写的文案，发布前自动核对价格和卖点。</p>
            <p className="qy-hero-lead">Qianyan Intelligence 面向电商商家与品牌运营团队，把商品资料、AI 创意、内容核对、广告投流、成交追踪与优化复盘，连成一条可以回看的完整链路。<span className="qy-nowrap">人来决定，AI 来协同。</span></p>
            <div className="qy-hero-actions"><a className="qy-primary-button" href="#journey">探索产品流程<ArrowDown size={16} /></a><a className="qy-text-link" href={workspaceLink()}>直接进入工作台<ArrowUpRight size={15} /></a></div>
            
          </div>
          <div id="capabilities" className="qy-hero-features">
            <div className="qy-features-head"><span>WHAT WE HAVE</span><span>六大工作台，协同向前 · 点击进入对应模块</span></div>
            <div className="qy-module-grid">{modules.map((item, index) => <a key={item.id} href={workspaceLink(item.id)} className="qy-module"><div className="qy-module-top"><item.icon size={22} strokeWidth={1.4} /><span>0{index + 1}</span></div><h3>{item.title}</h3><span className="qy-module-en">{item.english}</span><p>{item.text}</p><span className="qy-module-step">{item.step}</span><ArrowUpRight className="qy-module-arrow" size={19} /></a>)}</div>
          </div>
        </div>
        <div className="qy-hero-footer"><a className="qy-scroll-cue" href="#journey"><span className="qy-scroll-line" />SCROLL TO EXPLORE</a><button className="qy-motion-button" onClick={() => setPaused(value => !value)} disabled={reduced} aria-label={reduced ? '系统已启用减少动态效果' : paused ? '播放背景动效' : '暂停背景动效'}>{paused || reduced ? <Play size={12} /> : <Pause size={12} />}<span>{reduced ? '静态模式' : paused ? '播放动效' : '暂停动效'}</span></button></div>
      </section>

      <section id="journey" data-chapter className="qy-section qy-journey-section">
        <div className="qy-section-eyebrow" data-reveal><span>01 / THE JOURNEY</span></div>
        <div className="qy-section-heading" data-reveal><h2>从一件商品，<br />走到下一次<span>更好的决策。</span></h2></div>
        <JourneyPreview />
      </section>

      <section id="audience" className="qy-section qy-audience" aria-labelledby="qy-audience-title">
        <div className="qy-section-eyebrow" data-reveal><span>WHO IT'S FOR</span><span>适合谁使用</span></div>
        <div className="qy-section-heading" data-reveal><h2 id="qy-audience-title">为每天都在<span>做决定</span>的人。</h2></div>
        <div className="qy-audience-grid">{audiences.map(item => <article key={item.title} data-reveal><item.icon size={22} strokeWidth={1.4} /><h3>{item.title}</h3><p>{item.text}</p></article>)}</div>
      </section>

      <section id="difference" data-chapter className="qy-section qy-difference">
        <div className="qy-section-eyebrow" data-reveal><span>02 / THE DIFFERENCE</span><span>让智能，经得起回看</span></div>
        <div className="qy-difference-intro" data-reveal><h2>有灵感。<br />也有<span>来路。</span></h2><div className="qy-proof-orbit" aria-hidden="true"><div className="qy-proof-ring qy-proof-ring-one" /><div className="qy-proof-ring qy-proof-ring-two" /><div className="qy-proof-core"><Sparkles size={30} strokeWidth={1.2} /><span>Intelligence<br /><strong>with context.</strong></span></div><div className="qy-proof-carousel">{['事实依据', '来源追踪', '人工确认'].map(label => <span key={label} className="qy-proof-slot"><span className="qy-proof-tag"><Check size={12} />{label}</span></span>)}</div></div><p>我们关心 AI 能给出什么，<br />也关心它依据什么、如何使用、怎样验证。</p></div>

        <div className="qy-compare" data-reveal aria-label="普通 AI 文案与核对后文案对比">
          <div className="qy-compare-card qy-compare-before"><span className="qy-tiny-label">{compareCase.before.label}</span><p>{compareCase.before.text.map((part, i) => i % 2 === 1 ? <mark key={i}>{part}</mark> : part)}</p><ul>{compareCase.before.issues.map(issue => <li key={issue}><X size={13} />{issue}</li>)}</ul></div>
          <div className="qy-compare-arrow" aria-hidden="true"><ArrowRight size={20} /></div>
          <div className="qy-compare-card qy-compare-after"><span className="qy-tiny-label">{compareCase.after.label}</span><p>{compareCase.after.text.map((part, i) => i % 2 === 1 ? <em key={i}>{part}</em> : part)}</p><ul>{compareCase.after.checks.map(check => <li key={check}><Check size={13} />{check}</li>)}</ul></div>
        </div>
        <div className="qy-principle-grid">{differences.map((item, index) => <article key={item.title} data-reveal><div className="qy-principle-meta"><item.icon size={20} strokeWidth={1.5} /><span>0{index + 1}</span></div><h3>{item.title}</h3><p>{item.text}</p><span className="qy-tiny-label">{item.label}</span></article>)}</div>
      </section>

      <section id="faq" className="qy-section qy-faq" aria-labelledby="qy-faq-title"><div data-reveal><span className="qy-kicker">A LITTLE MORE CONTEXT</span><h2 id="qy-faq-title">开始之前，<br />你可能想了解。</h2><p>把能力与边界，一起说清楚。</p></div><div className="qy-faq-list">{questions.map(item => <details key={item.q}><summary>{item.q}<ChevronDown size={18} /></summary><p>{item.a}</p></details>)}</div></section>

      <section id="start" data-chapter className="qy-start" aria-labelledby="qy-start-title"><div className="qy-start-orbit" aria-hidden="true" /><div className="qy-start-content" data-reveal><span className="qy-kicker">03 / YOUR NEXT CHAPTER</span><h2 id="qy-start-title">下一步增长，<br />从这里<span>开始。</span></h2><p>带着一个商品、一份灵感，<br className="qy-mobile-break" />走进完整的营销工作流。</p><a className="qy-primary-button" href={workspaceLink()}>进入工作台，亲自体验<ArrowUpRight size={18} /></a></div></section>
    </main>

    <footer className="qy-footer"><div className="qy-footer-main"><Brand footer /><p>让增长，有迹可循。<span>Marketing connected. Decisions informed.</span></p><a className="qy-back-top" href="#home" aria-label="返回页面顶部"><ArrowUp size={19} /></a></div><div className="qy-footer-bottom"><span>© {new Date().getFullYear()} Qianyan Intelligence</span><span>面向电商商家与品牌运营的营销增长工作台</span><a href={workspaceLink()}>进入工作台<ArrowUpRight size={13} /></a></div></footer>
    <RobotAssistant />
    <noscript>请启用 JavaScript 浏览交互式产品介绍。工作台入口：/index.html。</noscript>
  </div>;
}
