import type { LiveContext, LiveSession } from './features/live/types';
import type { KnowledgeOrigin } from './features/journey/CreativeOrigin';
export interface ClaimEvidence {id:string;category:'shipping'|'performance';claim:string;source:string;conditions:string;confirmed:boolean}
export interface Product {id:string;name:string;price:number;capacity:string;color:string;brand:string;description:string;restrictions:string;version:number;image_url:string;video_url?:string;evidence?:string;claim_evidence?:ClaimEvidence[]}
export interface Campaign {id:string;name:string;product_snapshot:Product;created_at:string;audience?:string;selling_point?:string;goal?:string;budget_limit?:number|null;start_date?:string;end_date?:string;strategy_version?:number;strategy_history?:V2Record[]}
export interface Creative {live_context?:LiveContext;replay_recipe?:string;knowledge_origin?:KnowledgeOrigin;id:string;campaign_id:string;direction:string;title:string;body:string;cta:string;script:string;version:number;status:string;source:string;product_snapshot:Product;parent_id?:string;family_id?:string;template?:string;tone?:string;angle?:string;model_name?:string;edited_by?:string}
export interface Plan {id:string;campaign_id:string;creative_id:string;creative_snapshot:Creative;name:string;budget:number;start_date:string;end_date:string;status:string;created_at:string;config_version?:number;config_history?:V2Record[]}
export interface Order {id:string;plan_id:string;creative_id:string;campaign_id:string;buyer_id:string;buyer_type:string;amount:number;created_at:string;quantity?:number;unit_price?:number;plan_config_version?:number}
export interface V2Record {id:string;campaign_id:string;created_at:string;[key:string]:any}
export interface Insight extends V2Record {source:string;facts:string[];hypotheses:string[];missing:string[];recommendation:string;status?:string;analytics_snapshot?:Analytics}
export interface ModelInfo {
 mode:string;label:string;configured:boolean;live_verified:boolean;model_name?:string|null;free_only:boolean;status:string;pricing_checked_on:string;
 busy?:boolean;operation?:string|null;operation_label?:string|null;operation_started_at?:string|null;last_success_at?:string|null;last_failure_at?:string|null;
 last_error?:string|null;last_error_kind?:string|null;call_count?:number;cost?:number|null;cost_note?:string;
 recent_calls?:{id:string;provider:string;model:string;operation:string;operation_label:string;started_at:string;finished_at:string|null;outcome:string;remote_calls:number;provider_succeeded:boolean;error_kind:string|null;error_message:string;usage:{prompt_tokens?:number;completion_tokens?:number;total_tokens?:number}|null;cost:number|null}[];
}
export interface State {live_sessions:LiveSession[];product:Product;campaigns:Campaign[];creatives:Creative[];plans:Plan[];orders:Order[];events:{id:string;plan_id:string;type:string;created_at:string}[];logs:{id:string;action:string;detail:string;created_at:string}[];insights:Insight[];adjustments:V2Record[];batches:V2Record[];tasks:V2Record[];observations:V2Record[];reports:V2Record[];model:ModelInfo}
export const generationSource=(item:{source?:string;model_name?:string;edited_by?:string})=>(item.source==='model'?(item.model_name?`智谱生成 · ${item.model_name}`:'模型生成 · 历史型号未记录'):item.source==='replay'?'演示回放':item.source==='knowledge'?'已核对知识草稿转入':'来源未记录')+(item.edited_by?' · 人工修订':'');
export interface Metrics {impressions:number|null;clicks:number;spend:number|null;orders:number;buyers:number;new_customers:number;unknown_buyers:number;revenue:number;ctr:number|null;roi:number|null;cpa:number|null;cac:number|null}
export interface Analytics {trend?:{points:{date:string;revenue:number;orders:number;spend:null}[];note:string};dataset:string;label:string;note:string;window:string;metrics:Metrics;rows:({name:string;plan_id?:string;creative_id?:string;live_context?:LiveContext}&Metrics)[];orders:Order[];spend_entries:V2Record[];views?:number;filters?:Record<string,string>}
export const requestId=()=>typeof crypto.randomUUID==='function'?crypto.randomUUID():Array.from(crypto.getRandomValues(new Uint8Array(16)),n=>n.toString(16).padStart(2,'0')).join('');
export class ApiError extends Error{constructor(message:string,public status:number){super(message)}}
const pendingMutations=new Map<string,string>();
export interface RequestOptions {signal?:AbortSignal;timeoutMs?:number}
async function fingerprint(text:string):Promise<string>{
 // Store only a fixed-size digest, never a whole imported document in the retry map.
 const bytes=new TextEncoder().encode(text);
 if(crypto.subtle){const digest=await crypto.subtle.digest('SHA-256',bytes);return Array.from(new Uint8Array(digest),b=>b.toString(16).padStart(2,'0')).join('')}
 // HTTP on a private LAN has no SubtleCrypto. This bounded lookup key is not
 // an authentication hash; the server still compares the full SHA-256 payload.
 const parts=[2166136261,2246822519,3266489917,668265263];
 for(const b of bytes)for(let i=0;i<parts.length;i++)parts[i]=Math.imul(parts[i]^b,16777619+i*2)>>>0;
 return bytes.length+':'+parts.map(n=>n.toString(16).padStart(8,'0')).join('');
}
async function request(path:string,method:string,body:unknown,options:RequestOptions={},download=false):Promise<any>{
 let operationKey='';
 if(body&&!(body instanceof FormData)&&typeof body==='object'&&'request_id' in body){
  const {request_id,...payload}=body as Record<string,unknown>;
  operationKey=await fingerprint(method+path+JSON.stringify(payload));
  if(!pendingMutations.has(operationKey)&&pendingMutations.size>=256)throw new ApiError('待核对的失败操作过多。请先刷新列表确认结果，再重新打开页面继续；不会自动重复提交。',409);
  const stableId=pendingMutations.get(operationKey)||String(request_id);
  pendingMutations.set(operationKey,stableId);body={...payload,request_id:stableId};
 }
 const controller=new AbortController();let timedOut=false;
 const abort=()=>controller.abort();
 if(options.signal?.aborted)abort();else options.signal?.addEventListener('abort',abort,{once:true});
 const timer=setTimeout(()=>{timedOut=true;controller.abort()},options.timeoutMs??(method==='GET'?20000:120000));
 try{
  const token=sessionStorage.getItem('demo-token');
  const res=await fetch('/api'+path,{method,signal:controller.signal,headers:{...(body&&!(body instanceof FormData)?{'Content-Type':'application/json'}:{}),...(token?{'X-Demo-Token':token}:{})},body:body instanceof FormData?body:body?JSON.stringify(body):undefined});
  if(download&&res.ok)return await res.blob();
  const raw=await res.text();let data:any;
  try{data=raw?JSON.parse(raw):null}catch{throw new ApiError(`服务返回了无法读取的响应（HTTP ${res.status}）。请刷新列表核对结果后重试。`,res.status||502)}
  if(!res.ok){
   // A definitive validation/auth failure was not executed. Ambiguous transport
   // and 5xx responses retain their idempotency key for a safe retry.
   if(operationKey&&[400,401,403,404,413,415,422].includes(res.status))pendingMutations.delete(operationKey);
   throw new ApiError(typeof data?.detail==='string'?data.detail:`请求未成功（HTTP ${res.status}），请核对后重试。`,res.status);
  }
  if(operationKey)pendingMutations.delete(operationKey);return data;
 }catch(error){
  if(error instanceof ApiError)throw error;
  if(controller.signal.aborted)throw new ApiError(timedOut?'请求等待超时。服务器可能仍在处理，请先刷新结果；再次尝试会沿用本次请求标识。':'已停止等待响应。已提交的服务器操作不会因此撤销，请刷新结果核对。',timedOut?504:499);
  throw new ApiError('无法连接服务。请检查本机服务与网络，恢复后先刷新列表核对结果。',0);
 }finally{clearTimeout(timer);options.signal?.removeEventListener('abort',abort)}
}
export async function api<T=unknown>(path:string,method='GET',body?:unknown,options:RequestOptions={}):Promise<T>{return request(path,method,body,options)}
export async function downloadApi(path:string,filename:string){
 const blob:Blob=await request(path,'GET',undefined,{},true);const url=URL.createObjectURL(blob);
 const anchor=document.createElement('a');anchor.href=url;anchor.download=filename;anchor.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
}
export const money=(n:number|null|undefined)=>n==null?'—':'¥'+n.toLocaleString('zh-CN',{maximumFractionDigits:2,minimumFractionDigits:2});
export const number=(n:number|null|undefined)=>n==null?'—':n.toLocaleString('zh-CN',{maximumFractionDigits:2});
export const date=(s:string)=>!s?'—':Number.isNaN(Date.parse(s))?s:new Date(s).toLocaleString('zh-CN',{month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit'});
