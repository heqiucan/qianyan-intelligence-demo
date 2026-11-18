import {useEffect,useId,useState} from 'react';
import {Field} from '../../components/ui';
import {words,type Filters} from './types';
export function WordInput({label,value,onChange}:{label:string;value:string[];onChange:(v:string[])=>void}){
 const hintId=useId();const invalid=value.length>30||value.some(v=>v.length>60);
 const [raw,setRaw]=useState(value.join('，'));const canonical=value.join('\n');
 useEffect(()=>{setRaw(previous=>words(previous).join('\n')===canonical?previous:value.join('，'))},[canonical]);
 return <div><Field label={label}><textarea rows={2} value={raw} aria-invalid={invalid} aria-describedby={hintId} placeholder="用逗号或换行分隔" onChange={e=>{setRaw(e.target.value);onChange(words(e.target.value))}}/></Field><small id={hintId} className={invalid?'demand-flag':'muted'}>{value.length} / 30 个词 · 每词最多 60 字{invalid?'；请删减超限内容后保存或预览':''}</small></div>
}
export default function FilterEditor({value,onChange}:{value:Filters;onChange:(v:Filters)=>void}){
 const update=(patch:Partial<Filters>)=>onChange({...value,...patch});
 return <div className="demand-form-grid">
  <WordInput label="主题词（留空表示不限主题）" value={value.theme_terms} onChange={v=>update({theme_terms:v})}/><WordInput label="意图词（填写后须至少命中一个）" value={value.intent_terms} onChange={v=>update({intent_terms:v})}/><WordInput label="排除词（命中后优先排除）" value={value.exclude_terms} onChange={v=>update({exclude_terms:v})}/>
  <Field label="主题匹配方式"><select value={value.match_mode} onChange={e=>update({match_mode:e.target.value as Filters['match_mode']})}><option value="any">任一主题词</option><option value="all">全部主题词</option></select></Field>
  <Field label="日期开始"><input type="date" value={value.date_from||''} max={value.date_to||undefined} onChange={e=>update({date_from:e.target.value||null})}/></Field><Field label="日期结束"><input type="date" value={value.date_to||''} min={value.date_from||undefined} onChange={e=>update({date_to:e.target.value||null})}/></Field>
  <Field label="缺少日期的记录"><select value={value.missing_time} onChange={e=>update({missing_time:e.target.value as Filters['missing_time']})}><option value="review">保留并标记待核对</option><option value="include">保留</option><option value="exclude">排除</option></select></Field><Field label="排序"><select value={value.sort} onChange={e=>update({sort:e.target.value as Filters['sort']})}><option value="source">原始顺序</option><option value="newest">日期从新到旧</option><option value="oldest">日期从旧到新</option></select></Field><Field label="结果数量上限"><input type="number" min={1} max={2000} value={value.limit} onChange={e=>update({limit:Number(e.target.value)})}/></Field>
  <label className="demand-check"><input type="checkbox" checked={value.dedupe} onChange={e=>update({dedupe:e.target.checked})}/>按规范化文本去重，保留来源</label><label className="demand-check"><input type="checkbox" checked={value.semantic} disabled={value.match_mode==='all'} onChange={e=>update({semantic:e.target.checked})}/>补充语义相近主题（仅“任一主题词”）</label><p className="muted">语义匹配用于发现相近表达；排除条件仍优先生效。分类为辅助提示，不代表真实购买意愿或个人身份。</p>
 </div>
}
