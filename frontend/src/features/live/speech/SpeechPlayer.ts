import {api,requestId} from '../../../api';
import type {Clip,SpeechQueue} from './types';
export type PlayerStatus='idle'|'loading'|'playing'|'paused'|'gap'|'ended'|'error';
interface Job {qid:string;clip:Clip;offset:number;interruption:boolean}
export interface PlayerState {status:PlayerStatus;current:Job|null;remaining:number;error:string;logError:string}
export class SpeechPlayer {
 private audio:HTMLAudioElement;
 private jobs:Job[]=[];
 private queued:Job[]=[];
 private initial:Job[]=[];
 private urls=new Set<string>();
 private generation=0;
 private timer:ReturnType<typeof setTimeout>|undefined;
 private gapUntil=0;
 private gapRemaining=0;
 private disposed=false;
 private state:PlayerState={status:'idle',current:null,remaining:0,error:'',logError:''};
 private listeners=new Set<()=>void>();
 constructor(private sid:string){
  this.audio=new Audio();this.audio.dataset.liveSpeech='true';this.audio.preload='auto';
  this.audio.onended=()=>this.finished();
  this.audio.onerror=()=>{if(this.state.status==='playing'||this.state.status==='loading')this.fail('音频无法播放，请重试或跳过当前句。')};
 }
 subscribe=(listener:()=>void)=>{this.listeners.add(listener);return()=>{this.listeners.delete(listener)}};
 getSnapshot=()=>this.state;
 private emit(status:PlayerStatus,error=''){this.state={...this.state,status,error,current:this.jobs[0]||null,remaining:this.jobs.length+this.queued.length};this.listeners.forEach(f=>f())}
 private log(action:string,detail:string,qid=this.jobs[0]?.qid){if(!qid||this.disposed)return;void api(`/live/speech/${this.sid}/events`,'POST',{queue_id:qid,action,detail,request_id:requestId()}).catch(()=>{if(this.disposed)return;this.state={...this.state,logError:'播报记录保存失败，声音操作已执行。请检查连接。'};this.listeners.forEach(f=>f())})}
 private cancel(){this.generation++;if(this.timer)clearTimeout(this.timer);this.timer=undefined;this.audio.pause()}
 private unload(){this.audio.removeAttribute('src');this.audio.load();this.urls.forEach(url=>URL.revokeObjectURL(url));this.urls.clear()}
 private fail(message:string){this.cancel();this.emit('error',message);this.log('error',message)}
 prepare(queue:SpeechQueue){this.stop(false);this.initial=queue.entries.map(clip=>({qid:queue.id,clip,offset:0,interruption:false}));this.jobs=this.initial.map(x=>({...x}));this.emit('idle')}
 private async blob(url:string){const token=sessionStorage.getItem('demo-token');const response=await fetch(url,{headers:token?{'X-Demo-Token':token}:{},signal:AbortSignal.timeout(20000)});if(!response.ok)throw new Error('音频下载失败，请检查连接后重试。');return response.blob()}
 private async run(){
  if(this.disposed)return;
  const job=this.jobs[0];if(!job){this.emit('ended');return}
  this.cancel();const token=this.generation;this.emit('loading');
  try{
   const allowed=await api<{blocked:string[]}>(`/live/speech/queues/${job.qid}/check`);
   if(this.disposed||token!==this.generation)return;
   if(job.clip.blocked||allowed.blocked.includes(job.clip.id)){this.log('blocked','跳过命中屏蔽词的片段');this.jobs.shift();this.insertQueued();await this.run();return}
   const result=await api<{url?:string;blocked?:boolean}>(`/live/speech/queues/${job.qid}/clips/${job.clip.id}`,'POST');
   if(this.disposed||token!==this.generation)return;
   if(result.blocked){this.jobs.shift();this.insertQueued();await this.run();return}
   const blob=await this.blob(result.url!);
   if(this.disposed||token!==this.generation)return;
   this.unload();const url=URL.createObjectURL(blob);this.urls.add(url);this.audio.src=url;
   await new Promise<void>((resolve,reject)=>{const timer=setTimeout(()=>reject(new Error('音频加载超时，请重试。')),15000);this.audio.onloadedmetadata=()=>{clearTimeout(timer);resolve()};this.audio.onerror=()=>{clearTimeout(timer);reject(new Error('音频无法解码，请重试或跳过。'))};this.audio.load()});
   if(this.disposed||token!==this.generation)return;
   this.audio.onerror=()=>{if(token===this.generation)this.fail('音频播放失败，请重试或跳过。')};
   this.audio.currentTime=Math.min(job.offset,Math.max(0,this.audio.duration-.01));
   await this.audio.play();if(token!==this.generation||this.disposed){this.audio.pause();return}this.emit('playing');
  }catch(e){if(!this.disposed&&token===this.generation)this.fail((e as Error).message||'无法开始播放，请重试。')}
 }
 private insertQueued(){if(this.queued.length){this.jobs.unshift(...this.queued);this.queued=[]}}
 private finished(){
  if(this.disposed||this.state.status!=='playing')return;
  const job=this.jobs.shift();this.log('ended','完成片段：'+(job?.clip.text||'').slice(0,80),job?.qid);this.insertQueued();
  if(!this.jobs.length){this.unload();this.emit('ended');return}
  this.gapRemaining=job?.clip.gap_ms||0;this.waitGap();
 }
 private waitGap(){this.emit('gap');this.gapUntil=performance.now()+this.gapRemaining;this.timer=setTimeout(()=>{this.gapRemaining=0;void this.run()},this.gapRemaining)}
 play(){if(this.disposed||['playing','loading','gap'].includes(this.state.status))return;if(!this.jobs.length)this.jobs=this.initial.map(x=>({...x,offset:0}));this.log(this.state.status==='paused'?'resume':'start','开始或继续本地语音播放');if(this.gapRemaining>0)this.waitGap();else void this.run()}
 pause(){if(!['playing','loading','gap'].includes(this.state.status))return;const job=this.jobs[0];if(this.state.status==='playing'&&job)job.offset=this.audio.currentTime;if(this.state.status==='gap')this.gapRemaining=Math.max(0,this.gapUntil-performance.now());this.cancel();this.emit('paused');this.log('pause','暂停本地语音，保留播放位置')}
 stop(log=true){if(log)this.log('stop','停止本地播报');this.cancel();this.unload();this.queued=[];this.jobs=[];this.gapRemaining=0;this.emit('idle')}
 skip(){const job=this.jobs[0];if(!job)return;const paused=this.state.status==='paused'||this.state.status==='idle';this.log('skip','跳过当前片段');this.cancel();this.jobs.shift();this.insertQueued();this.gapRemaining=0;if(paused)this.emit(this.jobs.length?'paused':'ended');else void this.run()}
 insert(queue:SpeechQueue,immediate:boolean){
  const jobs=queue.entries.map(clip=>({qid:queue.id,clip,offset:0,interruption:true}));
  const wasActive=['playing','loading','gap'].includes(this.state.status);
  if(!immediate&&this.jobs.length&&this.state.status!=='gap'){this.queued.push(...jobs);this.emit(this.state.status);this.log('interrupt','临时话术将在当前句后插播',queue.id);return}
  if(this.state.status==='playing'&&this.jobs[0])this.jobs[0].offset=this.audio.currentTime;
  this.cancel();this.gapRemaining=0;this.jobs.unshift(...jobs);this.log('interrupt','临时话术插入，保留原片段位置',queue.id);
  if(wasActive)void this.run();else this.emit('paused');
 }
 dispose(){this.disposed=true;this.cancel();this.unload();this.listeners.clear()}
}
