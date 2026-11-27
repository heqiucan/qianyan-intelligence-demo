import { useCallback, useEffect, useRef, useState } from 'react';
import type { FormEvent, KeyboardEvent } from 'react';
import { RotateCcw, Send, X } from 'lucide-react';
import { ask, chipsFor, greeting, starters } from './assistantKnowledge';
import './assistant.css';

type Message = { id: number; from: 'bot' | 'user'; text: string; topic?: string; chips?: string[] };

const reducedMotion = () => typeof window !== 'undefined' && !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
const firstMessage = (): Message => ({ id: 0, from: 'bot', text: greeting, topic: 'greet', chips: starters });

/** The little robot. Everything that moves is CSS; the eyes follow the pointer through two CSS variables. */
function Robot({ mini = false }: { mini?: boolean }) {
  return <svg className={`qy-bot${mini ? ' qy-bot-mini' : ''}`} viewBox="0 0 100 112" aria-hidden="true" focusable="false">
    {!mini && <ellipse className="qy-bot-shadow" cx="50" cy="106" rx="23" ry="4" />}
    <g className="qy-bot-float">
      <g className="qy-bot-antenna"><line x1="50" y1="20" x2="50" y2="10" /><circle className="qy-bot-bulb" cx="50" cy="7" r="4.6" /></g>
      <rect className="qy-bot-arm qy-bot-arm-left" x="5" y="66" width="11" height="25" rx="5.5" />
      <rect className="qy-bot-arm qy-bot-arm-right" x="84" y="66" width="11" height="25" rx="5.5" />
      <rect className="qy-bot-body" x="30" y="64" width="40" height="32" rx="14" />
      <circle className="qy-bot-core" cx="50" cy="82" r="5" />
      <g className="qy-bot-head">
        <rect className="qy-bot-ear" x="4" y="38" width="10" height="17" rx="5" />
        <rect className="qy-bot-ear" x="86" y="38" width="10" height="17" rx="5" />
        <rect className="qy-bot-skull" x="10" y="18" width="80" height="52" rx="25" />
        <rect className="qy-bot-face" x="19" y="26" width="62" height="36" rx="18" />
        <g className="qy-bot-eyes">
          <ellipse className="qy-bot-eye" cx="38" cy="43" rx="5.6" ry="7.2" />
          <ellipse className="qy-bot-eye" cx="62" cy="43" rx="5.6" ry="7.2" />
        </g>
        <ellipse className="qy-bot-cheek" cx="29" cy="53" rx="4.2" ry="2.5" />
        <ellipse className="qy-bot-cheek" cx="71" cy="53" rx="4.2" ry="2.5" />
        <path className="qy-bot-mouth" d="M45 53.5 Q50 58 55 53.5" />
      </g>
    </g>
  </svg>;
}

export default function RobotAssistant() {
  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState<Message[]>([firstMessage()]);
  const [draft, setDraft] = useState('');
  const [thinking, setThinking] = useState(false);
  const [hint, setHint] = useState(false);
  const nextId = useRef(1);
  const timer = useRef<number>(0);
  const hintDone = useRef(false);
  const launcher = useRef<HTMLButtonElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const log = useRef<HTMLDivElement>(null);

  // A short greeting bubble, once per visit, until the visitor opens the chat.
  useEffect(() => {
    const show = window.setTimeout(() => { if (!hintDone.current) setHint(true); }, 3500);
    const hide = window.setTimeout(() => setHint(false), 12500);
    return () => { window.clearTimeout(show); window.clearTimeout(hide); };
  }, []);

  // The robot's eyes follow the pointer (skipped when the visitor prefers reduced motion).
  useEffect(() => {
    if (reducedMotion()) return;
    let frame = 0;
    const move = (event: PointerEvent) => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        const el = launcher.current; if (!el) return;
        const box = el.getBoundingClientRect();
        const dx = (event.clientX - (box.left + box.width / 2)) / 220;
        const dy = (event.clientY - (box.top + box.height * .4)) / 220;
        el.style.setProperty('--look-x', String(Math.max(-1, Math.min(1, dx)) * 3.4));
        el.style.setProperty('--look-y', String(Math.max(-1, Math.min(1, dy)) * 2.4));
      });
    };
    window.addEventListener('pointermove', move, { passive: true });
    return () => { window.removeEventListener('pointermove', move); cancelAnimationFrame(frame); };
  }, []);

  useEffect(() => () => window.clearTimeout(timer.current), []);
  useEffect(() => { if (open) input.current?.focus(); }, [open]);
  useEffect(() => { const el = log.current; if (el) el.scrollTop = el.scrollHeight; }, [messages, thinking, open]);

  const toggle = () => { hintDone.current = true; setHint(false); setOpen(value => !value); };
  const close = useCallback(() => { setOpen(false); launcher.current?.focus(); }, []);

  const send = useCallback((raw: string) => {
    const text = raw.trim().slice(0, 200);
    if (!text || thinking) return;
    const reply = ask(text);
    setMessages(list => [...list, { id: nextId.current++, from: 'user', text }]);
    setDraft('');
    setThinking(true);
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => {
      setMessages(list => [...list, { id: nextId.current++, from: 'bot', text: reply.text, topic: reply.id, chips: chipsFor(reply.next) }]);
      setThinking(false);
    }, reducedMotion() ? 0 : 550);
  }, [thinking]);

  const reset = () => {
    window.clearTimeout(timer.current);
    setThinking(false); setDraft('');
    nextId.current = 1;
    setMessages([firstMessage()]);
    input.current?.focus();
  };
  const onSubmit = (event: FormEvent) => { event.preventDefault(); send(draft); };
  const onKeyDown = (event: KeyboardEvent) => { if (event.key === 'Escape' && open) { event.stopPropagation(); close(); } };
  const lastBot = [...messages].reverse().find(message => message.from === 'bot')?.id;

  return <div className={`qy-assistant${open ? ' is-open' : ''}${hint ? ' has-hint' : ''}`} onKeyDown={onKeyDown}>
    {open && <section id="qy-assistant-panel" className="qy-assistant-panel" role="dialog" aria-modal="false" aria-labelledby="qy-assistant-title">
      <header className="qy-assistant-head">
        <span className="qy-assistant-avatar" aria-hidden="true"><Robot mini /></span>
        <div><h2 id="qy-assistant-title">小千 · 项目问答</h2><p>Ask me about Qianyan Intelligence</p></div>
        <button type="button" className="qy-assistant-icon" onClick={reset} aria-label="清空对话"><RotateCcw size={15} /></button>
        <button type="button" className="qy-assistant-icon" onClick={close} aria-label="关闭项目问答"><X size={17} /></button>
      </header>
      <div className="qy-assistant-log" ref={log} role="log" aria-live="polite" aria-relevant="additions">
        {messages.map(message => <div key={message.id} className="qy-assistant-row" data-from={message.from}>
          <div className={`qy-msg qy-msg-${message.from}`} data-topic={message.topic}>{message.text}</div>
          {message.from === 'bot' && message.chips && message.id === lastBot && !thinking && <div className="qy-chips">{message.chips.map(chip => <button type="button" key={chip} className="qy-chip" onClick={() => send(chip)}>{chip}</button>)}</div>}
        </div>)}
        {thinking && <div className="qy-msg qy-msg-bot qy-typing" role="status" aria-label="小千正在输入"><i /><i /><i /></div>}
      </div>
      <form className="qy-assistant-form" onSubmit={onSubmit}>
        <input ref={input} value={draft} onChange={event => setDraft(event.target.value)} maxLength={200} placeholder="问问这个项目…" aria-label="输入你的问题" autoComplete="off" />
        <button type="submit" aria-label="发送问题" disabled={!draft.trim() || thinking}><Send size={16} /></button>
      </form>
      <p className="qy-assistant-note">基于官网与项目文档的自动问答，未调用大模型。</p>
    </section>}
    <div className="qy-assistant-dock">
      {hint && !open && <span className="qy-assistant-hint" aria-hidden="true" onClick={toggle}>有问题？问问小千</span>}
      <button ref={launcher} type="button" className={`qy-assistant-launcher${thinking ? ' is-thinking' : ''}`} aria-expanded={open} aria-controls="qy-assistant-panel" aria-label={open ? '关闭项目问答助手' : '打开项目问答助手'} onClick={toggle}><Robot /></button>
    </div>
  </div>;
}
