import {useEffect, useRef, useState} from 'react';
import {Monitor, Settings2} from 'lucide-react';
import {Badge, Button, Field} from '../../components/ui';
import './preview-effects.css';

type Source = {id:number;kind:'camera';name:string;stream:MediaStream}|{id:number;kind:'file';name:string;url:string};
type Status = 'idle'|'requesting'|'loading'|'ready'|'playing'|'paused'|'ended'|'error';
const statusLabels:Record<Status,string>={idle:'未选择来源',requesting:'等待摄像头授权',loading:'正在加载画面',ready:'视频已就绪',playing:'预览中',paused:'视频已暂停',ended:'视频已结束',error:'预览不可用'};
function cameraError(error:unknown){
 const name=(error as {name?:string})?.name;
 if(name==='NotAllowedError'||name==='SecurityError')return '摄像头权限未获允许。请在浏览器站点设置中允许摄像头，然后重新启动。';
 if(name==='NotFoundError')return '没有找到摄像头。请连接设备后刷新摄像头列表。';
 if(name==='NotReadableError'||name==='AbortError')return '摄像头无法打开，可能被其他程序占用。关闭占用程序后重试。';
 if(name==='OverconstrainedError')return '所选设备或分辨率不可用。请改用默认设备或较低分辨率重试。';
 return '摄像头启动失败。请检查设备连接与浏览器权限后重试。';
}
type LayerOptions={visible:boolean;opacity:number;width:number;x:number;y:number;flipX:boolean;flipY:boolean;loop:boolean};
type LayerFile={id:number;url:string;kind:'image'|'video';name:string;status:'loading'|'ready'|'playing'|'paused'|'error';error:string};
type Filters={brightness:number;contrast:number;saturation:number;grayscale:number;sepia:number};
const defaultLayer=(index:number):LayerOptions=>({visible:true,opacity:100,width:30,x:index?95:5,y:index?95:5,flipX:false,flipY:false,loop:false});
const defaultFilters=():Filters=>({brightness:100,contrast:100,saturation:100,grayscale:0,sepia:0});
const limited=(value:unknown,min:number,max:number,fallback:number)=>typeof value==='number'&&Number.isFinite(value)?Math.max(min,Math.min(max,value)):fallback;
function readEffects(key:string){
 try{const saved=JSON.parse(localStorage.getItem(key)||'null');const f=saved?.filters;return {filters:{brightness:limited(f?.brightness,50,150,100),contrast:limited(f?.contrast,50,150,100),saturation:limited(f?.saturation,0,200,100),grayscale:limited(f?.grayscale,0,100,0),sepia:limited(f?.sepia,0,100,0)},layers:[0,1].map(i=>{const v=saved?.layers?.[i],d=defaultLayer(i);return {visible:typeof v?.visible==='boolean'?v.visible:d.visible,opacity:limited(v?.opacity,0,100,d.opacity),width:limited(v?.width,10,90,d.width),x:limited(v?.x,0,100,d.x),y:limited(v?.y,0,100,d.y),flipX:!!v?.flipX,flipY:!!v?.flipY,loop:!!v?.loop}})}}catch{return {filters:defaultFilters(),layers:[defaultLayer(0),defaultLayer(1)]}}
}
export default function LivePreview({settingsOpen,openSettings,closeSettings,openTools,sessionKey='default',tool}:{settingsOpen:boolean;openSettings:()=>void;closeSettings:()=>void;openTools:()=>void;sessionKey?:string;tool?:'source'|'layers'|'filters'}){
 const storageKey='live-preview-effects:'+sessionKey;
 const [effects,setEffects]=useState(()=>readEffects(storageKey)),[effectPanel,setEffectPanel]=useState<'layers'|'filters'|''>(tool==='layers'||tool==='filters'?tool:''),[layerFiles,setLayerFiles]=useState<(LayerFile|null)[]>([null,null]),[persistError,setPersistError]=useState('');
 const layerActive=useRef<(LayerFile|null)[]>([null,null]),layerVideos=useRef<(HTMLVideoElement|null)[]>([null,null]),layerId=useRef(0),layerTimers=useRef<(ReturnType<typeof setTimeout>|undefined)[]>([]);
 useEffect(()=>{setEffectPanel(tool==='layers'||tool==='filters'?tool:'')},[tool]);
 useEffect(()=>{try{localStorage.setItem(storageKey,JSON.stringify(effects));setPersistError('')}catch{setPersistError('当前浏览器无法保存画面设置，本次仍可预览。')}},[effects,storageKey]);
 const releaseLayer=(i:number)=>{if(layerTimers.current[i])clearTimeout(layerTimers.current[i]);const media=layerVideos.current[i];if(media){media.pause();media.removeAttribute('src');media.load()}const file=layerActive.current[i];layerActive.current[i]=null;if(file)URL.revokeObjectURL(file.url)};
 useEffect(()=>()=>{[0,1].forEach(releaseLayer)},[]);
 const patchLayer=(i:number,patch:Partial<LayerOptions>)=>{if(patch.visible===false){layerVideos.current[i]?.pause()}setEffects(e=>({...e,layers:e.layers.map((x,n)=>n===i?{...x,...patch}:x)}))};
 const patchLayerFile=(i:number,id:number,patch:Partial<LayerFile>)=>{if(layerActive.current[i]?.id!==id)return;const next={...layerActive.current[i]!,...patch};layerActive.current[i]=next;setLayerFiles(files=>files.map((f,n)=>n===i?next:f))};
 const failLayer=(i:number,id:number,message:string)=>{if(layerActive.current[i]?.id!==id)return;releaseLayer(i);setLayerFiles(files=>files.map((f,n)=>n===i&&f?{...f,status:'error',error:message}:f))};
 const selectLayer=(i:number,file?:File)=>{
  if(!file)return;
  const image=/^image\/(png|jpeg|webp|gif|avif)$/.test(file.type)||(!file.type&&/\.(png|jpe?g|webp|gif|avif)$/i.test(file.name));
  const isVideo=file.type.startsWith('video/')||(!file.type&&/\.(mp4|webm|mov|m4v|ogv)$/i.test(file.name));
  if(!file.size||(!image&&!isVideo)||file.size>(image?30:200)*1024*1024){setError('图层请选择非空 PNG/JPG/WebP/GIF/AVIF 图片（不超过30MB）或本地视频（不超过200MB）。原图层保持不变。');return}
  releaseLayer(i);setError('');const next:LayerFile={id:++layerId.current,url:URL.createObjectURL(file),kind:image?'image':'video',name:file.name,status:'loading',error:''};layerActive.current[i]=next;setLayerFiles(files=>files.map((f,n)=>n===i?next:f));
  layerTimers.current[i]=setTimeout(()=>{if(layerActive.current[i]?.id===next.id&&layerActive.current[i]?.status==='loading')failLayer(i,next.id,'图层加载超时，请更换文件。')},15000);
 };
 const playLayer=async(i:number)=>{const file=layerActive.current[i],media=layerVideos.current[i];if(!file||!media)return;try{await media.play()}catch{patchLayerFile(i,file.id,{status:'paused',error:'浏览器未能播放图层视频，请再次点击播放或更换文件。'})}};
 const filterValue=`brightness(${effects.filters.brightness}%) contrast(${effects.filters.contrast}%) saturate(${effects.filters.saturation}%) grayscale(${effects.filters.grayscale}%) sepia(${effects.filters.sepia}%)`;
 const [source,setSource]=useState<Source|null>(null),[status,setStatus]=useState<Status>('idle'),[error,setError]=useState(''),[devices,setDevices]=useState<MediaDeviceInfo[]>([]),[device,setDevice]=useState(''),[resolution,setResolution]=useState('720'),[portrait,setPortrait]=useState(false),[dimensions,setDimensions]=useState(''),[deviceNote,setDeviceNote]=useState('');
 const video=useRef<HTMLVideoElement>(null),active=useRef<Source|null>(null),generation=useRef(0),mounted=useRef(true);
 const release=()=>{generation.current++;const previous=active.current;active.current=null;if(previous?.kind==='camera')previous.stream.getTracks().forEach(track=>track.stop());const element=video.current;if(element){element.pause();element.srcObject=null;element.removeAttribute('src');element.load()}if(previous?.kind==='file')URL.revokeObjectURL(previous.url)};
 useEffect(()=>{mounted.current=true;return()=>{mounted.current=false;release()}},[]);
 const stop=()=>{release();[0,1].forEach(i=>{releaseLayer(i)});setLayerFiles([null,null]);setSource(null);setStatus('idle');setError('');setDimensions('')};
 const fail=(id:number,message:string)=>{if(!mounted.current||generation.current!==id)return;release();setSource(null);setStatus('error');setError(message);setDimensions('')};
 const refreshDevices=async()=>{
  if(!navigator.mediaDevices?.enumerateDevices){setDeviceNote('当前环境无法列出设备，请使用本机 localhost 或 HTTPS 页面。');return}
  try{const list=(await navigator.mediaDevices.enumerateDevices()).filter(d=>d.kind==='videoinput');if(!mounted.current)return;setDevices(list);setDeviceNote(list.length?'未授权时可能只显示默认设备，授权后可再次刷新。':'暂未发现设备，或浏览器尚未开放设备列表。')}catch{if(mounted.current)setDeviceNote('设备列表读取失败，可尝试直接启动默认摄像头。')}
 };
 const startCamera=async()=>{
  release();setSource(null);setDimensions('');setError('');
  if(!window.isSecureContext||!navigator.mediaDevices?.getUserMedia){setStatus('error');setError('当前环境不能访问摄像头。请使用本机 localhost 或 HTTPS 地址，并确认浏览器支持摄像头。');return}
  const id=generation.current;setStatus('requesting');
  try{
   const stream=await navigator.mediaDevices.getUserMedia({audio:false,video:{...(device?{deviceId:{exact:device}}:{}),width:{ideal:resolution==='1080'?1920:resolution==='480'?640:1280},height:{ideal:Number(resolution)}}});
   if(!mounted.current||generation.current!==id){stream.getTracks().forEach(track=>track.stop());return}
   const track=stream.getVideoTracks()[0];if(!track){stream.getTracks().forEach(t=>t.stop());fail(id,'设备没有提供视频轨道，请重新选择摄像头。');return}
   track.addEventListener('ended',()=>fail(id,'摄像头已断开或授权已被撤销，请重新连接并启动。'),{once:true});
   const next:Source={id,kind:'camera',name:track.label||'默认摄像头',stream};active.current=next;setSource(next);setStatus('loading');void refreshDevices();
  }catch(e){fail(id,cameraError(e))}
 };
 const selectFile=(file?:File)=>{
  if(!file)return;
  if(!file.size){setError('所选文件为空，请选择有效的视频文件。');return}
  if(!(file.type.startsWith('video/')||(!file.type&&/\.(mp4|webm|mov|m4v|ogv|ogg)$/i.test(file.name)))){setError('请选择视频文件，例如 MP4 或 WebM。原有预览保持不变。');return}
  release();setError('');setDimensions('');const next:Source={id:generation.current,kind:'file',name:file.name,url:URL.createObjectURL(file)};active.current=next;setSource(next);setStatus('loading');
 };
 const play=async()=>{const current=active.current;if(!current||!video.current)return;setError('');try{await video.current.play()}catch{if(mounted.current&&active.current?.id===current.id){setStatus('paused');setError('浏览器未能开始播放。请点击播放预览重试，或更换浏览器支持的视频文件。')}}};
 useEffect(()=>{
  if(!source||!video.current)return;
  const element=video.current;
  if(source.kind==='camera'){element.srcObject=source.stream;void play()}
  const timer=window.setTimeout(()=>{if(generation.current===source.id&&element.readyState<1)fail(source.id,'画面加载超时，请检查设备或更换有效的视频文件。')},15000);
  return()=>window.clearTimeout(timer);
 },[source]);
 const current=()=>Boolean(source&&active.current?.id===source.id);
 // This is a user-operated preview, not a decorative background video.
 // Files intentionally do not autoplay or loop; camera playback follows an explicit click.
 return <div className="panel live-preview-panel">
  <div className="live-panel-title"><h2><Monitor size={17}/>直播画面</h2><div className="row-actions"><button className="button ghost" type="button" aria-pressed={portrait} onClick={()=>setPortrait(!portrait)}>{portrait?'竖屏 9:16':'横屏 16:9'}</button><Button onClick={openTools}><Settings2 size={15}/>画面设置</Button></div></div>
  <div className="live-preview-status" role="status"><Badge tone={status==='playing'?'green':'neutral'}>本地预览 · {statusLabels[status]}</Badge>{dimensions&&<small>{dimensions}</small>}<small>未向抖音推流</small></div>
  <div className={'live-preview '+(portrait?'portrait':'')} aria-label="直播画面预留区">
   {source?<video key={source.id} ref={video} className="live-preview-video" style={{filter:filterValue}} aria-label="本地画面预览" src={source.kind==='file'?source.url:undefined} muted playsInline controls={source.kind==='file'} preload="metadata" onLoadedMetadata={()=>{if(!current()||!video.current)return;setDimensions(`${video.current.videoWidth} × ${video.current.videoHeight}`);if(source.kind==='file')setStatus('ready')}} onPlaying={()=>{if(current())setStatus('playing')}} onPause={()=>{if(current()&&source.kind==='file'&&!video.current?.ended)setStatus('paused')}} onEnded={()=>{if(current())setStatus('ended')}} onError={()=>fail(source.id,source.kind==='file'?'视频无法读取或编码不受浏览器支持，请重新选择视频；可尝试 MP4（H.264）或 WebM。':'摄像头画面读取失败，请停止后重新启动。')}/>:<div className="live-preview-surface"><Monitor size={36}/><strong>{status==='requesting'?'请在浏览器中确认摄像头权限':'尚未选择画面来源'}</strong><p>选择本地视频或摄像头，在这里预览画面。</p><Button onClick={openSettings}>选择画面来源</Button></div>}
   {layerFiles.map((file,i)=>file&&file.status!=='error'&&<div key={file.id} className="live-overlay-layer" data-layer={i+1} hidden={!effects.layers[i].visible} style={{zIndex:i+2,opacity:effects.layers[i].opacity/100,width:effects.layers[i].width+'%',left:effects.layers[i].x+'%',top:effects.layers[i].y+'%',transform:`translate(-${effects.layers[i].x}%,-${effects.layers[i].y}%) scale(${effects.layers[i].flipX?-1:1},${effects.layers[i].flipY?-1:1})`,filter:filterValue}}>{file.kind==='image'?<img src={file.url} alt={`图层 ${i+1}：${file.name}`} onLoad={()=>{if(layerTimers.current[i])clearTimeout(layerTimers.current[i]);patchLayerFile(i,file.id,{status:'ready'})}} onError={()=>failLayer(i,file.id,'图片无法读取，请重新选择有效图片。')}/>:<video ref={element=>{layerVideos.current[i]=element}} src={file.url} aria-label={`图层 ${i+1} 视频`} muted playsInline preload="metadata" loop={effects.layers[i].loop} onLoadedMetadata={()=>{if(layerTimers.current[i])clearTimeout(layerTimers.current[i]);patchLayerFile(i,file.id,{status:'ready'})}} onPlaying={()=>patchLayerFile(i,file.id,{status:'playing',error:''})} onPause={()=>patchLayerFile(i,file.id,{status:'paused'})} onEnded={()=>patchLayerFile(i,file.id,{status:'ready'})} onError={()=>failLayer(i,file.id,'图层视频无法读取或编码不受支持，请更换视频。')}/>}</div>)}
  </div>
  {source&&<p className="live-preview-source">{source.kind==='camera'?'摄像头':'本地文件'}：{source.name}</p>}
  {error&&<p className="notice" role="alert">{error}</p>}
  <div className="row-actions live-preview-actions"><Button onClick={settingsOpen?closeSettings:openSettings}>{settingsOpen?'收起来源设置':'来源设置'}</Button>{source?.kind==='file'&&<Button disabled={status==='loading'} onClick={()=>status==='playing'?video.current?.pause():void play()}>{status==='playing'?'暂停预览':'播放预览'}</Button>}{(source||layerFiles.some(Boolean)||status==='requesting')&&<Button onClick={stop}>{status==='requesting'?'取消摄像头请求':'停止预览'}</Button>}</div>
  <div className="row-actions live-effects-navigation"><button type="button" className="button secondary" aria-expanded={effectPanel==='layers'} onClick={()=>setEffectPanel(effectPanel==='layers'?'':'layers')}>图层设置</button><button type="button" className="button secondary" aria-expanded={effectPanel==='filters'} onClick={()=>setEffectPanel(effectPanel==='filters'?'':'filters')}>滤镜设置</button><small>画面效果仅在本页预览，不导出、不推流，也不保证平台去重判定。</small></div>
  {persistError&&<p role="status" className="notice">{persistError}</p>}
  {effectPanel==='layers'&&<section className="live-effects-panel" aria-label="双图层预览设置"><h3>双图层叠加 · 本地预览</h3><p className="muted">选择你有权使用的图片或视频。视频图层静音，点击播放后开始；上层为图层2。隐藏图层会暂停视频。设置按场次保存在本机，文件不上传，刷新后需要重新选择。</p><div className="live-layer-settings">{effects.layers.map((layer,i)=><fieldset className="live-layer-fieldset" key={i}><legend>图层 {i+1}</legend><Field label={`图层 ${i+1} 素材`}><input type="file" accept="image/png,image/jpeg,image/webp,image/gif,image/avif,video/*,.mp4,.webm,.mov" onChange={e=>{selectLayer(i,e.target.files?.[0]);e.target.value=''}}/></Field>{layerFiles[i]&&<p className="live-layer-filename">{layerFiles[i]!.name} · {{loading:'正在加载',ready:'已就绪',playing:'播放中',paused:'已暂停',error:'不可用'}[layerFiles[i]!.status]}</p>}{layerFiles[i]?.error&&<p role="alert" className="notice">{layerFiles[i]!.error}</p>}<div className="live-layer-checks"><label><input type="checkbox" checked={layer.visible} onChange={e=>patchLayer(i,{visible:e.target.checked})}/> 显示图层 {i+1}</label><label><input type="checkbox" checked={layer.flipX} onChange={e=>patchLayer(i,{flipX:e.target.checked})}/> 水平翻转图层 {i+1}</label><label><input type="checkbox" checked={layer.flipY} onChange={e=>patchLayer(i,{flipY:e.target.checked})}/> 垂直翻转图层 {i+1}</label></div>{(['opacity','width','x','y'] as const).map((field,index)=><Field key={field} label={`图层 ${i+1} ${['不透明度','宽度','横向位置','纵向位置'][index]}（${layer[field]}%）`}><input type="range" min={field==='width'?10:0} max={field==='width'?90:100} value={layer[field]} onChange={e=>patchLayer(i,{[field]:Number(e.target.value)})}/></Field>)}{layerFiles[i]?.kind==='video'&&<><label><input type="checkbox" checked={layer.loop} onChange={e=>patchLayer(i,{loop:e.target.checked})}/> 循环图层 {i+1} 视频</label><div className="row-actions"><Button disabled={!layer.visible||['loading','error'].includes(layerFiles[i]!.status)} onClick={()=>layerFiles[i]?.status==='playing'?layerVideos.current[i]?.pause():void playLayer(i)}>{layerFiles[i]?.status==='playing'?`暂停图层 ${i+1}`:`播放图层 ${i+1}`}</Button></div></>}<div className="row-actions"><Button disabled={!layerFiles[i]} onClick={()=>{releaseLayer(i);setLayerFiles(files=>files.map((f,n)=>n===i?null:f))}}>移除图层 {i+1}</Button><Button onClick={()=>patchLayer(i,defaultLayer(i))}>重置图层 {i+1} 位置</Button></div></fieldset>)}</div></section>}
  {effectPanel==='filters'&&<section className="live-effects-panel" aria-label="画面滤镜设置"><h3>画面滤镜 · 本地预览</h3><p className="muted">调整主画面和两个图层的显示效果。原素材文件保持不变，不包含美颜、人脸识别、音频变调或自动去重。</p><div className="live-filter-sliders">{(['brightness','contrast','saturation','grayscale','sepia'] as const).map((field,i)=><Field key={field} label={`${['亮度','对比度','饱和度','灰度','暖褐色'][i]}（${effects.filters[field]}%）`}><input type="range" min={['brightness','contrast'].includes(field)?50:0} max={field==='saturation'?200:['brightness','contrast'].includes(field)?150:100} value={effects.filters[field]} onChange={e=>setEffects(current=>({...current,filters:{...current.filters,[field]:Number(e.target.value)}}))}/></Field>)}</div><Button onClick={()=>setEffects(current=>({...current,filters:defaultFilters()}))}>恢复原始画面效果</Button></section>}
  {settingsOpen&&<section className="live-source-settings" aria-label="视频来源与预览"><h3>视频来源与预览</h3><Field label="本地视频文件"><input type="file" accept="video/*,.mp4,.webm,.mov,.m4v,.ogv" onChange={e=>{selectFile(e.target.files?.[0]);e.target.value=''}}/></Field><div className="form-grid"><Field label="预览摄像头"><select value={device} onChange={e=>setDevice(e.target.value)}><option value="">默认摄像头</option>{devices.filter(d=>d.deviceId).map((d,i)=><option key={d.deviceId} value={d.deviceId}>{d.label||`摄像头 ${i+1}`}</option>)}</select></Field><Field label="摄像头目标分辨率"><select value={resolution} onChange={e=>setResolution(e.target.value)}><option value="480">640 × 480</option><option value="720">1280 × 720</option><option value="1080">1920 × 1080</option></select></Field></div><div className="row-actions"><Button kind="primary" disabled={status==='requesting'} onClick={()=>void startCamera()}>启动摄像头预览</Button><Button onClick={()=>void refreshDevices()}>刷新摄像头列表</Button></div>{deviceNote&&<p className="muted">{deviceNote}</p>}<p className="muted">仅请求摄像头，不采集麦克风；视频默认静音。文件不上传。目标分辨率由设备支持情况决定，画面上方显示实际尺寸。</p><p className="muted">停止预览会释放摄像头或本地文件。切换场次、离开工作台或刷新后需要重新选择来源。OBS 与平台推流尚未接入。</p></section>}
 </div>;
}
