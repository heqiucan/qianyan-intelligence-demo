import { useState } from 'react';
import { ArrowRight, Sparkles } from 'lucide-react';
import { money, type Campaign, type Product } from '../../api';
import { Badge, Button, Field, Modal } from '../../components/ui';

export interface GenerationSettings { recipe: string; tone: string; angle: string }

interface Props {
  campaign?: Campaign; latestProduct: Product; settings: GenerationSettings;
  change: (settings: GenerationSettings) => void; busy: boolean; modelLabel: string;
  generate: () => void; useLatestProduct: () => void; openProduct: () => void;
}

export default function GenerationPanel({ campaign, latestProduct, settings, change, busy, modelLabel, generate, useLatestProduct, openProduct }: Props) {
  const [chooseProduct, setChooseProduct] = useState(false);
  const product = campaign?.product_snapshot;
  const productChanged = product && (product.id !== latestProduct.id || product.version !== latestProduct.version);
  const generateCurrent = () => { setChooseProduct(false); generate(); };
  const startLatest = () => { setChooseProduct(false); useLatestProduct(); };

  return <section id="creative-generation" className="studio-generation" aria-label="创意生成设置">
    <div className="studio-panel-title"><h3>生成设置</h3><Badge tone="neutral">{modelLabel || '演示回放'}</Badge></div>
    <p>本次商品：{product ? `${product.name} · 资料 V${product.version} · ${money(product.price)}` : '未选择活动'}</p>
    <p className="studio-help">受众：{campaign?.audience || '待补充'} · 主推卖点：{campaign?.selling_point || '待补充'}</p>
    {productChanged && <div className="notice product-basis-notice" role="status" aria-label="生成商品与最新资料不同">
      <strong>活动保留原商品快照</strong>
      <p>最新商品：{latestProduct.name} · V{latestProduct.version} · {money(latestProduct.price)}。使用最新资料需创建新活动。</p>
      <Button disabled={busy} onClick={startLatest}>使用最新商品创建活动<ArrowRight size={14}/></Button>
    </div>}
    <div className="studio-generation-fields">
      <Field label="文案结构"><select disabled={busy} value={settings.recipe} onChange={event => change({ ...settings, recipe: event.target.value })}>
        <option value="spec">规格与价格说明</option><option value="questions">问答与选择提示</option><option value="walkthrough">顺序讲解与收尾</option><option value="classic">原通勤与容量示例</option>
      </select></Field>
      <Field label="表达语气"><select disabled={busy} value={settings.tone} onChange={event => change({ ...settings, tone: event.target.value })}><option>自然</option><option>简洁</option></select></Field>
      <Field label="表达角度"><select disabled={busy} value={settings.angle} onChange={event => change({ ...settings, angle: event.target.value })}><option>场景</option><option>规格</option></select></Field>
      <Button kind="primary" disabled={busy || !campaign} onClick={() => productChanged ? setChooseProduct(true) : generateCurrent()}><Sparkles size={15}/>生成两组创意</Button>
    </div>
    <p className="studio-mode-note">{modelLabel.includes('回放') || !modelLabel ? '有限模板回放。' : '生成来源以素材记录为准。'}事实核对由服务端规则执行，不保证全面合规或平台过审。</p>
    <Button kind="ghost" onClick={openProduct}>查看商品资料<ArrowRight size={14}/></Button>
    {chooseProduct && product && <Modal title="选择生成商品" busy={busy} onClose={() => setChooseProduct(false)}>
      <p>活动商品：{product.name} · V{product.version}</p>
      <p>最新商品：{latestProduct.name} · V{latestProduct.version}</p>
      <div className="modal-footer"><Button disabled={busy} onClick={generateCurrent}>使用活动原商品生成</Button><Button kind="primary" disabled={busy} onClick={startLatest}>使用最新商品创建活动</Button></div>
    </Modal>}
  </section>;
}
