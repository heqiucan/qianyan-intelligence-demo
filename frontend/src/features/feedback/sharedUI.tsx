import { cloneElement, isValidElement, useEffect, useId, useRef, type ReactElement, type ReactNode } from 'react';
import { ListChecks, X } from 'lucide-react';
import { money } from '../../api';
import { keyLabels, statusText, textValue } from './shared';

export function Tag({ status }: { status: string }) {
  const tone = ['resolved', 'reviewed', 'applied', 'accepted'].includes(status) ? 'green'
    : ['pending', 'review', 'waiting_confirmation'].includes(status) ? 'amber' : 'neutral';
  return <span className={`badge ${tone}`}>{statusText[status] || status}</span>;
}

interface ButtonProps {
  children: ReactNode;
  onClick?: () => void;
  disabled?: boolean;
  primary?: boolean;
  type?: 'button' | 'submit';
}

export function Btn({ children, onClick, disabled, primary = false, type = 'button' }: ButtonProps) {
  return (
    <button type={type} className={`button ${primary ? 'primary' : 'secondary'}`} onClick={onClick} disabled={disabled}>
      {children}
    </button>
  );
}

export function Field({ label, children, full = false }: { label: string; children: ReactNode; full?: boolean }) {
  const id = useId();
  const control = isValidElement(children)
    ? cloneElement(children as ReactElement<Record<string, unknown>>, { id, 'aria-labelledby': `${id}-label` })
    : children;
  return <label htmlFor={id} className={`field ${full ? 'full' : ''}`}><span id={`${id}-label`}>{label}</span>{control}</label>;
}

export function Dialog({ title, children, close, busy = false }: {
  title: string; children: ReactNode; close: () => void; busy?: boolean;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  useEffect(() => {
    const dialog = ref.current;
    dialog?.showModal();
    return () => dialog?.close();
  }, []);
  return (
    <dialog
      ref={ref}
      aria-labelledby={titleId}
      className="modal wide feedback-dialog"
      onCancel={event => { event.preventDefault(); if (!busy) close(); }}
      onClick={event => { if (event.target === ref.current && !busy) close(); }}
    >
      <div className="modal-header">
        <h2 id={titleId}>{title}</h2>
        <button type="button" className="button ghost" aria-label="关闭反馈详情" title="关闭" onClick={close} disabled={busy}>
          <X size={19} />
        </button>
      </div>
      <div className="modal-body">{children}</div>
    </dialog>
  );
}

export function Empty({ children }: { children: ReactNode }) {
  return <div className="feedback-empty"><ListChecks size={28} /><p>{children}</p></div>;
}

export function Evidence({ value, depth = 0 }: { value: unknown; depth?: number }) {
  if (value == null) return <span className="muted">未提供</span>;
  if (typeof value !== 'object') return <span>{textValue(value)}</span>;
  if (depth > 3) return <span>{JSON.stringify(value)}</span>;
  if (Array.isArray(value)) {
    return <ul className="feedback-evidence-list">{value.map((item, index) => <li key={index}><Evidence value={item} depth={depth + 1} /></li>)}</ul>;
  }
  return (
    <dl className="feedback-evidence">
      {Object.entries(value).map(([key, item]) => (
        <div key={key}>
          <dt>{keyLabels[key] || key}</dt>
          <dd>{typeof item === 'number' && ['budget', 'spend', 'revenue', 'spend_threshold'].includes(key)
            ? money(item) : <Evidence value={item} depth={depth + 1} />}</dd>
        </div>
      ))}
    </dl>
  );
}
