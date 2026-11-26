import { useEffect, useRef, useState } from 'react';
import { ArrowLeft, ArrowRight, ChevronRight, Download, FlaskConical, Plus, ScanSearch } from 'lucide-react';
import WorkspaceTabs from '../../app/WorkspaceTabs';
import GeoOverview, { PlatformChart, TrendChart } from './GeoOverview';
import GeoProjects from './GeoProjects';
import { DetailDialog, DraftEditor, EntryForm } from './GeoForms';
import { ContentView, KnowledgeView, MonitorView, OptimizeView, ReportTable, stamp } from './GeoViews';
import {
  advanceTask, createProject, exportText, id, initialStore, projectRoute, report,
  resolveGeoRoute, restoreStore, sampleBatch, sections, storageKey,
  type Project, type Question, type Section, type Store,
} from './model';
import './geo.css';

function load(): { store: Store; warning: string } {
  try {
    return { store: restoreStore(localStorage.getItem(storageKey)), warning: '' };
  } catch {
    return {
      store: initialStore(),
      warning: '本地记录无法读取，当前展示临时样例；原存储未覆盖，本次修改仅保留在页面中。',
    };
  }
}

interface Props {
  route: string;
  go: (route: string) => void;
  dirtyChanged: (dirty: boolean) => void;
}

export default function GeoWorkspace({ route, go, dirtyChanged }: Props) {
  const [loaded] = useState(load);
  const [store, setStore] = useState(loaded.store);
  const [storageError, setStorageError] = useState(loaded.warning);
  const [message, setMessage] = useState('');
  const [form, setForm] = useState<'project' | 'question' | 'source' | null>(null);
  const root = useRef<HTMLDivElement>(null);
  const { project, projectId, section, item } = resolveGeoRoute(route, store);
  const showProjects = !project || section === 'projects';
  const selectedSection = section === 'overview' || section === 'knowledge' ? 'projects' : section;
  const selectedDraft = section === 'content' ? project?.drafts.find(draft => draft.id === item) : undefined;
  const batch = section === 'monitor'
    ? project?.batches.find(candidate => candidate.observations.some(observation => observation.id === item))
    : undefined;
  const observation = batch?.observations.find(candidate => candidate.id === item);
  const sectionLabel = section === 'overview' ? '项目总览'
    : section === 'knowledge' ? '关联资料'
    : sections.find(([key]) => key === section)?.[1];

  const navigate = (view: Section, selected?: string) => {
    go(view === 'projects' || !project ? 'geo' : projectRoute(project.id, view, selected));
  };
  const update = (fn: (project: Project) => Project) => {
    if (!project) return;
    setStore(previous => ({
      ...previous,
      projects: previous.projects.map(candidate => candidate.id === project.id ? fn(candidate) : candidate),
    }));
  };

  useEffect(() => {
    if (loaded.warning) return;
    try {
      localStorage.setItem(storageKey, JSON.stringify(store));
      setStorageError('');
    } catch {
      setStorageError('浏览器存储不可用，修改仅保留在本次页面中；请及时导出。');
    }
  }, [store, loaded.warning]);

  const running = store.projects.some(candidate => candidate.tasks.some(task => task.status === 'running'));
  useEffect(() => {
    if (!running) return;
    const timer = setInterval(() => setStore(previous => ({
      ...previous,
      projects: previous.projects.map(candidate =>
        candidate.tasks.reduce((result, task) => advanceTask(result, task.id), candidate)
      ),
    })), 1000);
    return () => clearInterval(timer);
  }, [running]);

  useEffect(() => {
    const element = root.current;
    const header = element?.closest('.workspace-frame')?.querySelector('.topbar');
    if (!element || !header) return;
    const measure = () => element.style.setProperty('--geo-header-height', `${header.getBoundingClientRect().height}px`);
    const observer = new ResizeObserver(measure);
    observer.observe(header);
    measure();
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (!message) return;
    const timer = setTimeout(() => setMessage(''), 4000);
    return () => clearTimeout(timer);
  }, [message]);

  // A successful guarded route change closes the previous project's entry form.
  useEffect(() => setForm(null), [route]);

  const sample = () => {
    if (!project?.questions.length) {
      setMessage('请先添加目标问题。');
      return;
    }
    update(current => ({ ...current, batches: [...current.batches, sampleBatch(current)] }));
    setMessage('样例采样已完成，未向外部平台发送请求。');
  };

  const start = (question: Question) => {
    if (!project?.sources.some(source => source.approved)) return;
    const existing = project.tasks.find(task => task.questionId === question.id);
    if (existing) {
      document.getElementById('geo-task-' + existing.id)?.scrollIntoView({ block: 'center' });
      return;
    }
    update(current => ({
      ...current,
      tasks: [...current.tasks, { id: id(), questionId: question.id, step: 0, status: 'running', draftId: id() }],
    }));
    setMessage('本地模拟任务已创建。');
    navigate('optimize');
  };

  const saveForm = (data: FormData) => {
    const title = String(data.get('title') || '').trim();
    if (!title) return;
    if (form === 'project') {
      const brand = String(data.get('brand') || '').trim();
      if (!brand) return;
      const next = createProject(title, brand);
      dirtyChanged(false);
      setStore(previous => ({ ...previous, projects: [...previous.projects, next] }));
      go(projectRoute(next.id));
    } else if (form === 'question' && project) {
      if (project.questions.some(question => question.text === title)) {
        setMessage('该问题已存在。');
        return;
      }
      update(current => ({
        ...current,
        questions: [...current.questions, {
          id: id(), text: title, intent: String(data.get('intent')), priority: String(data.get('priority')),
        }],
      }));
    } else if (form === 'source' && project) {
      const text = String(data.get('text') || '').trim();
      if (!text) return;
      update(current => ({
        ...current,
        sources: [...current.sources, { id: id(), title, text, kind: String(data.get('kind')), approved: false }],
      }));
    } else {
      return;
    }
    dirtyChanged(false);
    setForm(null);
    setMessage(loaded.warning || storageError ? '已保留在本次页面中，请及时导出。' : '已保存到当前浏览器。');
  };

  return (
    <div className="geo-workspace" ref={root}>
      <div className="geo-context">
        <div><FlaskConical size={15} /><span>样例数据 · 未连接外部平台</span></div>
        <span>本地保存</span>
      </div>
      <div className="geo-project-controls">
        <nav className="geo-breadcrumbs" aria-label="GEO 当前位置">
          <button className="geo-link" onClick={() => go('geo')} aria-current={showProjects ? 'page' : undefined}>项目管理</button>
          {!showProjects && project && <>
            <ChevronRight size={14} aria-hidden="true" />
            <button className="geo-link" onClick={() => navigate('overview')}>{project.name}</button>
            <ChevronRight size={14} aria-hidden="true" />
            {item ? <button className="geo-link" onClick={() => navigate(section)}>{sectionLabel}</button>
              : <span aria-current="page">{sectionLabel}</span>}
            {item && <>
              <ChevronRight size={14} aria-hidden="true" />
              <span aria-current="page">{selectedDraft?.title || (observation ? '回答证据' : '记录不存在')}</span>
            </>}
          </>}
        </nav>
        <div className="geo-actions">
          {!showProjects && project && <select
            aria-label="GEO 项目"
            value={project.id}
            onChange={event => go(projectRoute(event.target.value, section))}
          >
            {store.projects.map(candidate => <option key={candidate.id} value={candidate.id}>{candidate.name}</option>)}
          </select>}
          {!selectedDraft && <button className="button" onClick={() => setForm('project')}><Plus size={15} />新建项目</button>}
          <button
            className="geo-icon"
            title="导出本地项目数据"
            aria-label="导出本地项目数据"
            onClick={() => exportText('GEO-样例项目.json', JSON.stringify(store, null, 2), 'application/json')}
          ><Download size={17} /></button>
        </div>
      </div>
      <div className="geo-sticky">
        <WorkspaceTabs
          label="GEO 功能"
          selected={selectedSection}
          items={sections.map(([key, label]) => ({
            id: key,
            label,
            route: key === 'projects' ? 'geo' : project ? projectRoute(project.id, key) : `geo?view=${key}`,
          }))}
          go={go}
        />
      </div>
      {storageError && <p className="geo-notice" role="alert">{storageError}</p>}
      {message && <p className="geo-toast" role="status">{message}</p>}
      <div key={project?.id || 'projects'} className="geo-body">
        {showProjects ? <>
          {projectId && !project && <p className="geo-notice" role="alert">未找到此本地项目，请从项目列表重新选择。</p>}
          <GeoProjects
            projects={store.projects}
            section={section}
            open={selected => {
              const target = section === 'projects' || section === 'overview' ? 'overview' : section;
              go(projectRoute(selected, target));
            }}
            add={() => setForm('project')}
          />
        </> : <>
          {section === 'overview' && <GeoOverview project={project} navigate={navigate} sample={sample} />}
          {section === 'knowledge' && <>
            <button className="geo-link geo-back" onClick={() => navigate('overview')}><ArrowLeft size={16} />返回项目总览</button>
            <KnowledgeView project={project} update={update} navigate={navigate} add={() => setForm('source')} />
          </>}
          {section === 'monitor' && <>
            <div className="geo-section-head">
              <span className="geo-muted">{project.batches.length} 个样例批次 · {project.questions.length * 3} 条计划采样</span>
              <button className="button primary" disabled={!project.questions.length} onClick={sample}><ScanSearch size={15} />模拟采样</button>
            </div>
            <MonitorView project={project} update={update} navigate={navigate} add={() => setForm('question')} />
          </>}
          {section === 'optimize' && <OptimizeView project={project} update={update} navigate={navigate} start={start} />}
          {section === 'content' && (selectedDraft ? <DraftEditor
            key={selectedDraft.id}
            draft={selectedDraft}
            close={() => navigate('content')}
            save={draft => {
              update(current => ({ ...current, drafts: current.drafts.map(candidate => candidate.id === draft.id ? draft : candidate) }));
              setMessage('内容状态已保存。');
            }}
            dirtyChanged={dirtyChanged}
          /> : item ? <div className="geo-empty">
            <h2>内容不存在</h2>
            <p>该记录不属于当前项目，或已被移除。</p>
            <button className="button" onClick={() => navigate('content')}><ArrowLeft size={16} />返回内容管理</button>
          </div> : <ContentView project={project} update={update} navigate={navigate} />)}
          {section === 'reports' && <>
            <div className="geo-section-head">
              <h2>可见性与证据报告</h2>
              <div className="geo-actions">
                <button className="button" disabled={!project.questions.length} onClick={sample}><ScanSearch size={15} />模拟复测</button>
                <button className="button primary" onClick={() => exportText('GEO-样例报告.md', report(project))}><Download size={15} />导出报告</button>
              </div>
            </div>
            <div className="geo-two-columns"><PlatformChart project={project} /><TrendChart project={project} /></div>
            <ReportTable project={project} />
          </>}
        </>}
      </div>
      {form && <EntryForm kind={form} close={() => setForm(null)} save={saveForm} dirtyChanged={dirtyChanged} />}
      {!showProjects && observation && project && batch && <DetailDialog title="回答证据" close={() => navigate('monitor')}>
        <span className="geo-status">固定样例 · 非平台实际回答</span>
        <h3>{project.questions.find(question => question.id === observation.questionId)?.text}</h3>
        <p className="geo-muted">{observation.platform} · {stamp(batch.date)} · 联网条件：未接入</p>
        <blockquote>{observation.answer}</blockquote>
        <h3>引用来源</h3>
        <p>{observation.reference || '未提供引用'}</p>
        {observation.reference && <p className="geo-muted">example.com 为占位来源，不作为真实证据。</p>}
        <h3>诊断记录</h3>
        <p>{observation.status === 'failed' ? '无有效回答，不参与指标计算。'
          : observation.inaccurate ? '疑似误述：样例回答包含未经资料支持的商品或能力断言。'
          : observation.mentioned ? '已出现品牌；引用完整性与事实仍需人工核验。'
          : '未出现目标品牌；缺失原因尚不能确定。'}</p>
        <button className="button" onClick={() => navigate('optimize')}>进入诊断队列<ArrowRight size={15} /></button>
      </DetailDialog>}
      {!showProjects && item && section !== 'content' && !observation && <DetailDialog title="记录不存在" close={() => navigate(section)}>
        <p>该记录不属于当前项目，或已被移除。</p>
      </DetailDialog>}
    </div>
  );
}
