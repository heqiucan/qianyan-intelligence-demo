import {Badge, Button, Field} from '../../components/ui';
import type {Campaign} from '../../api';
import type {Act} from '../../domain';
import {statusLabels, type LiveSession} from './types';
import LiveSessions from './LiveSessions';
import LiveRuntimePanel from './LiveRuntimePanel';
import {liveModules} from './modules';
import './workspace.css';

interface Props {
 sessions:LiveSession[];campaign?:Campaign;busy:boolean;act:Act;go:(route:string)=>void;
 selectedId?:string;moduleId?:string;featureId?:string;pane?:string;dirtyChanged:(value:boolean)=>void;
}
export default function LiveWorkspace(props:Props){
 const list=props.sessions.filter(s=>s.campaign_id===props.campaign?.id);
 const session=list.find(s=>s.id===props.selectedId)||list.at(-1);
 const module=liveModules.find(m=>m.id===props.moduleId)||liveModules[0];
 const feature=module.features.find(f=>f.id===props.featureId)||module.features[0];
 const pane=['control','session','logs'].includes(props.pane||'')?props.pane!:'control';
 const activePane=session?pane:'session';
 const route=(moduleId=module.id,featureId=feature.id,nextPane='control',id=session?.id)=>{
  const query=new URLSearchParams({tab:'live',module:moduleId,feature:featureId,pane:nextPane});
  if(id)query.set('live',id);
  return 'overview?'+query;
 };
 const navigate=(target:string)=>{
  if(target.startsWith('creative?tab=live')){
   const id=new URLSearchParams(target.split('?')[1]).get('live')||session?.id;
   props.go(route('ai','console','session',id));
  }else props.go(target);
 };
 const choose=(moduleId:string,featureId:string)=>props.go(route(moduleId,featureId));
 return <div className="live-console">
  <section className="panel live-workspace-header" aria-label="直播工作台顶部">
   <div><Badge>抖音场景 · 本地模拟</Badge><h2>直播工作台</h2><p>选择功能模块，围绕同一场直播准备和测试。</p></div>
   <div className="live-credit"><strong>算力余额：未接入</strong><details><summary>充值说明</summary><p>卡密充值暂未开放。当前没有算力余额或扣费账本，请勿在此输入卡密。</p></details></div>
  </section>
  <section className="panel live-shared-context" aria-label="当前直播场次">
   <div><span className="muted">所属营销活动</span><p>{props.campaign?.name||'尚未选择营销活动'}</p>{session&&<Badge>{statusLabels[session.status]} · V{session.version}</Badge>}</div>
   {list.length?<Field label="当前直播场次"><select value={session?.id||''} disabled={props.busy} onChange={e=>props.go(route(module.id,feature.id,pane,e.target.value))}>{list.map(s=><option key={s.id} value={s.id}>{s.title}</option>)}</select></Field>:<p>尚无直播场次，请先在直播控制台创建。</p>}
   <Button disabled={props.busy} onClick={()=>props.go(route('ai','console','session'))}>管理场次与货盘</Button>
  </section>
  <div className="live-module-layout">
   <nav className="panel live-module-nav" aria-label="直播功能模块">
    <h3>功能模块</h3>
    <div className="live-module-choices">{liveModules.map(m=><button key={m.id} type="button" className="live-module-button" aria-expanded={module.id===m.id} aria-controls={'live-group-'+m.id} onClick={()=>choose(m.id,m.features[0].id)}>{m.name}</button>)}</div>
    <p className="live-subnav-caption">{module.name} · 子功能</p>
    <div className="live-subnav-scroll">{liveModules.map(m=><div key={m.id} id={'live-group-'+m.id} hidden={module.id!==m.id}>{m.features.map(f=><button type="button" className="live-feature-button" aria-current={module.id===m.id&&feature.id===f.id?'page':undefined} key={f.id} onClick={()=>choose(m.id,f.id)}><span>{f.name}</span><small>{f.available?'可用':'待开发'}</small></button>)}</div>)}</div>
   </nav>
   <div className="panel live-mobile-navigation">
    <Field label="功能模块"><select value={module.id} onChange={e=>{const m=liveModules.find(m=>m.id===e.target.value)!;choose(m.id,m.features[0].id)}}>{liveModules.map(m=><option key={m.id} value={m.id}>{m.name}</option>)}</select></Field>
    <Field label="子功能"><select value={feature.id} onChange={e=>choose(module.id,e.target.value)}>{module.features.map(f=><option key={f.id} value={f.id}>{f.name} · {f.available?'可用':'待开发'}</option>)}</select></Field>
   </div>
   <section className="live-feature-content" aria-label="直播子功能内容">
    <header className="live-feature-heading"><p className="muted">{module.name} / {feature.name}</p><div className="panel-header"><h3>{feature.name}</h3><Badge tone={feature.available?'green':'neutral'}>{feature.available?'本地模拟可用':'待开发'}</Badge></div><p>{feature.description}</p></header>
    {!feature.available?<section className="panel live-planned-feature"><h4>该功能尚未开放</h4><p>计划在第 {feature.stage} 阶段实施。目前可以查看功能说明，尚不执行生成、播放、发送或平台操作。</p>{module.id==='video'&&<p>这里规划音视频处理工具，不承诺平台原创或去重判定结果。</p>}<Button onClick={()=>choose('ai','console')}>返回直播控制台</Button></section>:<>
     {feature.id==='console'&&<nav className="live-console-tabs" aria-label="直播控制台分区">{[{id:'control',label:'运行控制'},{id:'session',label:'场次与货盘'},{id:'logs',label:'运行日志'}].map(p=><button key={p.id} type="button" aria-pressed={activePane===p.id} disabled={!session&&p.id!=='session'} onClick={()=>props.go(route('ai','console',p.id))}>{p.label}</button>)}</nav>}
     {feature.id==='console'&&activePane==='session'&&<><div className="row-actions"><Button onClick={()=>props.go('product?tab=catalog')}>管理商品与 SKU</Button><Button onClick={()=>props.go('product')}>查看最新商品资料</Button></div><LiveSessions {...props} embedded go={navigate}/></>}
     {feature.id==='simulation'&&<Button onClick={()=>choose('ai','console')}>前往运行控制</Button>}
     {session&&(feature.id==='simulation'||activePane!=='session')?<LiveRuntimePanel key={[session.id,feature.id,activePane].join(':')} session={session} outerBusy={props.busy} dirtyChanged={props.dirtyChanged} view={feature.id==='simulation'?'simulation':activePane==='logs'?'logs':'control'}/>:feature.id==='simulation'&&<section className="panel"><p>请先创建场次、确认货盘，并在运行控制中启动模拟。</p><Button onClick={()=>props.go(route('ai','console','session'))}>创建直播场次</Button></section>}
    </>}
   </section>
  </div>
 </div>;
}
