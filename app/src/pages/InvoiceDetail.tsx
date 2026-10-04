import { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useBusiness } from '../business/BusinessContext';
import { asSnapshot, type InvoiceSnapshot } from '../lib/snapshot';
import { getIssuedInvoice, isOverdue, listRevisionChain, voidInvoice, createRevision } from '../data/invoices';
import { listPayments, recordPayment, reversePayment, newIdempotencyKey } from '../data/payments';
import { listAuditEvents } from '../data/audit';
import { getLogoUrl } from '../data/businesses';
import { downloadIssuedPdf, downloadReceiptPdf, ensureIssuedPdf, renderReceiptPdfBlob, storeReceiptPdf } from '../pdf/service';
import { templateName, type TemplateId } from '../templates/templates';
import { centsToDollars, dollarsToCents } from '../lib/money';
import type { AuditEvent, Invoice, Payment, PaymentMethod } from '../db/types';
import InvoiceDocument from '../components/InvoiceDocument';
import {
  Alert,
  Button,
  EmptyState,
  Field,
  Modal,
  SelectField,
  SetupRequired,
  TextArea,
  TextField,
} from '../components/ui';

const METHOD_LABEL: Record<PaymentMethod, string> = {
  cash: 'Cash',
  check: 'Check',
  bank_transfer: 'Bank transfer',
  other: 'Other',
};

function money(cents: number): string {
  return `$${centsToDollars(cents)}`;
}

export default function InvoiceDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { workspace, notConfigured } = useBusiness();

  const [invoice, setInvoice] = useState<Invoice | null>(null);
  const [snapshot, setSnapshot] = useState<InvoiceSnapshot | null>(null);
  const [payments, setPayments] = useState<Payment[]>([]);
  const [audit, setAudit] = useState<AuditEvent[]>([]);
  const [chain, setChain] = useState<Invoice[]>([]);
  const [logoUrl, setLogoUrl] = useState<string | undefined>();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const [payOpen, setPayOpen] = useState(false);
  const [payAmount, setPayAmount] = useState('');
  const [payMethod, setPayMethod] = useState<PaymentMethod>('bank_transfer');
  const [payRef, setPayRef] = useState('');
  const [payNote, setPayNote] = useState('');
  const [payDate, setPayDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [payError, setPayError] = useState<string | null>(null);

  const [voidOpen, setVoidOpen] = useState(false);
  const [voidReason, setVoidReason] = useState('');
  const [revOpen, setRevOpen] = useState(false);
  const [revReason, setRevReason] = useState('');

  const load = useCallback(async () => {
    if (!id || !workspace) return;
    setLoading(true);
    try {
      const inv = await getIssuedInvoice(id);
      const snap = asSnapshot(inv.snapshot);
      setInvoice(inv);
      setSnapshot(snap);
      const [pays, events, revChain] = await Promise.all([
        listPayments(id),
        listAuditEvents(id),
        listRevisionChain(id),
      ]);
      setPayments(pays);
      setAudit(events);
      setChain(revChain);
      if (snap.business.logo_path) {
        setLogoUrl((await getLogoUrl(snap.business.logo_path)) ?? undefined);
      }
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load invoice.');
    } finally {
      setLoading(false);
    }
  }, [id, workspace]);

  useEffect(() => {
    load();
  }, [load]);

  if (notConfigured) return <SetupRequired what="Invoice details" />;
  if (loading) return <p>Loading invoice…</p>;
  if (error || !invoice || !snapshot) return <Alert kind="error">{error ?? 'Invoice not found.'}</Alert>;
  if (!workspace) return <EmptyState title="No workspace" body="Sign in again." />;

  const balance = invoice.total_cents - invoice.amount_paid_cents;
  const overdue = isOverdue(invoice);
  const template = (snapshot.template_id as TemplateId) || 'classic';

  const doDownloadPdf = async () => {
    setBusy('pdf');
    try {
      await downloadIssuedPdf(invoice, snapshot, workspace.id, template);
    } catch (e) {
      alert(e instanceof Error ? e.message : 'PDF download failed.');
    } finally {
      setBusy(null);
    }
  };

  const doPrint = () => {
    navigate(`/invoices/${invoice.id}/print`);
  };

  const doRecordPayment = async () => {
    setPayError(null);
    let amountCents = 0;
    try {
      amountCents = dollarsToCents(payAmount.trim());
    } catch {
      setPayError('Amount must be a valid dollar figure.');
      return;
    }
    setBusy('pay');
    try {
      const payment = await recordPayment({
        invoice,
        amountCents,
        method: payMethod,
        reference: payRef,
        note: payNote,
        paymentDate: payDate,
        idempotencyKey: newIdempotencyKey(),
      });
      // Generate the receipt from the new balance (non-blocking for the payment itself).
      try {
        const newBalance = invoice.total_cents - (invoice.amount_paid_cents + amountCents);
        const blob = await renderReceiptPdfBlob(snapshot, payment, newBalance);
        await storeReceiptPdf(workspace.id, invoice.business_id, payment, blob);
      } catch {
        /* receipt can be generated from the detail page later */
      }
      setPayOpen(false);
      setPayAmount('');
      setPayRef('');
      setPayNote('');
      await load();
    } catch (e) {
      setPayError(e instanceof Error ? e.message : 'Payment failed.');
    } finally {
      setBusy(null);
    }
  };

  const doReverse = async (p: Payment) => {
    const reason = window.prompt(`Reverse the ${money(p.amount_cents)} payment? Enter a reason:`);
    if (!reason) return;
    setBusy('pay');
    try {
      await reversePayment(p.id, reason);
      await load();
    } catch (e) {
      alert(e instanceof Error ? e.message : 'Reversal failed.');
    } finally {
      setBusy(null);
    }
  };

  const doDownloadReceipt = async (p: Payment) => {
    setBusy('pdf');
    try {
      const balAfter = invoice.total_cents - invoice.amount_paid_cents;
      await downloadReceiptPdf(workspace.id, snapshot, p, balAfter);
    } catch (e) {
      alert(e instanceof Error ? e.message : 'Receipt download failed.');
    } finally {
      setBusy(null);
    }
  };

  const doVoid = async () => {
    setBusy('void');
    try {
      await voidInvoice(invoice.id, voidReason);
      setVoidOpen(false);
      await load();
    } catch (e) {
      alert(e instanceof Error ? e.message : 'Void failed.');
    } finally {
      setBusy(null);
    }
  };

  const doRevision = async () => {
    setBusy('rev');
    try {
      const draftId = await createRevision(invoice.id, revReason);
      setRevOpen(false);
      navigate(`/invoices/${draftId}`);
    } catch (e) {
      alert(e instanceof Error ? e.message : 'Could not start revision.');
    } finally {
      setBusy(null);
    }
  };

  const ensurePdf = async () => {
    // For invoices issued before PDF storage existed (or a failed upload):
    // generating now is safe — it renders the immutable snapshot.
    setBusy('pdf');
    try {
      await ensureIssuedPdf(workspace.id, invoice, snapshot, template);
      await load();
    } catch (e) {
      alert(e instanceof Error ? e.message : 'PDF generation failed.');
    } finally {
      setBusy(null);
    }
  };

  return (
    <div>
      <div className="btn-row no-print" style={{ marginBottom: 16, justifyContent: 'space-between' }}>
        <div>
          <h1 className="page-title" style={{ margin: 0 }}>
            Invoice {invoice.invoice_number}
          </h1>
          <div style={{ display: 'flex', gap: 8, marginTop: 8, flexWrap: 'wrap' }}>
            <span className={`badge badge-${invoice.status === 'void' ? 'void' : 'issued'}`}>{invoice.status.toUpperCase()}</span>
            <span className="badge badge-draft">{invoice.payment_status.replace('_', ' ').toUpperCase()}</span>
            {overdue && <span className="badge badge-draft">OVERDUE</span>}
            {invoice.revision_no > 1 && <span className="badge badge-void">Revision {invoice.revision_no}</span>}
          </div>
        </div>
        <Link className="btn btn-secondary btn-sm" to="/invoices">← All invoices</Link>
      </div>

      {invoice.status === 'void' && (
        <Alert kind="warning">
          Voided{invoice.voided_at ? ` on ${invoice.voided_at.slice(0, 10)}` : ''}.
          {invoice.void_reason ? ` Reason: ${invoice.void_reason}` : ''} The number {invoice.invoice_number} will not be reused.
        </Alert>
      )}

      <div className="card no-print">
        <h2 style={{ marginTop: 0 }}>Output</h2>
        <div className="btn-row">
          <Button size="sm" onClick={doDownloadPdf} disabled={busy === 'pdf'}>
            {busy === 'pdf' ? 'Working…' : 'Download PDF'}
          </Button>
          <Button size="sm" variant="secondary" onClick={doPrint}>Print</Button>
          <Button size="sm" variant="secondary" disabled title="Email arrives in Phase 4">
            Email invoice (Phase 4)
          </Button>
          {!invoice.issued_pdf_path && (
            <Button size="sm" variant="secondary" onClick={ensurePdf}>
              Generate stored PDF
            </Button>
          )}
        </div>
        <p style={{ fontSize: 13, color: 'var(--muted)', marginBottom: 0 }}>
          Template: {templateName(template)}. Downloads always use the privately stored issued
          copy — never a regeneration.
        </p>
      </div>

      <div style={{ marginBottom: 20 }}>
        <InvoiceDocument snapshot={snapshot} template={template} logoUrl={logoUrl} watermark={invoice.status === 'void' ? 'VOID' : undefined} />
      </div>

      <div className="card no-print">
        <div className="btn-row" style={{ justifyContent: 'space-between' }}>
          <h2 style={{ margin: 0 }}>Payments</h2>
          {invoice.status === 'issued' && balance > 0 && (
            <Button size="sm" onClick={() => { setPayAmount((balance / 100).toFixed(2)); setPayOpen(true); }}>
              Record payment
            </Button>
          )}
        </div>
        <div className="totals-box" style={{ margin: '12px 0' }}>
          <div className="totals-row"><span>Total</span><span>{money(invoice.total_cents)}</span></div>
          <div className="totals-row"><span>Paid</span><span>{money(invoice.amount_paid_cents)}</span></div>
          <div className="totals-row grand"><span>Balance due</span><span>{money(balance)}</span></div>
        </div>
        {payments.length === 0 ? (
          <p style={{ color: 'var(--muted)' }}>No payments recorded yet.</p>
        ) : (
          <div className="table-wrap">
            <table className="grid">
              <thead>
                <tr><th>Date</th><th>Method</th><th>Reference</th><th>Amount</th><th>Status</th><th></th></tr>
              </thead>
              <tbody>
                {payments.map((p) => (
                  <tr key={p.id}>
                    <td>{p.payment_date}</td>
                    <td>{METHOD_LABEL[p.method]}{p.note ? <div style={{ fontSize: 13, color: 'var(--muted)' }}>{p.note}</div> : null}</td>
                    <td style={{ fontSize: 14 }}>{p.reference ?? '—'}</td>
                    <td>{money(p.amount_cents)}</td>
                    <td>{p.reversed_at ? <span className="badge badge-void">Reversed</span> : <span className="badge badge-issued">Active</span>}</td>
                    <td style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>
                      <Button variant="ghost" size="sm" onClick={() => doDownloadReceipt(p)}>Receipt</Button>
                      {!p.reversed_at && invoice.status === 'issued' && (
                        <Button variant="ghost" size="sm" onClick={() => doReverse(p)}>Reverse</Button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <div className="card no-print">
        <h2 style={{ marginTop: 0 }}>History</h2>
        {chain.length > 1 && (
          <div style={{ marginBottom: 12 }}>
            <strong>Revision chain:</strong>{' '}
            {chain.map((r, i) => (
              <span key={r.id}>
                {i > 0 && ' → '}
                {r.id === invoice.id ? (
                  <strong>{r.invoice_number ?? r.draft_key} (rev {r.revision_no})</strong>
                ) : (
                  <Link to={r.status === 'draft' ? `/invoices/${r.id}` : `/invoices/${r.id}/view`}>
                    {r.invoice_number ?? r.draft_key} (rev {r.revision_no})
                  </Link>
                )}
              </span>
            ))}
          </div>
        )}
        {audit.length === 0 ? (
          <p style={{ color: 'var(--muted)' }}>No audit events yet.</p>
        ) : (
          <ul style={{ margin: 0, paddingLeft: 20, fontSize: 14 }}>
            {audit.map((a) => (
              <li key={a.id} style={{ marginBottom: 6 }}>
                <strong>{a.action.replace(/_/g, ' ')}</strong> — {new Date(a.created_at).toLocaleString()}
                {a.details && Object.keys(a.details).length > 0 && (
                  <span style={{ color: 'var(--muted)' }}> ({Object.entries(a.details).map(([k, v]) => `${k}: ${String(v)}`).join(', ')})</span>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>

      {invoice.status === 'issued' && (
        <div className="card no-print">
          <h2 style={{ marginTop: 0 }}>Corrections</h2>
          <p style={{ color: 'var(--muted)', fontSize: 14 }}>
            Issued invoices are never edited in place. Corrections go through a labeled revision
            workflow that preserves the original.
          </p>
          <div className="btn-row">
            <Button variant="secondary" size="sm" onClick={() => setRevOpen(true)}>Start revision…</Button>
            <Button variant="danger" size="sm" onClick={() => setVoidOpen(true)}>Void invoice…</Button>
          </div>
        </div>
      )}

      {payOpen && (
        <Modal title={`Record payment — ${invoice.invoice_number}`} onClose={() => setPayOpen(false)}>
          {payError && <Alert kind="error">{payError}</Alert>}
          <p>Balance due: <strong>{money(balance)}</strong></p>
          <Field label="Amount $ *" htmlFor="pay-amt">
            <TextField id="pay-amt" inputMode="decimal" value={payAmount} onChange={(e) => setPayAmount(e.target.value)} />
          </Field>
          <div className="form-row">
            <Field label="Method *" htmlFor="pay-method">
              <SelectField id="pay-method" value={payMethod} onChange={(e) => setPayMethod(e.target.value as PaymentMethod)}>
                <option value="cash">Cash</option>
                <option value="check">Check</option>
                <option value="bank_transfer">Bank transfer</option>
                <option value="other">Other</option>
              </SelectField>
            </Field>
            <Field label="Payment date" htmlFor="pay-date">
              <TextField id="pay-date" type="date" value={payDate} onChange={(e) => setPayDate(e.target.value)} />
            </Field>
          </div>
          <Field label="Reference" htmlFor="pay-ref" hint="Check number, transaction ID, etc.">
            <TextField id="pay-ref" value={payRef} onChange={(e) => setPayRef(e.target.value)} />
          </Field>
          <Field label="Note" htmlFor="pay-note">
            <TextArea id="pay-note" value={payNote} onChange={(e) => setPayNote(e.target.value)} />
          </Field>
          <div className="btn-row">
            <Button onClick={doRecordPayment} disabled={busy === 'pay'}>
              {busy === 'pay' ? 'Recording…' : 'Record payment'}
            </Button>
            <Button variant="secondary" onClick={() => setPayOpen(false)}>Cancel</Button>
          </div>
        </Modal>
      )}

      {voidOpen && (
        <Modal title={`Void invoice ${invoice.invoice_number}?`} onClose={() => setVoidOpen(false)}>
          <p>
            Voiding is permanent and the invoice number <strong>{invoice.invoice_number}</strong> will
            never be reused. The record and its history are kept.
          </p>
          <Field label="Reason * (required)" htmlFor="void-reason">
            <TextArea id="void-reason" value={voidReason} onChange={(e) => setVoidReason(e.target.value)} />
          </Field>
          <div className="btn-row">
            <Button variant="danger" onClick={doVoid} disabled={busy === 'void' || !voidReason.trim()}>
              Void {invoice.invoice_number}
            </Button>
            <Button variant="secondary" onClick={() => setVoidOpen(false)}>Cancel</Button>
          </div>
        </Modal>
      )}

      {revOpen && (
        <Modal title="Start a revision" onClose={() => setRevOpen(false)}>
          <p>
            This copies invoice <strong>{invoice.invoice_number}</strong> into a new editable draft
            (revision {invoice.revision_no + 1}). The original stays exactly as issued.
          </p>
          <Field label="Reason * (required)" htmlFor="rev-reason" hint="This reason is stored in the audit trail.">
            <TextArea id="rev-reason" value={revReason} onChange={(e) => setRevReason(e.target.value)} />
          </Field>
          <div className="btn-row">
            <Button onClick={doRevision} disabled={busy === 'rev' || !revReason.trim()}>
              Create revision draft
            </Button>
            <Button variant="secondary" onClick={() => setRevOpen(false)}>Cancel</Button>
          </div>
        </Modal>
      )}

    </div>
  );
}
