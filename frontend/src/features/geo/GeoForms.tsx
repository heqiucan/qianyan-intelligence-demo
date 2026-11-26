import { useEffect, useState, type FormEvent, type ReactNode } from 'react';
import { ArrowLeft, Check, Download, Save, ShieldCheck } from 'lucide-react';
import { Field, Modal } from '../../components/ui';
import { exportText, type Draft } from './model';

export function EntryForm({
  kind,
  close,
  save,
  dirtyChanged,
}: {
  kind: 'project' | 'question' | 'source';
  close: () => void;
  save: (data: FormData) => void;
  dirtyChanged: (dirty: boolean) => void;
}) {
  const [dirty, setDirty] = useState(false);

  useEffect(() => {
    dirtyChanged(dirty);
    return () => dirtyChanged(false);
  }, [dirty, dirtyChanged]);

  const cancel = () => {
    if (!dirty || confirm('放弃尚未保存的内容？')) {
      dirtyChanged(false);
      close();
    }
  };

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    if (!String(data.get('title') || '').trim()) return;
    save(data);
  };

  return (
    <Modal title={{ project: '新建 GEO 项目', question: '添加目标问题', source: '添加品牌资料' }[kind]} onClose={cancel}>
      <form className="geo-form" onSubmit={submit} onChange={() => setDirty(true)}>
        <Field label={{ project: '项目名称', question: '问题内容', source: '资料标题' }[kind]}>
          <input name="title" required maxLength={180} />
        </Field>
        {kind === 'project' && <Field label="品牌名称"><input name="brand" required maxLength={80} /></Field>}
        {kind === 'question' && <>
          <Field label="问题意图">
            <select name="intent">
              {['品类发现', '商品核实', '能力核实', '方案比较', '购买决策'].map(value => <option key={value}>{value}</option>)}
            </select>
          </Field>
          <Field label="优先级">
            <select name="priority">{['高', '中', '低'].map(value => <option key={value}>{value}</option>)}</select>
          </Field>
        </>}
        {kind === 'source' && <>
          <Field label="资料类型">
            <select name="kind">{['产品文档', '品牌资料', 'FAQ', '公开信源'].map(value => <option key={value}>{value}</option>)}</select>
          </Field>
          <Field label="事实内容与来源">
            <textarea name="text" required rows={6} maxLength={6000} />
          </Field>
        </>}
        <div className="geo-actions">
          <button type="button" className="button" onClick={cancel}>取消</button>
          <button className="button primary"><Check size={16} />保存</button>
        </div>
      </form>
    </Modal>
  );
}

export function DetailDialog({ title, close, children }: { title: string; close: () => void; children: ReactNode }) {
  return <Modal title={title} onClose={close} wide><div className="geo-detail">{children}</div></Modal>;
}

export function DraftEditor({
  draft,
  save,
  close,
  dirtyChanged,
}: {
  draft: Draft;
  save: (draft: Draft) => void;
  close: () => void;
  dirtyChanged: (dirty: boolean) => void;
}) {
  const [body, setBody] = useState(draft.body);
  const [url, setUrl] = useState(draft.url);
  const [error, setError] = useState('');
  const dirty = body !== draft.body || url !== draft.url;

  useEffect(() => {
    dirtyChanged(dirty);
    return () => dirtyChanged(false);
  }, [dirty, dirtyChanged]);

  const cancel = () => {
    if (!dirty || confirm('放弃尚未保存的草稿修改？')) {
      dirtyChanged(false);
      close();
    }
  };

  const persist = () => {
    save({
      ...draft,
      body,
      url: draft.url,
      status: body !== draft.body ? 'draft' : draft.status,
    });
    setUrl(draft.url);
  };

  const review = () => {
    save({ ...draft, body, url: draft.url, status: 'approved' });
    setError('');
  };

  const register = () => {
    try {
      const parsed = new URL(url);
      if (!['http:', 'https:'].includes(parsed.protocol)) throw new Error();
    } catch {
      setError('请输入完整的 http 或 https 发布地址。');
      return;
    }
    save({ ...draft, body, url, status: 'recorded' });
    setError('');
  };

  const snapshots = draft.sourceSnapshots || [];
  const exportDraft = () => {
    const sources = snapshots.length
      ? snapshots.map(source => `### ${source.title}\n${source.text}`).join('\n\n')
      : draft.sources.join('\n');
    const sourceHeading = draft.sourceSnapshots ? '资料快照' : '资料标题记录（旧版未保存正文快照）';
    exportText('GEO-内容草稿.md', `样例内容 · 未自动发布\n\n${body}\n\n## ${sourceHeading}\n${sources || '无已保存资料'}`);
  };

  return (
    <article className="geo-content-detail" aria-labelledby="geo-content-detail-heading">
      <div className="geo-detail-toolbar">
        <button className="geo-link" onClick={cancel}><ArrowLeft size={16} />返回内容管理</button>
        <span className={'geo-status ' + (draft.status === 'draft' ? 'warn' : 'good')}>
          {({ draft: '待审核', approved: '已审核', recorded: '已登记' } as Record<string, string>)[draft.status]}
        </span>
      </div>
      <header className="geo-content-heading">
        <div>
          <p className="geo-eyebrow">内容详情 · 本地草稿</p>
          <h2 id="geo-content-detail-heading">{draft.title}</h2>
          <p className="geo-muted">当前内容只保存于浏览器；审核与登记不代表已发布或已被外部平台收录。</p>
        </div>
        <div className="geo-actions">
          <button className="button" disabled={!body.trim() || body === draft.body} onClick={persist}>
            <Save size={15} />保存修改
          </button>
          <button
            className="button primary"
            disabled={dirty || !body.trim() || draft.status !== 'draft'}
            onClick={review}
          >
            <ShieldCheck size={15} />{draft.status === 'draft' ? '审核通过' : '已审核'}
          </button>
          <button className="button" disabled={dirty} onClick={exportDraft}><Download size={15} />导出草稿</button>
        </div>
      </header>
      <div className="geo-content-editor-grid">
        <section className="geo-content-editor">
          <Field label="内容草稿">
            <textarea
              rows={22}
              value={body}
              maxLength={12000}
              onChange={event => setBody(event.target.value)}
            />
          </Field>
          {draft.status !== 'draft' && <section className="geo-publish-register">
            <Field label="已发布内容地址">
              <input type="url" value={url} onChange={event => setUrl(event.target.value)} placeholder="https://" />
            </Field>
            <button className="button" disabled={body !== draft.body || !url.trim()} onClick={register}>
              <Check size={15} />登记发布地址
            </button>
            <p className="geo-muted">仅保存地址，不对外发布、不验证收录。</p>
            {draft.status === 'recorded' && <p className="geo-status good">已登记 · 等待复测</p>}
            {error && <p role="alert">{error}</p>}
          </section>}
        </section>
        <aside className="geo-source-snapshots" aria-labelledby="geo-source-snapshot-heading">
          <div className="geo-section-head">
            <div>
              <h3 id="geo-source-snapshot-heading">资料快照</h3>
              <p className="geo-muted">内容生成时保存的已审核资料</p>
            </div>
            <span className="geo-status">{snapshots.length || draft.sources.length} 份</span>
          </div>
          {snapshots.length ? snapshots.map(source => <article key={source.id} className="geo-source-snapshot">
            <strong>{source.title}</strong>
            <span className="geo-muted">{source.kind} · 生成时已审核</span>
            <p>{source.text}</p>
          </article>) : draft.sourceSnapshots ? <p className="geo-muted">生成时没有已审核资料。</p> : <>
            <p className="geo-muted">旧 v1 草稿只保留资料标题，没有可恢复的正文快照。</p>
            <ul>{draft.sources.map((title, index) => <li key={`${index}-${title}`}>{title}</li>)}</ul>
          </>}
        </aside>
      </div>
    </article>
  );
}
