import {useEffect, useState, useRef} from 'react';
import {api, date, requestId, type Campaign} from '../../api';
import {Badge, Button, Field} from '../../components/ui';
import type {Act} from '../../domain';
import type {LiveSession} from './types';
import LiveSessions from './LiveSessions';
import './workspace.css';

interface Runtime {revision:number;account:string;room:string;status:'idle'|'running'|'paused'|'stopped';session_version:number;stale_products?:string[];needs_restart?:boolean;events:{id:string;kind:string;viewer:string;text:string;created_at:string}[];logs:{id:string;text:string;created_at:string}[]}
const labels={idle:'尚未启动',running:'模拟运行中',paused:'已暂停模拟',stopped:'已停止模拟'};
export default function LiveWorkspace(props:{sessions:LiveSession[];campaign?:Campaign;busy:boolean;act:Act;go:(s:string)=>void;selectedId?:string;dirtyChanged:(v:boolean)=>void}){
 const list=props.sessions.filter(s=>s.campaign_id===props.campaign?.id);
 const session=list.find(s=>s.id===props.selectedId)||list.at(-1);
 const navigate=(route:string)=>props.go(route.startsWith('creative?tab=live')?route.replace('creative?tab=live','overview?tab=live'):route);
 return <div className="live-console"><section className="panel"><Badge>抖音场景 · 本地模拟</Badge><h2>直播工作台</h2><p>先准备场次和货盘，再保存模拟账号并启动测试。这里不会登录抖音、推流或发送真实公屏消息。</p><div className="row-actions"><Button onClick={()=>props.go('product?tab=catalog')}>管理商品与 SKU</Button><Button onClick={()=>props.go('product')}>查看最新商品资料</Button></div></section>
 <LiveSessions {...props} go={navigate}/>
 {session&&<RuntimePanel key={session.id} session={session} outerBusy={props.busy} dirtyChanged={props.dirtyChanged}/>}
 </div>;
}
function RuntimePanel({session,outerBusy,dirtyChanged}:{session:LiveSession;outerBusy:boolean;dirtyChanged:(v:boolean)=>void}){
 const [runtime,setRuntime]=useState<Runtime>(),[error,setError]=useState(''),[pending,setPending]=useState(false),[viewer,setViewer]=useState('模拟观众'),[text,setText]=useState(''),[account,setAccount]=useState(''),[room,setRoom]=useState('');
 const initialized=useRef(false);
 useEffect(()=>()=>dirtyChanged(false),[dirtyChanged]);
 const endpoint='/live/workspace/'+encodeURIComponent(session.id);
 const refresh=async()=>{const r=await api<Runtime>(endpoint);setRuntime(r);return r};
 useEffect(()=>{let active=true;api<Runtime>(endpoint).then(r=>{if(active){setRuntime(r);if(!initialized.current){setAccount(r.account);setRoom(r.room);initialized.current=true}}}).catch(e=>{if(active)setError(e.message)});return()=>{active=false}},[endpoint,session.version,session.status,dirtyChanged]);
 const send=async(action:string,extra:Record<string,string>={})=>{if(!runtime||pending)return;setPending(true);setError('');try{await api(endpoint,'POST',{action,expected_revision:runtime.revision,request_id:requestId(),...extra});if(action==='configure')dirtyChanged(false);if(action==='event')setText('');await refresh()}catch(e){setError((e as Error).message);try{await refresh()}catch{/* Keep the original actionable error. */}}finally{setPending(false)}};
 if(!runtime)return <section className="panel"><p role={error?'alert':'status'}>{error||'正在读取模拟控制台…'}</p>{error&&<Button onClick={()=>refresh().catch(e=>setError(e.message))}>重新读取</Button>}</section>;
 const locked=runtime.status==='running'||runtime.status==='paused';
 const stale=Boolean(runtime.stale_products?.length);
 const canStart=session.status==='ready'&&!stale&&Boolean(runtime.account&&runtime.room)&&account.trim()===runtime.account&&room.trim()===runtime.room&&runtime.status!=='running';
 return <><section className="panel"><div className="panel-header"><h3>模拟控制台 · {session.title}</h3><Badge>{labels[runtime.status]}</Badge></div>
 {error&&<p role="alert" className="notice">{error}</p>}
 {stale&&<p role="alert" className="notice">商品资料已更新：{runtime.stale_products?.join('、')}。请编辑本场货盘并保存，再重新核对；已有快照保留。</p>}
 {runtime.needs_restart&&locked&&<p className="notice">场次版本已变化，请停止模拟并重新启动。</p>}
 <form onSubmit={e=>{e.preventDefault();void send('configure',{account,room})}} onChange={()=>dirtyChanged(true)}><div className="form-grid"><Field label="模拟账号名称"><input value={account} onChange={e=>setAccount(e.target.value)} required maxLength={80} disabled={locked||pending||outerBusy}/></Field><Field label="模拟直播间名称"><input value={room} onChange={e=>setRoom(e.target.value)} required maxLength={120} disabled={locked||pending||outerBusy}/></Field></div><button className="button secondary" type="submit" disabled={locked||pending||outerBusy}>保存模拟账号与直播间</button></form>
 <p className="muted">仅记录测试名称，无需抖音密码。场次 V{session.version}；运行绑定 V{runtime.session_version||'—'}。刷新后保留模拟状态，不会自动执行任务。</p>
 <div className="row-actions"><Button kind="primary" disabled={pending||!canStart} onClick={()=>send('start')}>{runtime.status==='paused'?'恢复模拟':'启动模拟'}</Button><Button disabled={pending||runtime.status!=='running'} onClick={()=>send('pause')}>暂停模拟</Button><Button disabled={pending||!locked} onClick={()=>send('stop')}>停止模拟</Button><Button disabled={pending} onClick={()=>refresh().catch(e=>setError(e.message))}>刷新状态</Button></div>
 {session.status!=='ready'&&<p>请先在上方核对并确认货盘，再启动模拟。</p>}</section>
 <div className="live-console-grid"><section className="panel"><h3>本地互动测试</h3><p>手动产生测试事件；本阶段只记录，不自动回复或播报。</p><Field label="模拟观众昵称"><input value={viewer} maxLength={60} onChange={e=>setViewer(e.target.value)}/></Field><Field label="模拟弹幕内容"><textarea value={text} maxLength={500} onChange={e=>setText(e.target.value)}/></Field><div className="row-actions">{(['comment','enter','follow'] as const).map(kind=><Button key={kind} disabled={pending||runtime.status!=='running'||session.status!=='ready'||stale||runtime.needs_restart||!viewer.trim()||(kind==='comment'&&!text.trim())} onClick={()=>send('event',{kind,viewer,text})}>模拟{{comment:'弹幕',enter:'进场',follow:'关注'}[kind]}</Button>)}</div><p className="muted">在线人数：未接入，不根据测试事件推算。</p>
 <ol className="live-console-feed" aria-label="模拟互动记录">{[...runtime.events].reverse().map(e=><li key={e.id}><strong>{e.viewer} · {{comment:'弹幕',enter:'进场',follow:'关注'}[e.kind]}</strong><p>{e.text||'模拟事件'}</p><small>{date(e.created_at)}</small></li>)}</ol>{!runtime.events.length&&<p>尚无模拟事件。</p>}</section>
 <section className="panel"><h3>运行日志</h3><p className="muted">每场分别保存最近 200 条事件和操作日志。</p><ol className="live-console-feed" aria-label="模拟运行日志">{[...runtime.logs].reverse().map(l=><li key={l.id}><p>{l.text}</p><small>{date(l.created_at)}</small></li>)}</ol>{!runtime.logs.length&&<p>保存配置或操作模拟后会出现日志。</p>}</section></div></>;
}
