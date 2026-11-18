import {useEffect,useRef,useState,useCallback} from 'react';
import {ArrowRight,Database,RefreshCw,ListChecks,Layers,FileText} from 'lucide-react';
import {api,date} from '../../api';
import {Badge,Button,Empty,Field} from '../../components/ui';
import type {Space,Document} from '../knowledge/types';
import type {Props,Run,Batch,Pack,Template,View} from './types';
import {statusLabels,kindLabels} from './types';
import DemandLibrary from './DemandLibrary';
import TaskBuilder from './TaskBuilder';
import DemandResults from './DemandResults';
import './demand.css';

export default function DemandWorkspace({view,model,initialSpaceId,initialTaskId,taskSelected,go,dirtyChanged}:Props){
 const [spaces,setSpaces]=useState<Space[]>([]),[spaceId,setSpaceId]=useState(''),[batches,setBatches]=useState<Batch[]>([]),[packs,setPacks]=useState<Pack[]>([]),[templates,setTemplates]=useState<Template[]>([]),[docs,setDocs]=useState<Document[]>([]),[runs,setRuns]=useState<Run[]>([]),[task,setTask]=useState<Run|null>(null),[taskId,setTaskId]=useState(initialTaskId||''),[error,setError]=useState(''),[loading,setLoading]=useState(true),[libraryDirty,setLibraryDirty]=useState(false),[builderDirty,setBuilderDirty]=useState(false),[resultsDirty,setResultsDirty]=useState(false);
 const dirty=libraryDirty||builderDirty||resultsDirty;
 const current=useRef(spaceId),selectedTask=useRef(taskId),pollLock=useRef(false);current.current=spaceId;selectedTask.current=taskId;
 useEffect(()=>{setTaskId(initialTaskId||'');setTask(previous=>previous?.id===initialTaskId?previous:null)},[initialTaskId]);
 useEffect(()=>{if(initialSpaceId&&spaces.some(s=>s.id===initialSpaceId))setSpaceId(initialSpaceId)},[initialSpaceId,spaces]);
 const markLibraryDirty=useCallback((v:boolean)=>setLibraryDirty(v),[]),markBuilderDirty=useCallback((v:boolean)=>setBuilderDirty(v),[]),markResultsDirty=useCallback((v:boolean)=>setResultsDirty(v),[]);
 useEffect(()=>{dirtyChanged(dirty);return()=>dirtyChanged(false)},[dirty,dirtyChanged]);
 useEffect(()=>{api<Space[]>('/knowledge/spaces').then(items=>{setSpaces(items);setSpaceId(items.find(s=>s.id===initialSpaceId)?.id||items.find(s=>s.id===localStorage.getItem('knowledge-space'))?.id||items[0]?.id||'');if(!items.length)setLoading(false)}).catch(e=>{setError(e.message);setLoading(false)})},[]);
 const load=async(id=spaceId)=>{
  if(!id)return;const query='?space_id='+encodeURIComponent(id);
  const values=await Promise.all([api<Batch[]>('/demand/batches'+query),api<Pack[]>('/demand/packs'+query),api<Template[]>('/demand/templates'+query),api<Document[]>('/knowledge/documents'+query)]);
  if(current.current!==id)return;setBatches(values[0]);setPacks(values[1]);setTemplates(values[2]);setDocs(values[3]);setLoading(false);setError('');
 };
 useEffect(()=>{if(!spaceId)return;setLoading(true);setError('');setTask(null);setBatches([]);setRuns([]);localStorage.setItem('knowledge-space',spaceId);load(spaceId).catch(e=>{if(current.current===spaceId){setError(e.message);setLoading(false)}})},[spaceId]);
 useEffect(()=>{
  if(!spaceId||view==='library')return;
  let cancelled=false,timer:ReturnType<typeof setTimeout>|undefined,failures=0,controller:AbortController|undefined;
  const schedule=(delay:number)=>{if(!cancelled&&!document.hidden){if(timer)clearTimeout(timer);timer=setTimeout(poll,delay)}};
  const poll=async()=>{
   if(cancelled||document.hidden)return;
   if(pollLock.current){schedule(250);return}
   pollLock.current=true;controller=new AbortController();let next=30000;
   try{
    const items=await api<Run[]>('/demand/tasks?space_id='+encodeURIComponent(spaceId),'GET',undefined,{signal:controller.signal});
    if(cancelled)return;setRuns(items);
    let detail:Run|null=null;
    if(taskId){detail=await api<Run>('/demand/tasks/'+encodeURIComponent(taskId),'GET',undefined,{signal:controller.signal});if(cancelled)return;if(detail.space_id===spaceId)setTask(detail)}
    failures=0;setError('');
    if(items.some(r=>['queued','running'].includes(r.status))||(detail&&['queued','running'].includes(detail.status)))next=2500;
   }catch(e){if(!cancelled&&!controller.signal.aborted){setError((e as Error).message);failures+=1;next=Math.min(60000,2500*2**Math.min(failures,5))}}
   finally{pollLock.current=false;schedule(next)}
  };
  const visibility=()=>{if(timer)clearTimeout(timer);if(document.hidden)controller?.abort();else{failures=0;void poll()}};
  document.addEventListener('visibilitychange',visibility);void poll();
  return()=>{cancelled=true;if(timer)clearTimeout(timer);controller?.abort();document.removeEventListener('visibilitychange',visibility)};
 },[spaceId,taskId,view]);
 const space=spaces.find(s=>s.id===spaceId);
 const navigate=(v:View,id=taskId)=>go(({tasks:'overview',library:'product',results:'analytics',content:'creative',attention:'tasks'}[v])+`?tab=demand&space=${encodeURIComponent(spaceId)}`+(id?'&task='+encodeURIComponent(id):''));
 const pick=(id:string)=>{if(resultsDirty&&!confirm('当前结果操作尚未完成，确定切换任务？'))return;setResultsDirty(false);setTask(null);setTaskId(id);taskSelected?.(id,spaceId)};
 const refreshTask=async()=>{await load();if(!spaceId||pollLock.current)return;pollLock.current=true;try{const items=await api<Run[]>('/demand/tasks?space_id='+encodeURIComponent(spaceId));if(current.current!==spaceId)return;setRuns(items);if(taskId){const detail=await api<Run>('/demand/tasks/'+encodeURIComponent(taskId));if(detail.space_id===current.current&&selectedTask.current===taskId)setTask(detail)}setError('')}finally{pollLock.current=false}};
 const visible=runs.filter(r=>view==='attention'?['paused','interrupted','failed','waiting_review','waiting_input'].includes(r.status):view==='content'?['topics','faq'].includes(r.task_type):true);
 return <section className="demand-workspace" aria-label="需求素材与任务工作空间">
  <div className="panel demand-context"><div><span className="eyebrow">需求 → 选题 → 有据可查的内容</span><h2>需求工作空间</h2><p className="muted">导入素材或使用明确标记的样例。需求记录用来理解问题，生成回答时单独检索已审核的事实资料。</p></div><Field label="机构与业务空间"><select value={spaceId} disabled={loading} onChange={e=>{if(dirty&&!confirm('当前编辑尚未保存，确定切换空间并放弃修改？'))return;setLibraryDirty(false);setBuilderDirty(false);setResultsDirty(false);setTaskId('');setSpaceId(e.target.value);taskSelected?.('',e.target.value)}}>{spaces.map(s=><option key={s.id} value={s.id}>{s.name} · {s.scene==='medical'?'医美':'直播'}{s.is_demo?' · 演示':''}</option>)}</select></Field></div>
  <nav className="demand-steps" aria-label="需求处理流程">{([['tasks','配置与任务',ListChecks],['library','素材与词库',Database],['results','筛选与确认',Layers],['content','选题与内容',FileText]] as const).map(([v,label,Icon],i)=><button key={v} aria-current={view===v?'step':undefined} onClick={()=>navigate(v)}><Icon size={17}/><span>0{i+1} {label}</span><ArrowRight size={14}/></button>)}</nav>
  {error&&<div role="alert" className="error-banner">{error}<Button onClick={()=>{setError('');refreshTask().catch(e=>setError(e.message))}}>重新读取</Button></div>}
  {loading?<p role="status">正在读取当前空间…</p>:!space?<div className="panel"><Empty text="当前没有机构空间。请先在知识库创建机构与业务空间。"/><Button kind="primary" onClick={()=>go('product?tab=knowledge')}>去知识库创建空间<ArrowRight size={15}/></Button></div>:<>
   {view==='library'?<DemandLibrary key={spaceId} space={space} batches={batches} packs={packs} docs={docs} reload={load} dirtyChanged={markLibraryDirty} start={()=>navigate('tasks')}/>:<>
    {view==='tasks'&&<TaskBuilder key={spaceId} space={space} batches={batches} packs={packs} templates={templates} model={model} dirtyChanged={markBuilderDirty} reload={load} started={r=>{setTask(r);setTaskId(r.id);taskSelected?.(r.id,spaceId);void load().catch(e=>setError(e.message))}} library={()=>navigate('library')}/>}
    <section className="panel"><div className="demand-section-head"><div><h3>{view==='attention'?'需求任务待办':view==='content'?'选题与 FAQ 任务':'任务看板'}</h3><p className="muted">已保存进度以服务端记录为准。刷新页面可继续查看；中断任务需要手动恢复。</p></div><Button onClick={()=>refreshTask().catch(e=>setError(e.message))}><RefreshCw size={15}/>刷新</Button></div>
     {!visible.length?<Empty text={view==='content'?'还没有内容任务。在结果页确认需求后，转为选题或 FAQ。':'当前空间还没有符合条件的任务。'}/>:<div className="demand-task-grid">{visible.map(r=><button type="button" className={'demand-task-card '+(r.id===taskId?'selected':'')} key={r.id} onClick={()=>pick(r.id)}><div className="demand-card-head"><Badge tone={r.status==='failed'?'red':r.status==='completed'?'green':'neutral'}>{statusLabels[r.status]||r.status}</Badge><small>{kindLabels[r.task_type]}</small></div><strong>{r.name}</strong><span>已处理 {r.counts?.processed||0} · 待确认 {r.counts?.pending||0} · 已确认 {r.counts?.confirmed||0}</span><small>{date(r.created_at)} · 任务修订 {r.revision}</small></button>)}</div>}
    </section>
    {task&&task.space_id===spaceId?<DemandResults key={task.id} task={task} setTask={setTask} reload={refreshTask} dirtyChanged={markResultsDirty} go={go} openTask={r=>{setTask(r);setTaskId(r.id);taskSelected?.(r.id,spaceId);void load().catch(e=>setError(e.message))}}/>:taskId&&!error&&<p role="status">正在读取任务明细…</p>}
   </>}
  </>}
 </section>
}
