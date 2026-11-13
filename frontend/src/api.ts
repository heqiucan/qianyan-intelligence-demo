import type { KnowledgeOrigin } from './features/journey/CreativeOrigin';
export interface Product {id:string;name:string;price:number;capacity:string;color:string;brand:string;description:string;restrictions:string;version:number;image_url:string;video_url?:string;evidence?:string}
export interface Campaign {id:string;name:string;product_snapshot:Product;created_at:string;audience?:string;selling_point?:string;goal?:string;budget_limit?:number|null;start_date?:string;end_date?:string;strategy_version?:number;strategy_history?:V2Record[]}
export interface Creative {knowledge_origin?:KnowledgeOrigin;id:string;campaign_id:string;direction:string;title:string;body:string;cta:string;script:string;version:number;status:string;source:string;product_snapshot:Product;parent_id?:string;family_id?:string;template?:string;tone?:string;angle?:string;model_name?:string;edited_by?:string}
export interface Plan {id:string;campaign_id:string;creative_id:string;creative_snapshot:Creative;name:string;budget:number;start_date:string;end_date:string;status:string;created_at:string;config_version?:number;config_history?:V2Record[]}
export interface Order {id:string;plan_id:string;creative_id:string;campaign_id:string;buyer_id:string;buyer_type:string;amount:number;created_at:string;quantity?:number;unit_price?:number;plan_config_version?:number}
export interface V2Record {id:string;campaign_id:string;created_at:string;[key:string]:any}
export interface Insight extends V2Record {source:string;facts:string[];hypotheses:string[];missing:string[];recommendation:string;status?:string;analytics_snapshot?:Analytics}
export interface ModelInfo {mode:string;label:string;configured:boolean;live_verified:boolean;model_name?:string|null;free_only:boolean;status:string;pricing_checked_on:string}
export interface State {product:Product;campaigns:Campaign[];creatives:Creative[];plans:Plan[];orders:Order[];events:{id:string;plan_id:string;type:string;created_at:string}[];logs:{id:string;action:string;detail:string;created_at:string}[];insights:Insight[];adjustments:V2Record[];batches:V2Record[];tasks:V2Record[];observations:V2Record[];reports:V2Record[];model:ModelInfo}
export const generationSource=(item:{source?:string;model_name?:string;edited_by?:string})=>(item.source==='model'?(item.model_name?`智谱生成 · ${item.model_name}`:'模型生成 · 历史型号未记录'):item.source==='replay'?'演示回放':item.source==='knowledge'?'已核对知识草稿转入':'来源未记录')+(item.edited_by?' · 人工修订':'');
export interface Metrics {impressions:number|null;clicks:number;spend:number|null;orders:number;buyers:number;new_customers:number;unknown_buyers:number;revenue:number;ctr:number|null;roi:number|null;cpa:number|null;cac:number|null}
export interface Analytics {dataset:string;label:string;note:string;window:string;metrics:Metrics;rows:({name:string;plan_id?:string;creative_id?:string}&Metrics)[];orders:Order[];spend_entries:V2Record[];views?:number;filters?:Record<string,string>}
export const requestId=()=>typeof crypto.randomUUID==='function'?crypto.randomUUID():Array.from(crypto.getRandomValues(new Uint8Array(16)),n=>n.toString(16).padStart(2,'0')).join('');
export class ApiError extends Error{constructor(message:string,public status:number){super(message)}}
const pendingMutations=new Map<string,string>();
export async function api<T=unknown>(path:string,method='GET',body?:unknown):Promise<T>{
 let operationKey='';
 if(body&&!(body instanceof FormData)&&typeof body==='object'&&'request_id' in body){const data=body as Record<string,unknown>;const {request_id,...payload}=data;operationKey=method+path+JSON.stringify(payload);const stableId=pendingMutations.get(operationKey)||String(request_id);pendingMutations.set(operationKey,stableId);body={...payload,request_id:stableId};}
 const token=sessionStorage.getItem('demo-token');const res=await fetch('/api'+path,{method,headers:{...(body&&!(body instanceof FormData)?{'Content-Type':'application/json'}:{}),...(token?{'X-Demo-Token':token}:{})},body:body instanceof FormData?body:body?JSON.stringify(body):undefined});
 const data=await res.json();if(!res.ok)throw new ApiError(typeof data.detail==='string'?data.detail:JSON.stringify(data.detail||'请求失败，请重试'),res.status);if(operationKey)pendingMutations.delete(operationKey);return data;
}
export const money=(n:number|null|undefined)=>n==null?'—':'¥'+n.toLocaleString('zh-CN',{maximumFractionDigits:2,minimumFractionDigits:2});
export const number=(n:number|null|undefined)=>n==null?'—':n.toLocaleString('zh-CN',{maximumFractionDigits:2});
export const date=(s:string)=>!s?'—':Number.isNaN(Date.parse(s))?s:new Date(s).toLocaleString('zh-CN',{month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit'});
