import {useEffect, useState, useRef} from 'react';
import {api, date, requestId} from '../../api';
import {Badge, Button, Field} from '../../components/ui';
import type {SpeechQueue} from './speech/types';
import type {LiveSession} from './types';

interface Runtime {revision:number;account:string;room:string;status:'idle'|'running'|'paused'|'stopped';session_version:number;stale_products?:string[];needs_restart?:boolean;events:{id:string;kind:string;viewer:string;text:string;created_at:string;reply?:{id:string;status:string;text:string;reason:string;simulated:boolean;queue:SpeechQueue|null}}[];logs:{id:string;text:string;created_at:string}[]}
const labels={idle:'尚未启动',running:'模拟运行中',paused:'已暂停模拟',stopped:'已停止模拟'};
interface Props {session:LiveSession;outerBusy:boolean;view:'control'|'simulation'|'logs'|'settings';dirtyChanged:(v:boolean)=>void;openAccount:()=>void;openSimulation:()=>void;openInteraction:()=>void;openVoice:()=>void;openInterrupt:()=>void;openLogs:()=>void;openTools:()=>void;closePanel:()=>void;onReply:(reply:{id:string;status:string;queue:SpeechQueue|null})=>void;haltSpeech:()=>void;openRules:()=>void}
export default function LiveRuntimePanel({session,outerBusy,dirtyChanged,view,...actions}:Props){
 const [runtime,setRuntime]=useState<Runtime>(),[error,setError]=useState(''),[pending,setPending]=useState(false),[viewer,setViewer]=useState('模拟观众'),[text,setText]=useState(''),[account,setAccount]=useState(''),[room,setRoom]=useState('');
 const initialized=useRef(false);
 const accountDirty=Boolean(runtime&&(account.trim()!==runtime.account||room.trim()!==runtime.room));
 const commentDirty=Boolean(text.trim());
 useEffect(()=>{dirtyChanged(accountDirty||commentDirty)},[accountDirty,commentDirty,dirtyChanged]);
 useEffect(()=>()=>dirtyChanged(false),[dirtyChanged]);
 const endpoint='/live/workspace/'+encodeURIComponent(session.id);
 const refresh=async()=>{const r=await api<Runtime>(endpoint);setRuntime(r);if(!initialized.current){setAccount(r.account);setRoom(r.room);initialized.current=true}return r};
 useEffect(()=>{let active=true;api<Runtime>(endpoint).then(r=>{if(active){setRuntime(r);if(!initialized.current){setAccount(r.account);setRoom(r.room);initialized.current=true}}}).catch(e=>{if(active)setError(e.message)});return()=>{active=false}},[endpoint,session.version,session.status,dirtyChanged]);
 const send=async(action:string,extra:Record<string,string>={})=>{if(!runtime||pending)return;setPending(true);setError('');try{const response=await api<Runtime>(endpoint,'POST',{action,expected_revision:runtime.revision,request_id:requestId(),...extra});if(action==='event'){const reply=response.events.at(-1)?.reply;if(reply)actions.onReply(reply)}if(action==='pause'||action==='stop')actions.haltSpeech();if(action==='event'&&extra.kind==='comment')setText('');const saved=await refresh();if(action==='configure'){setAccount(saved.account);setRoom(saved.room)}}catch(e){setError((e as Error).message);try{await refresh()}catch{/* Keep the original actionable error. */}}finally{setPending(false)}};
 if(!runtime)return <section className="panel live-interaction"><p role={error?'alert':'status'}>{error||'正在读取模拟控制台…'}</p>{error&&<Button onClick={()=>refresh().catch(e=>setError(e.message))}>重新读取</Button>}</section>;
 const locked=runtime.status==='running'||runtime.status==='paused';
 const stale=Boolean(runtime.stale_products?.length);
 const canStart=session.status==='ready'&&!stale&&Boolean(runtime.account&&runtime.room)&&account.trim()===runtime.account&&room.trim()===runtime.room&&runtime.status!=='running';
 const disabled=pending||outerBusy;
 return <>
 <aside className="panel live-interaction" aria-label="评论与互动">
  <div className="live-panel-title"><h2>评论与互动</h2><Badge>{labels[runtime.status]}</Badge></div>
  <div className="live-status-grid"><div><small>在线人数</small><strong>未接入</strong></div><div><small>直播成交</small><strong>未接入</strong></div></div>
  <div className="row-actions"><Button onClick={actions.openSimulation}>本地互动模拟</Button><Button onClick={actions.openInteraction}>互动设置</Button><Button onClick={actions.openRules}>自动互动规则</Button></div>
  <p className="muted live-feed-note">仅显示本场测试事件，不代表抖音实时弹幕。</p>
  <ol className="live-console-feed" aria-label="模拟互动记录">{[...runtime.events].reverse().map(e=><li key={e.id}><strong>{e.viewer} · {{comment:'弹幕',enter:'进场',follow:'关注'}[e.kind]}</strong><p>{e.text||'模拟事件'}</p>{e.reply&&<div className="interaction-reply"><strong>{({replied:'规则生成回复',manual:'转人工',cooldown:'冷却去重',disabled:'未开启',ignored:'未配置'} as Record<string,string>)[e.reply.status]}</strong><p>{e.reply.text||e.reply.reason}</p>{e.reply.simulated&&<small>模拟规则输出</small>}</div>}<small>{date(e.created_at)}</small></li>)}</ol>
  {!runtime.events.length&&<div className="live-feed-empty"><p>尚无模拟事件</p><small>启动模拟后，使用本地互动模拟测试。</small></div>}
  {view==='simulation'&&<section className="live-simulation-form" aria-label="本地互动测试"><div className="live-panel-title"><h3>本地互动测试</h3><Button onClick={actions.closePanel}>收起测试</Button></div><Field label="模拟观众昵称"><input value={viewer} maxLength={60} disabled={disabled} onChange={e=>setViewer(e.target.value)}/></Field><Field label="模拟弹幕内容"><textarea rows={2} value={text} maxLength={500} disabled={disabled} onChange={e=>setText(e.target.value)}/></Field><div className="row-actions">{(['comment','enter','follow'] as const).map(kind=><Button key={kind} disabled={disabled||runtime.status!=='running'||session.status!=='ready'||stale||runtime.needs_restart||!viewer.trim()||(kind==='comment'&&!text.trim())} onClick={()=>send('event',{kind,viewer,text})}>模拟{{comment:'弹幕',enter:'进场',follow:'关注'}[kind]}</Button>)}</div><div className="row-actions"><small className="muted">启用已确认的互动规则后，新事件可触发本地回复；语音须在当前页面允许自动播报。</small>{commentDirty&&<Button disabled={disabled} onClick={()=>setText('')}>清空未发送弹幕</Button>}</div></section>}
 </aside>
 <section className="panel live-controlbar" aria-label="播报控制">
  <div className="row-actions"><Button kind="primary" disabled={disabled||!canStart} onClick={()=>send('start')}>{runtime.status==='paused'?'恢复模拟':'启动模拟'}</Button><Button disabled={disabled||runtime.status!=='running'} onClick={()=>send('pause')}>暂停模拟</Button><Button disabled={disabled||!locked} onClick={()=>send('stop')}>停止模拟</Button><Button disabled={disabled} onClick={()=>refresh().catch(e=>setError(e.message))}>刷新状态</Button></div>
  <div className="row-actions"><Button onClick={actions.openInterrupt}>临时插话</Button><Button onClick={actions.openVoice}>播报设置</Button><Button onClick={actions.openAccount}>账号设置</Button><Button onClick={actions.openTools}>更多工具</Button><Button onClick={actions.openLogs}>运行日志{view==='logs'?' ▴':' ▾'}</Button></div>
  {session.status!=='ready'&&<p className="live-control-hint">请先在“场次与货盘”核对并确认货盘，再启动模拟。</p>}
  {session.status==='ready'&&(!runtime.account||!runtime.room)&&<p className="live-control-hint">请先在“账号设置”保存模拟账号与直播间名称。</p>}
  {(accountDirty||commentDirty)&&<div className="live-draft-status" role="status"><span>本场待处理：{[accountDirty?'账号有未保存修改':'',commentDirty?'有未发送测试弹幕':''].filter(Boolean).join('；')}。切换面板会保留输入。</span>{accountDirty&&<Button onClick={actions.openAccount}>继续编辑账号</Button>}{commentDirty&&<Button onClick={actions.openSimulation}>继续编辑弹幕</Button>}</div>}
  {error&&<p role="alert" className="notice">{error}</p>}
  {stale&&<p role="alert" className="notice">商品资料已更新：{runtime.stale_products?.join('、')}。请编辑本场货盘并保存，再重新核对；已有快照保留。</p>}
  {runtime.needs_restart&&locked&&<p className="notice">场次版本已变化，请停止模拟并重新启动。</p>}
 </section>
 {view==='control'&&<section className="panel live-runtime-settings" aria-label="模拟账号设置"><div className="live-panel-title"><h3>模拟账号与直播间</h3><Button onClick={actions.closePanel}>收起账号设置</Button></div><form onSubmit={e=>{e.preventDefault();void send('configure',{account,room})}}><div className="form-grid"><Field label="模拟账号名称"><input value={account} onChange={e=>setAccount(e.target.value)} required maxLength={80} disabled={locked||disabled}/></Field><Field label="模拟直播间名称"><input value={room} onChange={e=>setRoom(e.target.value)} required maxLength={120} disabled={locked||disabled}/></Field></div><button className="button secondary" type="submit" disabled={locked||disabled}>保存模拟账号与直播间</button>{accountDirty&&<Button disabled={locked||disabled} onClick={()=>{setAccount(runtime.account);setRoom(runtime.room)}}>恢复已保存账号</Button>}</form><p className="muted">仅记录测试名称，无需抖音密码。场次 V{session.version}；运行绑定 V{runtime.session_version||'—'}。刷新后保留模拟状态，不会自动执行任务。</p></section>}
 {view==='logs'&&<section className="panel live-runtime-settings" aria-label="运行日志面板"><div className="live-panel-title"><h3>运行日志</h3><Button onClick={actions.closePanel}>收起日志</Button></div><p className="muted">每场分别保存最近 200 条事件和操作日志。</p><ol className="live-console-feed" aria-label="模拟运行日志">{[...runtime.logs].reverse().map(l=><li key={l.id}><p>{l.text}</p><small>{date(l.created_at)}</small></li>)}</ol>{!runtime.logs.length&&<p>保存配置或操作模拟后会出现日志。</p>}</section>}
 </>;
}
