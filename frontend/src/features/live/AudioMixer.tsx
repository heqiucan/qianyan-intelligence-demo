import {useCallback, useEffect, useRef, useState} from 'react';
import {Badge, Button, Field} from '../../components/ui';
import './audio-mixer.css';

type TrackId = 'main'|'sub'|'ambience1'|'ambience2'|'ambience3';
type TrackStatus = 'empty'|'ready'|'loading'|'playing'|'waiting'|'paused'|'ended'|'error';
interface TrackConfig {volume:number;interval:number;repeat:boolean}
interface MixerConfig {tracks:Record<TrackId,TrackConfig>;duck:boolean;duckPercent:number}
interface LocalClip {name:string;url:string}
const trackNames:Record<TrackId,string>={main:'主音频',sub:'副音频',ambience1:'环境音 1',ambience2:'环境音 2',ambience3:'环境音 3'};
const trackIds=Object.keys(trackNames) as TrackId[];
const statusNames:Record<TrackStatus,string>={empty:'未选择文件',ready:'已就绪',loading:'准备播放',playing:'播放中',waiting:'间隔等待',paused:'已暂停',ended:'已播完',error:'播放失败'};
const activity=(status:TrackStatus)=>['loading','playing','waiting'].includes(status);
const defaults=():MixerConfig=>({tracks:{main:{volume:60,interval:0,repeat:false},sub:{volume:75,interval:0,repeat:false},ambience1:{volume:15,interval:0,repeat:true},ambience2:{volume:15,interval:0,repeat:true},ambience3:{volume:15,interval:0,repeat:true}},duck:true,duckPercent:25});
function readConfig(key:string):MixerConfig {
 const fallback=defaults();
 try{const input=JSON.parse(localStorage.getItem(key)||'null');if(!input)return fallback;
  for(const id of trackIds){const v=input.tracks?.[id];if(v)fallback.tracks[id]={volume:Number.isFinite(v.volume)?Math.min(100,Math.max(0,v.volume)):fallback.tracks[id].volume,interval:Number.isFinite(v.interval)?Math.min(3600,Math.max(0,v.interval)):0,repeat:typeof v.repeat==='boolean'?v.repeat:false}}
  fallback.duck=typeof input.duck==='boolean'?input.duck:true;fallback.duckPercent=Number.isFinite(input.duckPercent)?Math.min(100,Math.max(0,input.duckPercent)):25;
 }catch{/* Invalid local preferences fall back without restoring playback. */}
 return fallback;
}

interface TrackProps {id:TrackId;config:TrackConfig;change:(id:TrackId,c:TrackConfig)=>void;statusChanged:(id:TrackId,status:TrackStatus)=>void;gain:number;stopSignal:number;pauseSignal:number}
function AudioTrack({id,config,change,statusChanged,gain,stopSignal,pauseSignal}:TrackProps){
 const name=trackNames[id];
 const [files,setFiles]=useState<LocalClip[]>([]),[index,setIndex]=useState(0),[status,setStatus]=useState<TrackStatus>('empty'),[error,setError]=useState(''),[duration,setDuration]=useState(0);
 const element=useRef<HTMLAudioElement|null>(null),clips=useRef<LocalClip[]>([]),current=useRef(0),state=useRef<TrackStatus>('empty'),settings=useRef(config),mounted=useRef(true),generation=useRef(0),timer=useRef<ReturnType<typeof setTimeout>|null>(null),deadline=useRef(0),remaining=useRef(0),callback=useRef(statusChanged);
 settings.current=config;callback.current=statusChanged;
 const update=(next:TrackStatus)=>{state.current=next;if(mounted.current)setStatus(next);callback.current(id,next)};
 const cancelTimer=()=>{if(timer.current)clearTimeout(timer.current);timer.current=null};
 const stop=()=>{generation.current++;cancelTimer();remaining.current=0;const audio=element.current;if(audio){audio.pause();try{audio.currentTime=0}catch{}}current.current=0;setIndex(0);setError('');update(clips.current.length?'ready':'empty')};
 const pause=()=>{if(!activity(state.current))return;if(state.current==='waiting')remaining.current=Math.max(0,deadline.current-performance.now());generation.current++;cancelTimer();element.current?.pause();update('paused')};
 const playIndex=async(next:number,resume=false)=>{
  const audio=element.current,clip=clips.current[next];if(!audio||!clip)return;
  cancelTimer();remaining.current=0;const token=++generation.current;current.current=next;setIndex(next);setError('');update('loading');
  if(!resume||audio.src!==clip.url){audio.src=clip.url;audio.load()}
  try{await audio.play();if(mounted.current&&token===generation.current)update('playing')}catch{if(mounted.current&&token===generation.current){update('error');setError('浏览器无法播放此音频，请更换支持的文件，或重新点击播放。')}}
 };
 const schedule=(next:number,delay:number)=>{cancelTimer();remaining.current=delay;deadline.current=performance.now()+delay;update('waiting');timer.current=setTimeout(()=>{timer.current=null;remaining.current=0;void playIndex(next)},delay)};
 const ended=()=>{if(!mounted.current||!['playing','loading'].includes(state.current))return;const next=current.current+1;if(next>=clips.current.length&&!settings.current.repeat){update('ended');return}current.current=next%clips.current.length;setIndex(current.current);schedule(current.current,settings.current.interval*1000)};
 const start=()=>{if(!clips.current.length||activity(state.current))return;if(state.current==='paused'&&remaining.current>0){schedule(current.current,remaining.current);return}void playIndex(state.current==='ended'?0:current.current,state.current==='paused')};
 const choose=(incoming:FileList|null)=>{
  if(!incoming?.length)return;const list=Array.from(incoming);
  if(list.length>20||list.reduce((n,f)=>n+f.size,0)>500*1024*1024){setError('每个通道最多选择 20 个文件，总大小不超过 500 MB。');return}
  if(list.some(f=>!f.size||!(f.type.startsWith('audio/')||f.type.startsWith('video/')||(!f.type&&/\.(wav|mp3|m4a|aac|ogg|opus|flac|webm|mp4)$/i.test(f.name))))){setError('请选择有效的音频或含音轨的视频文件；原播放列表保持不变。');return}
  stop();element.current?.removeAttribute('src');element.current?.load();clips.current.forEach(f=>URL.revokeObjectURL(f.url));const next=list.map(f=>({name:f.name,url:URL.createObjectURL(f)}));clips.current=next;setFiles(next);setDuration(0);update('ready');
 };
 useEffect(()=>{mounted.current=true;const audio=new Audio();audio.preload='metadata';element.current=audio;audio.onended=ended;audio.onloadedmetadata=()=>{if(mounted.current)setDuration(Number.isFinite(audio.duration)?audio.duration:0)};audio.onerror=()=>{if(mounted.current&&clips.current.length&&activity(state.current)){generation.current++;cancelTimer();audio.pause();update('error');setError('文件无法解码或没有音轨，请换用有效的 WAV、MP3 等音频。')}};return()=>{mounted.current=false;generation.current++;cancelTimer();audio.onended=null;audio.onerror=null;audio.onloadedmetadata=null;audio.pause();audio.removeAttribute('src');audio.load();clips.current.forEach(f=>URL.revokeObjectURL(f.url));clips.current=[];element.current=null;callback.current(id,'empty')}},[]);
 useEffect(()=>{if(element.current)element.current.volume=Math.max(0,Math.min(1,config.volume/100*gain))},[config.volume,gain]);
 useEffect(()=>{if(stopSignal)stop()},[stopSignal]);
 useEffect(()=>{if(pauseSignal)pause()},[pauseSignal]);
 return <section className="audio-mixer-track" aria-label={name+'通道'}><div className="audio-mixer-track-head"><h4>{name}</h4><Badge tone={status==='playing'?'green':'neutral'}>{statusNames[status]}</Badge></div>
  <Field label={name+'文件'}><input type="file" multiple accept="audio/*,video/*,.wav,.mp3,.m4a,.flac,.ogg,.opus,.webm,.mp4" onChange={e=>{choose(e.target.files);e.target.value=''}}/></Field>
  {files.length>0&&<Field label={name+'当前片段'}><select value={index} onChange={e=>{const next=Number(e.target.value);stop();current.current=next;setIndex(next);setDuration(0)}}>{files.map((f,i)=><option key={f.url} value={i}>{i+1}. {f.name}</option>)}</select></Field>}
  <div className="audio-mixer-track-fields"><Field label={name+'音量'}><input type="number" min={0} max={100} value={config.volume} onChange={e=>change(id,{...config,volume:Math.min(100,Math.max(0,Number(e.target.value)))})}/></Field><Field label={name+'片段间隔秒数'}><input type="number" min={0} max={3600} step={0.1} value={config.interval} onChange={e=>change(id,{...config,interval:Math.min(3600,Math.max(0,Number(e.target.value)))})}/></Field></div>
  <label className="audio-mixer-check"><input type="checkbox" checked={config.repeat} onChange={e=>change(id,{...config,repeat:e.target.checked})}/> {name}列表循环</label>
  <div className="row-actions"><Button kind="primary" disabled={!files.length||activity(status)} onClick={start}>{status==='paused'?'继续':'播放'}{name}</Button><Button disabled={!activity(status)} onClick={pause}>暂停{name}</Button><Button disabled={!files.length} onClick={stop}>停止{name}</Button><Button disabled={!files.length} onClick={()=>{stop();element.current?.removeAttribute('src');element.current?.load();clips.current.forEach(f=>URL.revokeObjectURL(f.url));clips.current=[];setFiles([]);setDuration(0);update('empty')}}>清空{name}</Button></div>
  <small>{files.length} 个本地片段{duration>0?` · 当前约 ${duration.toFixed(1)} 秒`:''}{gain<1?` · 闪避后音量 ${Math.round(config.volume*gain)}%`:''}</small>
  {error&&<p className="notice" role="alert">{error}</p>}
 </section>;
}

interface RecorderProps {stopSignal:number;pauseSignal:number;activityChanged:(recording:boolean)=>void}
function MicrophoneRecorder({stopSignal,pauseSignal,activityChanged}:RecorderProps){
 const [status,setStatus]=useState<'idle'|'requesting'|'recording'|'ready'>('idle'),[error,setError]=useState(''),[recording,setRecording]=useState<{url:string;extension:string;bytes:number}|null>(null),[seconds,setSeconds]=useState(0),[devices,setDevices]=useState<MediaDeviceInfo[]>([]),[device,setDevice]=useState('');
 const generation=useRef(0),stream=useRef<MediaStream|null>(null),recorder=useRef<MediaRecorder|null>(null),preview=useRef<HTMLAudioElement>(null),objectUrl=useRef(''),timer=useRef<ReturnType<typeof setInterval>|null>(null),alive=useRef(true),callback=useRef(activityChanged),chunks=useRef<Blob[]>([]),size=useRef(0),started=useRef(0);callback.current=activityChanged;
 const release=()=>{stream.current?.getTracks().forEach(t=>t.stop());stream.current=null;if(timer.current)clearInterval(timer.current);timer.current=null};
 const finish=()=>{if(status==='requesting'){generation.current++;release();setStatus(recording?'ready':'idle');callback.current(false);return}if(recorder.current?.state==='recording'){recorder.current.stop();release()}preview.current?.pause()};
 const start=async()=>{
  if(!window.isSecureContext||!navigator.mediaDevices?.getUserMedia||!window.MediaRecorder){setError('当前环境不支持麦克风录音，请使用 localhost 或 HTTPS 和支持录音的浏览器。');return}
  const token=++generation.current;setError('');setStatus('requesting');preview.current?.pause();callback.current(true);
  try{
   const input=await navigator.mediaDevices.getUserMedia({video:false,audio:{echoCancellation:true,noiseSuppression:true,...(device?{deviceId:{exact:device}}:{})}});
   if(!alive.current||token!==generation.current){input.getTracks().forEach(t=>t.stop());return}
   stream.current=input;const mime=['audio/webm;codecs=opus','audio/webm','audio/mp4'].find(m=>MediaRecorder.isTypeSupported(m));const mr=new MediaRecorder(input,mime?{mimeType:mime}:{});recorder.current=mr;chunks.current=[];size.current=0;started.current=performance.now();setSeconds(0);
   mr.ondataavailable=e=>{if(token!==generation.current||!e.data.size)return;chunks.current.push(e.data);size.current+=e.data.size;if(size.current>=10*1024*1024&&mr.state==='recording'){mr.stop();release()}};
   mr.onstop=()=>{release();recorder.current=null;if(!alive.current||token!==generation.current)return;callback.current(false);const blob=new Blob(chunks.current,{type:mr.mimeType});chunks.current=[];if(!blob.size){setError('没有录到有效声音，请确认麦克风后重试。');setStatus(recording?'ready':'idle');return}if(objectUrl.current)URL.revokeObjectURL(objectUrl.current);const url=URL.createObjectURL(blob);objectUrl.current=url;setRecording({url,extension:mr.mimeType.includes('mp4')?'m4a':'webm',bytes:blob.size});setStatus('ready')};
   mr.onerror=()=>{if(token!==generation.current)return;generation.current++;release();callback.current(false);setStatus(recording?'ready':'idle');setError('录音设备出错，本次录音未保存，请重新连接设备。')};
   input.getAudioTracks().forEach(t=>t.addEventListener('ended',()=>{if(token===generation.current&&mr.state==='recording'){setError('麦克风已断开，录音已经停止。');mr.stop();release()}},{once:true}));
   mr.start(250);setStatus('recording');timer.current=setInterval(()=>{const elapsed=Math.floor((performance.now()-started.current)/1000);if(alive.current)setSeconds(Math.min(elapsed,60));if(elapsed>=60&&mr.state==='recording'){mr.stop();release()}},250);
  }catch(e){if(alive.current&&token===generation.current){release();callback.current(false);setStatus(recording?'ready':'idle');const name=(e as {name?:string}).name;setError(name==='NotAllowedError'?'麦克风权限未获允许，请在站点设置中允许后重试。':name==='NotFoundError'?'未找到麦克风，请连接设备后重试。':'麦克风无法启动，可能被占用或所选设备不可用。')}}
 };
 useEffect(()=>{alive.current=true;return()=>{alive.current=false;generation.current++;if(recorder.current){recorder.current.ondataavailable=null;recorder.current.onstop=null;recorder.current.onerror=null;if(recorder.current.state==='recording')recorder.current.stop()}release();preview.current?.pause();if(objectUrl.current)URL.revokeObjectURL(objectUrl.current);callback.current(false)}},[]);
 useEffect(()=>{if(stopSignal)finish()},[stopSignal]);useEffect(()=>{if(pauseSignal)finish()},[pauseSignal]);
 const enumerate=async()=>{try{if(!navigator.mediaDevices?.enumerateDevices)throw new Error();const list=await navigator.mediaDevices.enumerateDevices();if(alive.current)setDevices(list.filter(d=>d.kind==='audioinput'))}catch{setError('麦克风列表读取失败，可以尝试默认麦克风。')}};
 return <section className="audio-mixer-recorder" aria-label="麦克风录音"><div className="audio-mixer-track-head"><h4>麦克风录音与回放</h4><Badge>{status==='recording'?`录音中 ${seconds}/60 秒`:status==='requesting'?'等待麦克风授权':recording?'录音已就绪':'未开始录音'}</Badge></div><p className="muted">只在点击录音后采集，不监听扬声器、不直通直播软件。录完后可在这里回放或下载，再作为本地音频导入。最长 60 秒或 10 MB。</p><Field label="录音麦克风"><select value={device} disabled={status==='recording'||status==='requesting'} onChange={e=>setDevice(e.target.value)}><option value="">默认麦克风</option>{devices.filter(d=>d.deviceId).map((d,i)=><option value={d.deviceId} key={d.deviceId}>{d.label||`麦克风 ${i+1}`}</option>)}</select></Field><div className="row-actions"><Button kind="primary" disabled={status==='recording'||status==='requesting'} onClick={()=>void start()}>开始麦克风录音</Button><Button disabled={status!=='recording'&&status!=='requesting'} onClick={finish}>{status==='requesting'?'取消麦克风请求':'停止麦克风录音'}</Button><Button onClick={()=>void enumerate()}>刷新麦克风列表</Button></div>{error&&<p role="alert" className="notice">{error}</p>}{recording&&<div className="audio-mixer-recording"><audio ref={preview} src={recording.url} controls preload="metadata" aria-label="麦克风录音回放" onPlay={()=>callback.current(true)} onPause={()=>{if(status!=='recording')callback.current(false)}} onEnded={()=>callback.current(false)}/><small>{(recording.bytes/1024).toFixed(1)} KB · 未上传</small><Button onClick={()=>{const a=document.createElement('a');a.href=recording.url;a.download='本地麦克风录音.'+recording.extension;a.click()}}>下载麦克风录音</Button></div>}</section>;
}

interface Props {sessionId:string;visible:boolean;speechActive?:boolean;onActivityChange:(value:boolean)=>void}
export default function AudioMixer({sessionId,visible,speechActive=false,onActivityChange}:Props){
 const key='live-audio-mixer:'+sessionId;
 const [config,setConfig]=useState<MixerConfig>(()=>readConfig(key)),[statuses,setStatuses]=useState<Partial<Record<TrackId,TrackStatus>>>({}),[recordingActive,setRecordingActive]=useState(false),[stopSignal,setStopSignal]=useState(0),[pauseSignal,setPauseSignal]=useState(0),[note,setNote]=useState(''),[saveError,setSaveError]=useState('');
 const activityCallback=useRef(onActivityChange);activityCallback.current=onActivityChange;
 const active=Object.values(statuses).some(s=>activity(s))||recordingActive;
 const statusChanged=useCallback((id:TrackId,status:TrackStatus)=>setStatuses(current=>current[id]===status?current:{...current,[id]:status}),[]);
 useEffect(()=>{activityCallback.current(active)},[active]);
 useEffect(()=>{setConfig(readConfig(key));setStatuses({});setRecordingActive(false);return()=>activityCallback.current(false)},[key]);
 useEffect(()=>{try{localStorage.setItem(key,JSON.stringify(config));setSaveError('')}catch{setSaveError('浏览器未能保存音量设置，刷新后需重新配置。')}},[config,key]);
 useEffect(()=>{const visibility=()=>{if(document.hidden){setPauseSignal(v=>v+1);setNote('页面转入后台，音频已暂停，麦克风录音已停止。返回后请手动继续。')}};document.addEventListener('visibilitychange',visibility);return()=>document.removeEventListener('visibilitychange',visibility)},[]);
 const change=useCallback((id:TrackId,value:TrackConfig)=>setConfig(c=>({...c,tracks:{...c.tracks,[id]:value}})),[]);
 const subActive=statuses.sub==='playing';
 return <section className="panel live-audio-mixer" aria-label="本地音频编排" hidden={!visible}>
  <div className="live-panel-title"><h3>主副音频与环境音</h3><Badge tone={active?'green':'neutral'}>{active?'本地音频运行中':'未播放'}</Badge></div>
  <p className="muted">声音只在当前浏览器播放，不发送到抖音或直播伴侣。每个通道可选择多段素材，按列表顺序播放，片段结束后等待设定间隔；副音频是独立通道，不中断主音频。</p>
  <div className="audio-mixer-global"><label className="audio-mixer-check"><input type="checkbox" checked={config.duck} onChange={e=>setConfig(c=>({...c,duck:e.target.checked}))}/> 语音播报或副音频播放时降低背景音量</label><Field label="闪避音量比例"><input type="number" min={0} max={100} value={config.duckPercent} onChange={e=>setConfig(c=>({...c,duckPercent:Math.min(100,Math.max(0,Number(e.target.value)))}))}/></Field><div className="row-actions"><Button disabled={!active} onClick={()=>setPauseSignal(v=>v+1)}>暂停全部音频</Button><Button onClick={()=>{setStopSignal(v=>v+1);setNote('已停止各通道并释放麦克风；本地文件仍可再次播放。')}}>停止全部音频</Button></div></div>
  {note&&<p role="status" className="notice">{note}</p>}{saveError&&<p role="alert">{saveError}</p>}
  <div className="audio-mixer-grid">{trackIds.map(id=><AudioTrack key={sessionId+':'+id} id={id} config={config.tracks[id]} change={change} statusChanged={statusChanged} gain={config.duck&&(speechActive||(id!=='sub'&&subActive))?config.duckPercent/100:1} stopSignal={stopSignal} pauseSignal={pauseSignal}/>)}</div>
  <MicrophoneRecorder key={sessionId+':mic'} stopSignal={stopSignal} pauseSignal={pauseSignal} activityChanged={setRecordingActive}/>
  <p className="muted">只保存音量、间隔与循环设置，不保存本地文件授权。刷新、切换场次或离开工作台会停止并释放资源；重新进入不会自动出声。仅使用你有权使用的音频素材。</p>
 </section>;
}
