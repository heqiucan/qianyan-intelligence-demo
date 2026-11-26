import {useState, useEffect, useCallback, useRef} from 'react';
import {Radio, MessageSquare, Package} from 'lucide-react';
import {Badge, Button, Field} from '../../components/ui';
import type {Campaign} from '../../api';
import type {Act} from '../../domain';
import {statusLabels, type LiveSession} from './types';
import LiveSessions from './LiveSessions';
import LiveRuntimePanel from './LiveRuntimePanel';
import LivePreview from './LivePreview';
import ScriptDrafts from './ScriptDrafts';
import MediaTools from './MediaTools';
import AudioMixer from './AudioMixer';
import LiveInteraction from './LiveInteraction';
import type {SpeechQueue} from './speech/types';
import LiveSpeech from './speech/LiveSpeech';
import {liveModules} from './modules';
import {liveToolGroups as groups, isLiveToolGroup, featuresInGroup, type LiveToolGroup} from './workspaceAreas';
import './workspace.css';
import WorkspaceTabs from '../../app/WorkspaceTabs';

interface Props {
 sessions:LiveSession[];campaign?:Campaign;busy:boolean;act:Act;go:(route:string)=>void;
 selectedId?:string;moduleId?:string;featureId?:string;pane?:string;toolGroup?:string;dirtyChanged:(value:boolean,retain?:boolean)=>void;
}
export default function LiveWorkspace(props:Props){
 const list=props.sessions.filter(s=>s.campaign_id===props.campaign?.id);
 const session=list.find(s=>s.id===props.selectedId);
 const module=liveModules.find(m=>m.id===props.moduleId)||liveModules[0];
 const feature=module.features.find(f=>f.id===props.featureId)||module.features[0];
 const pane=['control','session','logs','account','speech'].includes(props.pane||'')?props.pane!:props.moduleId||props.featureId?'control':'session';
 const tools=isLiveToolGroup(props.toolGroup)?props.toolGroup:'';
 const dirtyParts=useRef({runtime:false,editor:false,speech:false,interaction:false,mixer:false,media:false,drafts:false});
 const reportRuntimeDirty=useCallback((value:boolean)=>{dirtyParts.current.runtime=value;props.dirtyChanged(value||dirtyParts.current.editor||dirtyParts.current.speech||dirtyParts.current.interaction||dirtyParts.current.mixer||dirtyParts.current.media||dirtyParts.current.drafts,!dirtyParts.current.editor)},[props.dirtyChanged]);
 const reportEditorDirty=useCallback((value:boolean)=>{dirtyParts.current.editor=value;props.dirtyChanged(value||dirtyParts.current.runtime||dirtyParts.current.speech||dirtyParts.current.interaction||dirtyParts.current.mixer||dirtyParts.current.media||dirtyParts.current.drafts,!value)},[props.dirtyChanged]);
 const [delivery,setDelivery]=useState<{id:string;session_id:string;queue:SpeechQueue}|null>(null),[haltSignal,setHaltSignal]=useState(0);
 const haltSpeech=()=>setHaltSignal(n=>n+1);
 const reportInteractionDirty=useCallback((value:boolean)=>{dirtyParts.current.interaction=value;props.dirtyChanged(value||dirtyParts.current.runtime||dirtyParts.current.speech||dirtyParts.current.editor||dirtyParts.current.mixer||dirtyParts.current.media||dirtyParts.current.drafts,!dirtyParts.current.editor)},[props.dirtyChanged]);
 const [speechRefresh,setSpeechRefresh]=useState(0);
 const scriptImported=useCallback(()=>setSpeechRefresh(n=>n+1),[]);
 const reportDraftDirty=useCallback((v:boolean)=>{dirtyParts.current.drafts=v;props.dirtyChanged(Object.values(dirtyParts.current).some(Boolean),!dirtyParts.current.editor)},[props.dirtyChanged]);
 const [speechActive,setSpeechActive]=useState(false);
 const reportMixerDirty=useCallback((v:boolean)=>{dirtyParts.current.mixer=v;props.dirtyChanged(Object.values(dirtyParts.current).some(Boolean),!dirtyParts.current.editor)},[props.dirtyChanged]);
 const reportMediaDirty=useCallback((v:boolean)=>{dirtyParts.current.media=v;props.dirtyChanged(Object.values(dirtyParts.current).some(Boolean),!dirtyParts.current.editor)},[props.dirtyChanged]);
 const [speechHost,setSpeechHost]=useState<HTMLDivElement|null>(null);
 const reportSpeechDirty=useCallback((value:boolean)=>{dirtyParts.current.speech=value;props.dirtyChanged(value||dirtyParts.current.runtime||dirtyParts.current.editor||dirtyParts.current.interaction||dirtyParts.current.mixer||dirtyParts.current.media||dirtyParts.current.drafts,!dirtyParts.current.editor)},[props.dirtyChanged]);
 const [mobileView,setMobileView]=useState(()=>['source','layers','filters'].includes(feature.id)?'picture':feature.id==='simulation'?'interaction':tools||pane!=='control'||(!['console','source','simulation'].includes(feature.id))?'settings':'picture');
 useEffect(()=>{setMobileView(['source','layers','filters'].includes(feature.id)?'picture':tools?'settings':feature.id==='simulation'?'interaction':pane!=='control'||(!['console','source','simulation'].includes(feature.id))?'settings':'picture')},[tools,feature.id,feature.available,pane,session?.id]);
 const route=(moduleId=module.id,featureId=feature.id,nextPane='control',id=session?.id)=>{
  const query=new URLSearchParams({module:moduleId,feature:featureId,pane:nextPane});
  if(id)query.set('live',id);
  return 'live?'+query;
 };
 const navigate=(target:string)=>{
  if(target.startsWith('creative?tab=live')){
   const id=new URLSearchParams(target.split('?')[1]).get('live')||session?.id;
   props.go(route('ai','console','session',id));
  }else props.go(target);
 };
 const choose=(moduleId:string,featureId:string,nextPane='control')=>props.go(route(moduleId,featureId,nextPane));
 const openTools=(group:LiveToolGroup)=>props.go(route('ai','console')+(tools===group?'':'&tools='+group));
 const view=feature.id==='simulation'?'simulation':feature.id==='console'&&pane==='logs'?'logs':feature.id==='console'&&pane==='account'?'control':'settings';
 const settings=feature.id==='console'&&pane==='session'?<><div className="live-panel-title"><h3>场次与货盘</h3><Button onClick={()=>choose('ai','console')}>收起场次管理</Button></div><div className="row-actions"><Button onClick={()=>props.go('product?tab=catalog')}>管理商品与 SKU</Button><Button onClick={()=>props.go('product')}>查看最新商品资料</Button></div><LiveSessions {...props} dirtyChanged={reportEditorDirty} embedded go={navigate}/></>:!feature.available?<section className="live-feature-content" aria-label="直播子功能内容"><div className="live-panel-title"><h3>{feature.name}</h3><Badge tone="neutral">待开发</Badge></div><p>{feature.description}</p><p className="muted">该功能尚未开放，目前不执行生成、播放、发送或平台操作。</p><Button onClick={()=>choose('ai','console')}>返回直播控制台</Button></section>:null;
 const area=pane==='session'?'sessions':(['groups','variables','writing'].includes(feature.id)||tools==='scripts')?'scripts':(['slicing','conversion','subtitles'].includes(feature.id)||tools==='more')?'media':'control';
 const detailOpen=Boolean(tools||settings||['voices','hosts','blocked','rhythm','groups','variables','writing','voice-keywords','timed','welcome','service','control','text-keywords','playlist','ambience'].includes(feature.id)||pane==='speech'||pane==='account'||pane==='logs');
 if(pane==='session')return <LiveSessions {...props} dirtyChanged={reportEditorDirty}/>;
 if(!session)return <section className="workspace-detail"><h2>选择直播场次</h2><p className="muted">选择本次要操作的场次后，再进入控制台或管理素材。</p><div className="workspace-record-grid">{list.map(item=><article className="workspace-record" key={item.id}><h3>{item.title}</h3><p>{item.host} · {statusLabels[item.status]} · {item.items.length} 件商品</p><Button onClick={()=>props.go(route(module.id,feature.id,pane,item.id))}>选择本场</Button></article>)}</div><Button onClick={()=>props.go('live?pane=session')}>管理直播场次</Button></section>;
 return <div className="live-console" data-mobile-view={mobileView} data-workspace-area={area} data-detail-open={detailOpen}>
  {['scripts','media'].includes(area)&&<WorkspaceTabs label="本场素材类型" selected={area} items={[
   {id:'scripts',label:'话术与播报',route:route('scripts','groups')},
   {id:'media',label:'音视频处理',route:route('ai','conversion')},
  ]} go={props.go}/>}
  <section className="panel live-workspace-header" aria-label="直播工作台顶部">
   <Badge tone="neutral">抖音 · 本地模拟</Badge>
   {list.length?<Field label="当前直播场次"><select value={session?.id||''} disabled={props.busy} onChange={e=>props.go(route(module.id,feature.id,pane,e.target.value))}>{list.map(s=><option key={s.id} value={s.id}>{s.title}</option>)}</select></Field>:<span className="muted">尚无直播场次</span>}
   {session&&<Badge>{statusLabels[session.status]} · V{session.version}</Badge>}
   <Button disabled={props.busy} onClick={()=>choose('ai','console','session')}>管理场次与货盘</Button>
  </section>
  <nav className="live-mobile-tabs" aria-label="直播区域切换">{[['picture','画面与控制'],['interaction','评论与互动'],['settings','设置与工具']].map(([id,label])=><button key={id} type="button" aria-pressed={mobileView===id} onClick={()=>{setMobileView(id);if(id==='settings'&&!tools&&!settings&&view==='settings')openTools('more')}}>{label}</button>)}</nav>
  <div className="live-desk-grid">
   <section className="live-stage-column" aria-label="直播画面与内容">
    <LivePreview key={session?.id||'no-session'} sessionKey={session?.id||'no-session'} tool={['source','layers','filters'].includes(feature.id)?feature.id as 'source'|'layers'|'filters':undefined} settingsOpen={feature.id==='source'} openSettings={()=>choose('video','source')} closeSettings={()=>choose('ai','console')} openTools={()=>openTools('video')}/>
    <div className="live-context-cards">
     {session?<LiveSpeech key={session.id} session={session} feature={feature.id} pane={pane} host={speechHost} refreshToken={speechRefresh} onSpeechActivity={setSpeechActive} delivery={delivery?.session_id===session.id?delivery:null} haltSignal={haltSignal} openScripts={()=>openTools('scripts')} open={(id,p='control')=>choose(['groups','variables'].includes(id)?'scripts':'ai',id,p)} dirtyChanged={reportSpeechDirty}/>:<section className="panel"><h3>当前话术</h3><p>创建场次后可编辑话术并配置播报。</p></section>}
     <section className="panel"><div className="live-panel-title"><h3><Package size={15}/>本场货盘</h3><div className="row-actions"><Button onClick={()=>choose('ai','console','session')}>查看货盘</Button><Button onClick={()=>openTools('product')}>商品设置</Button></div></div><p>{session?.items.length?`${session.items.length} 件商品 · ${session.items[0].product_snapshot.name}`:'尚未添加商品'}</p><small className="muted">{session?.items.length?'尚未启动商品讲解队列':'先创建场次并核对商品资料'}</small></section>
    </div>
   </section>
   {session?<LiveRuntimePanel key={'runtime:'+session.id} session={session} outerBusy={props.busy} dirtyChanged={reportRuntimeDirty} view={view} onReply={reply=>{if(reply.queue)setDelivery({id:reply.id,session_id:session.id,queue:reply.queue})}} haltSpeech={haltSpeech} openRules={()=>choose('ai','voice-keywords')} openAccount={()=>choose('ai','console','account')} openSimulation={()=>choose('ai','simulation')} openInteraction={()=>openTools('interaction')} openVoice={()=>openTools('voice')} openInterrupt={()=>choose('ai','interrupt')} openLogs={()=>choose('ai','console',pane==='logs'?'control':'logs')} openTools={()=>openTools('more')} closePanel={()=>choose('ai','console')}/>:<><aside className="panel live-interaction" aria-label="评论与互动"><div className="live-panel-title"><h2><MessageSquare size={17}/>评论与互动</h2></div><p className="muted">创建场次后，可查看本场模拟事件。</p><div className="live-status-grid"><div><small>在线人数</small><strong>未接入</strong></div><div><small>直播成交</small><strong>未接入</strong></div></div><Button onClick={()=>openTools('interaction')}>互动设置</Button></aside><section className="panel live-controlbar" aria-label="播报控制"><div className="row-actions"><Button kind="primary" disabled>启动模拟</Button><Button disabled>暂停模拟</Button><Button disabled>停止模拟</Button><Button onClick={()=>choose('ai','console','session')}>创建直播场次</Button></div><div className="row-actions"><Button onClick={()=>choose('ai','interrupt')}>临时插话</Button><Button onClick={()=>openTools('voice')}>播报设置</Button><Button onClick={()=>openTools('more')}>更多工具</Button></div></section></>}
   {session&&<LiveInteraction key={'interaction:'+session.id} session={session} visible={['voice-keywords','welcome','text-keywords','service','timed','control'].includes(feature.id)} dirtyChanged={reportInteractionDirty} halt={haltSpeech} haltSignal={haltSignal} onResult={reply=>{if(reply.queue)setDelivery({id:reply.id,session_id:session.id,queue:reply.queue})}} close={()=>choose('ai','console')}/>}
   {session&&<AudioMixer key={'mixer:'+session.id} sessionId={session.id} visible={['playlist','ambience'].includes(feature.id)} speechActive={speechActive} onActivityChange={reportMixerDirty}/>}
   {session&&<MediaTools key={'media:'+session.id} sessionId={session.id} feature={feature.id} visible={['slicing','conversion','subtitles'].includes(feature.id)} dirtyChanged={reportMediaDirty}/>}
   {session&&<ScriptDrafts key={'drafts:'+session.id} session={session} visible={['writing','variables'].includes(feature.id)} dirtyChanged={reportDraftDirty} onImported={scriptImported} close={()=>choose('ai','console')}/>}
   <div ref={setSpeechHost} className="live-speech-panel-host"/>
   {(tools||settings||!session)&&<section className="panel live-settings-panel" aria-label="直播操作面板">
    {tools&&<section className="live-tools" aria-label={groups[tools].title}><div className="live-panel-title"><h3>{groups[tools].title}</h3><Button onClick={()=>choose('ai','console')}>收起工具</Button></div><div className="live-tool-grid">{featuresInGroup(tools).filter(({feature:f})=>f.available).map(({module:m,feature:f})=><button type="button" key={m.id+f.id} className="live-tool-button" onClick={()=>choose(m.id,f.id)}><span>{f.name}</span></button>)}</div>{!featuresInGroup(tools).some(({feature:f})=>f.available)&&<p>暂无可用设置。</p>}</section>}
    {settings}
    {!session&&!settings&&<div className="live-empty-session"><Radio size={22}/><h3>先准备一场直播</h3><p>创建场次、添加商品并核对货盘后，即可配置账号和测试互动。</p><Button kind="primary" onClick={()=>choose('ai','console','session')}>创建直播场次</Button></div>}
   </section>}
  </div>
 </div>;
}
