import { useEffect, useState } from 'react';
import { ArrowRight, Plus, Search } from 'lucide-react';
import { api, money, requestId } from '../../api';
import { Badge, Button, Field, Modal, Submit } from '../../components/ui';
import type { Act } from '../../domain';
import type { CatalogProduct, SKU } from './types';
import '../product/product.css';

const blankSku = (): SKU => ({ id: '', label: '', capacity: '', color: '', price: 99, price_source: '', stock: null, stock_source: '' });

interface CatalogProps {
  act: Act;
  busy: boolean;
  dirtyChanged: (dirty: boolean) => void;
  legacy: () => void;
  openMaterials?: (product: CatalogProduct) => void;
}

export default function LiveCatalog({ act, busy, dirtyChanged, legacy, openMaterials }: CatalogProps) {
  const [products, setProducts] = useState<CatalogProduct[]>([]);
  const [error, setError] = useState('');
  const [query, setQuery] = useState('');
  const [editing, setEditing] = useState<CatalogProduct | null | undefined>(undefined);
  const refresh = () => api<CatalogProduct[]>('/live/catalog').then(setProducts).catch(error => setError(error.message));
  useEffect(() => { void refresh(); }, []);
  const visible = products.filter(product => `${product.name} ${product.brand}`.toLowerCase().includes(query.trim().toLowerCase()));

  return <section className="product-catalog">
    <header className="catalog-toolbar"><h2>商品目录 <small className="muted">{products.length} 件商品</small></h2><div className="row-actions"><label className="geo-search"><Search size={16}/><input aria-label="搜索商品" placeholder="搜索商品或品牌" value={query} onChange={event => setQuery(event.target.value)}/></label><Button kind="primary" onClick={() => setEditing(null)}><Plus size={16}/>新增商品</Button></div></header>
    {error && <p role="alert">{error}<Button onClick={() => void refresh()}>重试</Button></p>}
    <div className="catalog-list">{visible.map(product => <article className="catalog-row" key={product.id}>
      <img src={product.image_url} alt={product.name}/>
      <div><h3>{product.name}</h3><p>{product.brand} · {product.skus.length} 个规格</p><p>{product.skus.map(sku => sku.label).join(' / ')}</p><Badge tone="neutral">资料 V{product.version}</Badge></div>
      <div className="catalog-price">{money(product.skus[0]?.price ?? product.price)}<small>{product.image_url.startsWith('/uploads/') ? '已上传商品图片' : '初始样例'}</small></div>
      <div className="row-actions"><Button onClick={() => product.legacy ? legacy() : setEditing(product)}>查看与编辑商品<ArrowRight size={14}/></Button>{openMaterials && <Button kind="ghost" onClick={() => openMaterials(product)}>关联素材</Button>}</div>
    </article>)}</div>
    {!visible.length && <p className="empty-state">{products.length ? '没有匹配的商品。' : '还没有商品资料。'}</p>}
    {editing !== undefined && <CatalogEditor key={editing?.id || 'new'} product={editing} close={() => { setEditing(undefined); dirtyChanged(false); }} busy={busy} dirtyChanged={dirtyChanged} save={async body => {
      const ok = await act(async () => { await api('/live/catalog' + (editing ? '/' + editing.id : ''), editing ? 'PUT' : 'POST', body); await refresh(); }, '商品与 SKU 已保存');
      if (ok) { setEditing(undefined); dirtyChanged(false); }
      return ok;
    }}/>}
  </section>;
}
function CatalogEditor({product,close,save,busy,dirtyChanged}:{product:CatalogProduct|null;close:()=>void;save:(b:unknown)=>Promise<boolean>;busy:boolean;dirtyChanged:(v:boolean)=>void}){
 const [skus,setSkus]=useState<SKU[]>(product?.skus||[blankSku()]),[error,setError]=useState(''),[changed,setChanged]=useState(false);
 useEffect(()=>{dirtyChanged(changed);return()=>dirtyChanged(false)},[changed,dirtyChanged]);
 const sku=(i:number,k:keyof SKU,v:string|number|null)=>{setSkus(ss=>ss.map((s,j)=>j===i?{...s,[k]:v}:s));setChanged(true)};
 return <Modal title={product?'编辑商品与 SKU':'新增直播商品'} wide busy={busy} error={error} onClose={()=>{if(!changed||confirm('放弃未保存的商品信息？'))close()}}><form onChange={()=>setChanged(true)} onSubmit={async e=>{e.preventDefault();setError('');const f=Object.fromEntries(new FormData(e.currentTarget));const ok=await save({...f,skus,price:skus[0].price,capacity:skus[0].capacity,color:skus[0].color,image_url:product?.image_url||'/assets/catalog-placeholder.svg',video_url:product?.video_url||'',expected_version:product?.version,request_id:requestId()});if(!ok)setError('保存失败，输入已保留。请查看页面错误并重试。')}}>
 <div className="form-grid"><Field label="商品名称"><input name="name" defaultValue={product?.name} required maxLength={100}/></Field><Field label="商品品牌"><input name="brand" defaultValue={product?.brand} required maxLength={100}/></Field><Field label="已知商品事实" full><textarea name="description" defaultValue={product?.description} maxLength={6000} required rows={3}/></Field><Field label="商品资料来源" full><textarea name="evidence" defaultValue={product?.evidence} required maxLength={4000} placeholder="填写出处；虚构测试商品请明确写出演示设定"/></Field><Field label="宣传限制" full><textarea name="restrictions" defaultValue={product?.restrictions||'不编造性能、销量、评价与优惠。'} maxLength={4000}/></Field></div>
 {skus.map((s,i)=><fieldset className="live-sku-editor" key={i}><legend>规格 {i+1}</legend><div className="form-grid"><Field label={`SKU ${i+1} 名称`}><input required value={s.label} maxLength={100} onChange={e=>sku(i,'label',e.target.value)}/></Field><Field label={`SKU ${i+1} 价格`}><input type="number" min="0.01" max="1000000" step="0.01" required value={s.price} onChange={e=>sku(i,'price',Number(e.target.value))}/></Field><Field label={`SKU ${i+1} 容量或规格`}><input required maxLength={40} value={s.capacity} onChange={e=>sku(i,'capacity',e.target.value)}/></Field><Field label={`SKU ${i+1} 颜色`}><input required maxLength={40} value={s.color} onChange={e=>sku(i,'color',e.target.value)}/></Field><Field label={`SKU ${i+1} 价格依据`} full><input required maxLength={1000} value={s.price_source} onChange={e=>sku(i,'price_source',e.target.value)}/></Field><Field label={`SKU ${i+1} 参考库存（可空）`}><input type="number" min="0" step="1" value={s.stock??''} onChange={e=>sku(i,'stock',e.target.value===''?null:Number(e.target.value))}/></Field><Field label={`SKU ${i+1} 库存来源`}><input required={s.stock!==null} maxLength={1000} value={s.stock_source} onChange={e=>sku(i,'stock_source',e.target.value)}/></Field></div><Button disabled={skus.length===1||busy} onClick={()=>{setSkus(ss=>ss.filter((_,j)=>j!==i));setChanged(true)}}>移除此未保存规格</Button></fieldset>)}
 <p className="muted">库存为人工参考，不连接平台、不自动扣减；保存时记录更新时间。图片暂用占位图。</p><div className="modal-footer"><Button disabled={skus.length>=30||busy} onClick={()=>{setSkus(ss=>[...ss,blankSku()]);setChanged(true)}}>增加 SKU</Button><Submit busy={busy}>保存商品与规格</Submit></div></form></Modal>
}
