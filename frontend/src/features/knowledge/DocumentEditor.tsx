import { useState } from 'react';
import { Upload, FileText } from 'lucide-react';
import { api, requestId } from '../../api';
import { Button, Field, Modal, Submit } from '../../components/ui';
import { kindLabels, type Document, type TextPage } from './types';

export default function DocumentEditor({ spaceId, document, saved, close }: {
  spaceId: string; document: Document | null; saved: () => Promise<void>; close: () => void;
}) {
  const [title, setTitle] = useState(document?.title || '');
  const [kind, setKind] = useState(document?.kind || 'facts');
  const [channel, setChannel] = useState(document?.channel || 'internal');
  const [from, setFrom] = useState(document?.valid_from || '');
  const [until, setUntil] = useState(document?.valid_until || '');
  const [pages, setPages] = useState<TextPage[]>(document?.pages || [{ page: null, text: '' }]);
  const [filename, setFilename] = useState(document?.filename || '粘贴文本');
  const [warning, setWarning] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [changed, setChanged] = useState(false);
  const mark = () => setChanged(true);
  const closeEditor = () => { if (!changed || confirm('资料尚未保存，确定放弃这次修改？')) close(); };
  const upload = async (file?: File) => {
    if (!file) return;
    if (file.size > 5 * 1024 * 1024) { setError('文件不能超过 5 MB。'); return; }
    setBusy(true); setError('');
    try {
      const data = new FormData(); data.set('file', file);
      const result = await api<{ pages: TextPage[]; filename: string; warning: string }>('/knowledge/extract', 'POST', data);
      setPages(result.pages); setFilename(result.filename); setWarning(result.warning);
      if (!title) setTitle(file.name.replace(/\.[^.]+$/, '').slice(0, 120));
      mark();
    } catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  };
  const save = async () => {
    setBusy(true); setError('');
    try {
      await api('/knowledge/documents' + (document ? '/' + document.id : ''), document ? 'PUT' : 'POST', {
        request_id: requestId(), expected_version: document?.version ?? null, space_id: spaceId,
        title, kind, channel, valid_from: from || null, valid_until: until || null, pages, filename,
      });
      await saved(); close();
    } catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  };
  return <Modal title={document ? `更新资料 · V${document.version + 1}` : '导入知识资料'} wide onClose={closeEditor} busy={busy} error={error}>
    <form onSubmit={e => { e.preventDefault(); save(); }}>
      <div className="kb-import-note"><FileText size={20}/><p>事实资料审核后进入知识检索。关键词、评论和问题请选“需求素材”，在需求素材与词库中分析，不作为事实依据。</p></div>
      <div className="form-grid">
        <Field label="资料标题" full><input required maxLength={120} value={title} onChange={e => { setTitle(e.target.value); mark(); }}/></Field>
        <Field label="资料类型"><select value={kind} onChange={e => { setKind(e.target.value as Document['kind']); mark(); }}>{Object.entries(kindLabels).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></Field>
        <Field label="适用范围"><select value={channel} onChange={e => { setChannel(e.target.value as Document['channel']); mark(); }}><option value="internal">内部参考</option><option value="douyin">抖音渠道参考</option></select></Field>
        <Field label="生效日期（UTC，可留空）"><input type="date" value={from} onChange={e => { setFrom(e.target.value); mark(); }}/></Field>
        <Field label="失效日期（UTC，可留空）"><input type="date" value={until} min={from || undefined} onChange={e => { setUntil(e.target.value); mark(); }}/></Field>
      </div>
      <label className="button secondary kb-upload"><Upload size={15}/>{busy ? '正在处理…' : '选择 TXT / MD / PDF'}<input type="file" accept=".txt,.md,.pdf" disabled={busy} onChange={e => { upload(e.target.files?.[0]); e.target.value = ''; }}/></label>
      <p className="muted">{filename} · 单文件 5 MB / 50 页 / 12 万字以内。文本解析在本机完成，不支持扫描件 OCR。</p>
      {warning && <div className="notice">{warning}</div>}
      <div className="kb-page-editor">{pages.map((p, i) => <Field label={p.page ? `第 ${p.page} 页解析预览` : '正文（可直接粘贴）'} key={i}>
        <textarea rows={Math.min(10, Math.max(4, p.text.split('\n').length))} maxLength={120000} value={p.text} onChange={e => { setPages(list => list.map((x, n) => n === i ? { ...x, text: e.target.value } : x)); mark(); }}/>
      </Field>)}</div>
      {kind === 'demand' && <div className="notice">此版本不进入事实检索。保存后可在“商品与品牌 → 需求素材与词库”选择“复制为需求素材”，保留原文和版本定位。若之前用它生成过草稿，旧草稿会提示来源已变化。</div>}
      <div className="notice">历史脚本只作表达结构参考；资料标记为可用不代表广告审核通过。更新后旧草稿仍保留原引用，新版本需要重新审核。</div>
      <div className="modal-footer"><Button onClick={closeEditor} disabled={busy}>取消</Button><Submit busy={busy}>保存资料，进入审核</Submit></div>
    </form>
  </Modal>;
}
