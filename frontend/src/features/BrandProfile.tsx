import { ArrowRight } from 'lucide-react';
import type { Product } from '../api';
import { Button } from '../components/ui';

export default function BrandProfile({ product, go }: { product: Product; go: (route: string) => void }) {
  return <section className="workspace-detail">
    <div className="workspace-detail-heading"><h2>{product.brand}</h2><Button onClick={() => go('product')}>编辑品牌与商品资料<ArrowRight size={15}/></Button></div>
    <dl className="workspace-facts"><dt>当前商品</dt><dd>{product.name}</dd><dt>已知描述</dt><dd>{product.description}</dd><dt>资料来源</dt><dd>{product.evidence || '尚未提供'}</dd><dt>宣传边界</dt><dd>{product.restrictions}</dd></dl>
    <Button kind="ghost" onClick={() => go('product?tab=knowledge')}>查看知识资料<ArrowRight size={15}/></Button>
  </section>;
}
