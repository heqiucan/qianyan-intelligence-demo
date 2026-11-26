import { useEffect, useRef, useState } from 'react';
import { ArrowRight, Download, FlaskConical, Plus, RotateCcw, ScanSearch } from 'lucide-react';
import WorkspaceTabs from '../../app/WorkspaceTabs';
import GeoOverview, { PlatformChart, TrendChart } from './GeoOverview';
import { DetailDialog, DraftEditor, EntryForm } from './GeoForms';
import { ContentView, KnowledgeView, MonitorView, OptimizeView, ReportTable, stamp } from './GeoViews';
import { advanceTask, createProject, exportText, id, initialStore, report, sampleBatch, sections, storageKey, type Project, type Question, type Section, type Store } from './model';
import './geo.css';

function load(): { store: Store; warning: string } {
  try {
    const raw = localStorage.getItem(storageKey);
    if (!raw) return { store: initialStore(), warning: '' };
    const value = JSON.parse(raw) as Store;
    if (value.version !== 1 || !Array.isArray(value.projects) || !value.projects.length || !value.projects.every(p => typeof p.id === 'string' && typeof p.name === 'string' && typeof p.brand === 'string' && ['questions', 'sources', 'batches', 'drafts', 'tasks'].every(key => Array.isArray(p[key as keyof Project])))) throw new Error();
    // Refresh does not silently resume a simulated job.
    value.projects.forEach(p => p.tasks.forEach(t => { if (t.status === 'running') t.status = 'paused'; }));
    return { store: value, warning: '' };
  } catch { return { store: initialStore(), warning: '本地记录无法读取，当前展示临时样例；原存储未覆盖。可导出后重置。' }; }
}
export default function GeoWorkspace({ route, go, dirtyChanged }: { route: string; go: (route: string) => void; dirtyChanged: (dirty: boolean) => void }) {
  const [loaded] = useState(load), [store, setStore] = useState(loaded.store);
  const [storageError, setStorageError] = useState(loaded.warning), [message, setMessage] = useState('');
  const [form, setForm] = useState<'project' | 'question' | 'source' | null>(null);
  const [allowSave, setAllowSave] = useState(!loaded.warning);
  const root = useRef<HTMLDivElement>(null);
  const params = new URLSearchParams(route.split('?')[1] || '');
  const project = store.projects.find(p => p.id === params.get('project')) || store.projects[0];
  const section = (sections.some(([key]) => key === params.get('view')) ? params.get('view') : 'overview') as Section;
  const item = params.get('item');
  const navigate = (view: Section, selected?: string) => go(`geo?project=${encodeURIComponent(project.id)}&view=${view}${selected ? '&item=' + encodeURIComponent(selected) : ''}`);
  const update = (fn: (project: Project) => Project) => setStore(old => ({ ...old, projects: old.projects.map(p => p.id === project.id ? fn(p) : p) }));
  useEffect(() => {
    if (!allowSave) return;
    try { localStorage.setItem(storageKey, JSON.stringify(store)); setStorageError(''); }
    catch { setStorageError('浏览器存储不可用，修改仅保留在本次页面中；请及时导出。'); }
  }, [store, allowSave]);
  const running = store.projects.some(p => p.tasks.some(t => t.status === 'running'));
  useEffect(() => {
    if (!running) return;
    const timer = setInterval(() => setStore(old => ({ ...old, projects: old.projects.map(p => p.tasks.reduce((result, task) => advanceTask(result, task.id), p)) })), 1000);
    return () => clearInterval(timer);
  }, [running]);
  useEffect(() => {
    const element = root.current, header = element?.closest('.workspace-frame')?.querySelector('.topbar');
    if (!element || !header) return;
    const measure = () => element.style.setProperty('--geo-header-height', `${header.getBoundingClientRect().height}px`);
    const observer = new ResizeObserver(measure); observer.observe(header); measure(); return () => observer.disconnect();
  }, []);
  useEffect(() => { if (!message) return; const timer = setTimeout(() => setMessage(''), 4000); return () => clearTimeout(timer); }, [message]);
  const sample = () => {
    if (!project.questions.length) { setMessage('请先添加目标问题。'); return; }
    update(p => ({ ...p, batches: [...p.batches, sampleBatch(p)] })); setMessage('样例采样已完成，未向外部平台发送请求。');
  };
  const start = (question: Question) => {
    if (!project.sources.some(s => s.approved)) return;
    const existing = project.tasks.find(t => t.questionId === question.id);
    if (existing) { document.getElementById('geo-task-' + existing.id)?.scrollIntoView({ block: 'center' }); return; }
    update(p => ({ ...p, tasks: [...p.tasks, { id: id(), questionId: question.id, step: 0, status: 'running', draftId: id() }] })); setMessage('本地模拟任务已创建。'); navigate('optimize');
  };
  const saveForm = (data: FormData) => {
    const title = String(data.get('title') || '').trim();
    if (form === 'project') {
      const brand = String(data.get('brand') || '').trim(); if (!brand) return;
      const next = createProject(title, brand); dirtyChanged(false); setStore(old => ({ ...old, projects: [...old.projects, next] })); go(`geo?project=${next.id}`);
    } else if (form === 'question') {
      if (project.questions.some(q => q.text === title)) { setMessage('该问题已存在。'); return; }
      update(p => ({ ...p, questions: [...p.questions, { id: id(), text: title, intent: String(data.get('intent')), priority: String(data.get('priority')) }] }));
    } else {
      const text = String(data.get('text') || '').trim(); if (!text) return;
      update(p => ({ ...p, sources: [...p.sources, { id: id(), title, text, kind: String(data.get('kind')), approved: false }] }));
    }
    setForm(null); setMessage('已保存到当前浏览器。');
  };
  const reset = () => { if (!confirm('重置全部 GEO 本地项目和修改？此操作不会修改其他业务数据。')) return; setStore(initialStore()); setAllowSave(true); go('geo'); setMessage('已恢复初始样例。'); };
  const selectedDraft = section === 'content' ? project.drafts.find(d => d.id === item) : undefined;
  const batch = section === 'monitor' ? project.batches.find(b => b.observations.some(o => o.id === item)) : undefined;
  const observation = batch?.observations.find(o => o.id === item);
  const shared = { project, update, navigate };
  return <div className="geo-workspace" ref={root}>
    <div className="geo-context"><div><FlaskConical size={15}/><span>样例数据 · 未连接外部平台</span></div><span>本地保存</span></div>
    <div className="geo-project-controls"><select aria-label="GEO 项目" value={project.id} onChange={e => go(`geo?project=${e.target.value}&view=${section}`)}>{store.projects.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}</select><div className="geo-actions"><button className="button" onClick={() => setForm('project')}><Plus size={15}/>新建项目</button><button className="geo-icon" title="导出本地项目数据" aria-label="导出本地项目数据" onClick={() => exportText('GEO-样例项目.json', JSON.stringify(store, null, 2), 'application/json')}><Download size={17}/></button><button className="geo-icon" title="重置样例" aria-label="重置样例" onClick={reset}><RotateCcw size={17}/></button></div></div>
    <div className="geo-sticky"><WorkspaceTabs label="GEO 功能" selected={section} items={sections.map(([key, label]) => ({ id: key, label, route: `geo?project=${project.id}&view=${key}` }))} go={go}/></div>
    {storageError && <p className="geo-notice" role="alert">{storageError}</p>}
    {message && <p className="geo-toast" role="status">{message}</p>}
    <div key={project.id} className="geo-body">
      {section === 'overview' && <GeoOverview project={project} navigate={navigate} sample={sample}/>}
      {section === 'knowledge' && <KnowledgeView {...shared} add={() => setForm('source')}/>}
      {section === 'monitor' && <><div className="geo-section-head"><span className="geo-muted">{project.batches.length} 个样例批次 · {project.questions.length * 3} 条计划采样</span><button className="button primary" disabled={!project.questions.length} onClick={sample}><ScanSearch size={15}/>模拟采样</button></div><MonitorView {...shared} add={() => setForm('question')}/></>}
      {section === 'optimize' && <OptimizeView {...shared} start={start}/>}
      {section === 'content' && <ContentView {...shared}/>}
      {section === 'reports' && <><div className="geo-section-head"><h2>可见性与证据报告</h2><div className="geo-actions"><button className="button" disabled={!project.questions.length} onClick={sample}><ScanSearch size={15}/>模拟复测</button><button className="button primary" onClick={() => exportText('GEO-样例报告.md', report(project))}><Download size={15}/>导出报告</button></div></div><div className="geo-two-columns"><PlatformChart project={project}/><TrendChart project={project}/></div><ReportTable project={project}/></>}
    </div>
    {form && <EntryForm kind={form} close={() => setForm(null)} save={saveForm} dirtyChanged={dirtyChanged}/>}
    {selectedDraft && <DraftEditor key={selectedDraft.id} draft={selectedDraft} close={() => navigate('content')} save={draft => { update(p => ({ ...p, drafts: p.drafts.map(d => d.id === draft.id ? draft : d) })); setMessage('内容状态已保存。'); }} dirtyChanged={dirtyChanged}/>}
    {observation && <DetailDialog title="回答证据" close={() => navigate('monitor')}><span className="geo-status">固定样例 · 非平台实际回答</span><h3>{project.questions.find(q => q.id === observation.questionId)?.text}</h3><p className="geo-muted">{observation.platform} · {stamp(batch!.date)} · 联网条件：未接入</p><blockquote>{observation.answer}</blockquote><h3>引用来源</h3><p>{observation.reference || '未提供引用'}</p>{observation.reference && <p className="geo-muted">example.com 为占位来源，不作为真实证据。</p>}<h3>诊断记录</h3><p>{observation.status === 'failed' ? '无有效回答，不参与指标计算。' : observation.inaccurate ? '疑似误述：与样例产品说明的接入边界存在冲突。' : observation.mentioned ? '已出现品牌；引用完整性与事实仍需人工核验。' : '未出现目标品牌；缺失原因尚不能确定。'}</p><button className="button" onClick={() => navigate('optimize')}>进入诊断队列<ArrowRight size={15}/></button></DetailDialog>}
    {item && !observation && !selectedDraft && <DetailDialog title="记录不存在" close={() => navigate(section)}><p>该记录不属于当前项目，或已被重置。</p></DetailDialog>}
  </div>;
}
