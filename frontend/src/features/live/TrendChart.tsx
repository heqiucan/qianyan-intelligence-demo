import { useId } from 'react';
import { money, type Analytics } from '../../api';
import { Badge, Table } from '../../components/ui';

export default function TrendChart({analytics:a}:{analytics:Analytics}){
 const id=useId(),points=a.trend?.points||[],values=points.map(p=>p.revenue),max=Math.max(...values,1);
 const dates=points.map(p=>Date.parse(p.date+'T00:00:00Z')),span=dates.length>1?dates[dates.length-1]-dates[0]:0;
 const x=(i:number)=>span?64+(dates[i]-dates[0])*620/span:360,y=(v:number)=>196-v/max*150;
 return <section className="panel live-trend" aria-label="成交与消耗趋势"><div className="panel-header"><h3>成交与消耗趋势</h3><Badge tone="neutral">{a.label}</Badge></div>
 {points.length?<><svg viewBox="0 0 740 250" role="img" aria-labelledby={id}><title id={id}>按 UTC 日期汇总的模拟支付金额，单位元</title>{[0,.5,1].map(r=><g key={r}><line x1="64" x2="684" y1={y(max*r)} y2={y(max*r)} stroke="#393344" strokeDasharray="4 4"/><text x="54" y={y(max*r)+5} textAnchor="end" fill="#c9c1d6" fontSize="14">{Math.round(max*r)}</text></g>)}{points.length>1&&<polyline points={points.map((p,i)=>`${x(i)},${y(p.revenue)}`).join(' ')} fill="none" stroke="#c4a7ff" strokeWidth="3"/>}{points.map((p,i)=><g key={p.date}><circle cx={x(i)} cy={y(p.revenue)} r="5" fill="#c4a7ff" tabIndex={0}><title>{`${p.date}：模拟支付 ${money(p.revenue)}，${p.orders} 笔订单`}</title></circle>{(points.length<6||i===0||i===points.length-1)&&<text x={x(i)} y="228" textAnchor="middle" fontSize="14" fill="#c9c1d6">{p.date.slice(5)}</text>}</g>)}</svg><p className="muted">紫色：模拟支付金额（元）{points.length===1?' · 当前仅一个有记录的日期，单点不代表增长趋势。':''}</p><details><summary>查看趋势数据表</summary><Table headers={['UTC 日期','模拟支付金额','订单','广告消耗']}>{points.map(p=><tr key={p.date}><td>{p.date}</td><td>{money(p.revenue)}</td><td>{p.orders}</td><td>未提供</td></tr>)}</Table></details></>:<p className="live-chart-empty">{a.dataset==='session'?'还没有模拟订单，完成体验购买后会出现有日期依据的数据点。':'此来源没有逐时或逐日明细，暂不绘制时间趋势。'}</p>}
 <p className="muted">{a.trend?.note}</p>
 {a.dataset!=='session'&&a.rows.length>0&&<div className="live-comparison"><h4>同一来源 · 计划金额对比</h4>{a.rows.map(r=>{const top=Math.max(...a.rows.flatMap(x=>[x.revenue,x.spend||0]),1);return <div key={r.plan_id||r.name}><strong>{r.name}</strong><div className="live-bar-row"><span>模拟消耗</span><div><i style={{width:`${(r.spend||0)/top*100}%`,background:'#efbc75'}}/></div><b>{money(r.spend)}</b></div><div className="live-bar-row"><span>模拟支付</span><div><i style={{width:`${r.revenue/top*100}%`}}/></div><b>{money(r.revenue)}</b></div></div>})}</div>}
 </section>
}
