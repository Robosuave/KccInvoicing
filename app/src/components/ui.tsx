import { useEffect, useRef, type ButtonHTMLAttributes, type InputHTMLAttributes, type ReactNode, type SelectHTMLAttributes, type TextareaHTMLAttributes } from 'react';

/* ---------- buttons ---------- */

type BtnProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: 'primary' | 'secondary' | 'danger' | 'ghost';
  size?: 'md' | 'sm';
};

export function Button({ variant = 'primary', size = 'md', className = '', ...rest }: BtnProps) {
  return (
    <button
      className={`btn btn-${variant} ${size === 'sm' ? 'btn-sm' : ''} ${className}`}
      {...rest}
    />
  );
}

/* ---------- fields ---------- */

interface FieldProps {
  label: string;
  hint?: string;
  error?: string;
  children: ReactNode;
  htmlFor?: string;
}

export function Field({ label, hint, error, children, htmlFor }: FieldProps) {
  return (
    <div className="field">
      <label htmlFor={htmlFor}>{label}</label>
      {children}
      {hint && !error && <div className="hint">{hint}</div>}
      {error && (
        <div className="error-text" role="alert">
          {error}
        </div>
      )}
    </div>
  );
}

export function TextField(props: InputHTMLAttributes<HTMLInputElement> & { error?: string }) {
  const { error, ...rest } = props;
  return <input className="input" aria-invalid={error ? true : undefined} {...rest} />;
}

export function TextArea(props: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea className="input" {...props} />;
}

export function SelectField(props: SelectHTMLAttributes<HTMLSelectElement>) {
  return <select className="input" {...props} />;
}

/* ---------- modal ---------- */

export function Modal({
  title,
  children,
  onClose,
}: {
  title: string;
  children: ReactNode;
  onClose: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  // Keep the latest onClose in a ref so the mount-only effect below never
  // re-runs (and never yanks focus back to the first field) when the parent
  // re-renders with a new inline onClose callback — e.g. on every keystroke.
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onCloseRef.current();
    };
    document.addEventListener('keydown', onKey);
    ref.current?.querySelector<HTMLElement>('button, input, select, textarea')?.focus();
    return () => document.removeEventListener('keydown', onKey);
  }, []);

  return (
    <div
      className="modal-backdrop"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="modal" role="dialog" aria-modal="true" aria-label={title} ref={ref}>
        <h2>{title}</h2>
        {children}
      </div>
    </div>
  );
}

/* ---------- misc ---------- */

export function EmptyState({
  title,
  body,
  action,
}: {
  title: string;
  body: string;
  action?: ReactNode;
}) {
  return (
    <div className="empty-state">
      <h3>{title}</h3>
      <p>{body}</p>
      {action && <div style={{ marginTop: 16 }}>{action}</div>}
    </div>
  );
}

export function Alert({
  kind,
  children,
}: {
  kind: 'error' | 'warning' | 'info' | 'success';
  children: ReactNode;
}) {
  return (
    <div className={`alert alert-${kind}`} role={kind === 'error' ? 'alert' : 'status'}>
      {children}
    </div>
  );
}

/** Truthful setup-required state. Never implies saving works. */
export function SetupRequired({ what }: { what: string }) {
  return (
    <div className="setup-panel">
      <h2>Backend setup required</h2>
      <p>
        {what} needs a connected database before it can save anything. Nothing you enter here
        will be stored until setup is complete.
      </p>
      <ol>
        <li>Create a free Supabase project at supabase.com</li>
        <li>Run the SQL in <code>supabase/migrations/0001_phase1.sql</code> in the SQL editor</li>
        <li>
          Copy <code>.env.example</code> to <code>.env</code> and fill in{' '}
          <code>VITE_SUPABASE_URL</code> and <code>VITE_SUPABASE_ANON_KEY</code>
        </li>
        <li>Restart the app and sign up for the owner account</li>
      </ol>
      <p style={{ fontSize: 13, color: 'var(--muted)' }}>
        Full instructions are in <code>SETUP.md</code>.
      </p>
    </div>
  );
}

export type SaveStatus = 'idle' | 'saving' | 'saved' | 'failed';

export function SaveStatusIndicator({ status, message }: { status: SaveStatus; message?: string }) {
  if (status === 'idle') return null;
  const label =
    message ?? (status === 'saving' ? 'Saving…' : status === 'saved' ? 'All changes saved' : 'Save failed');
  return (
    <span className={`save-status ${status}`} role="status" aria-live="polite">
      <span className="dot" aria-hidden="true" />
      {label}
    </span>
  );
}

export function Stat({ label, value, note }: { label: string; value: string; note?: string }) {
  return (
    <div className="stat">
      <div className="label">{label}</div>
      <div className="value">{value}</div>
      {note && <div className="note">{note}</div>}
    </div>
  );
}
