import { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useBusiness } from '../business/BusinessContext';
import { asSnapshot, buildLiveSnapshot, type InvoiceSnapshot } from '../lib/snapshot';
import { getInvoice, isOverdue, listRevisionChain, voidInvoice, createRevision } from '../data/invoices';
import { listPayments, recordPayment, reversePayment, newIdempotencyKey } from '../data/payments';
import { listAuditEvents } from '../data/audit';
import { getCustomer } from '../data/customers';
import { balanceDue } from '../lib/money';
import { paymentStatusOf, type AuditEvent, type Invoice, type Payment, type PaymentMethod } from '../db/types';
import { downloadReceiptPdf, renderReceiptPdfBlob, storeReceiptPdf } from '../pdf/service';
import {
  Alert, Button, Field, Modal, SelectField, TextArea, TextField,
} from './ui';

const METHOD_LABEL: Record<PaymentMethod, string> = {
  cash: 'Cash', check: 'Check', bank_transfer: 'Bank transfer', other: 'Other',
};

function money(cents: number): string {
  const sign = cents < 0 ? '-' : '';
  const abs = Math.abs(Math.round(cents));
  return `${sign}$${Math.floor(abs / 100).toLocaleString('en-US')}.${String(abs % 100).padStart(2, '0')}`;
}

/**
 * Panels shown under an issued invoice: output, payments, corrections, history.
 * Renders the PDF from the server-frozen snapshot (or a live-data fallback for
 * invoices issued before migration 0018).
 */
export default function IssuedPanels({ invoiceId, onChanged }: { invoiceId: string; onChanged: () => void }) {
  const navigate = useNavigate();
  const { workspace, activeBusiness, isOwner } = useBusiness();

  const [invoice, setInvoice] = useState<Invoice | null>(null);
  const [snapshot, setSnapshot] = useState<InvoiceSnapshot | null>(null);
  const [payments, setPayments] = useState<Payment[]>([]);
  const [audit, setAudit] = useState<AuditEvent[]>([]);
  const [chain, setChain] = useState<Invoice[]>([]);
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
    if (!workspace || !activeBusiness) return;
    setLoading(true);
    try {
      const { invoice: inv, lines: ln } = await getInvoice(invoiceId);
      let snap = asSnapshot(inv.snapshot);
      if (!snap) {
        const customer = inv.customer_id ? await getCustomer(inv.customer_id).catch(() => null) : null;
        snap = buildLiveSnapshot({ invoice: inv, business: activeBusiness, customer, lines: ln });
      }
      // Payments / audit / revisions are optional — their tables may not exist
      // yet (pre-0018). A missing table must not block the invoice or PDF download.
      const [pays, events, revChain] = await Promise.all([
        listPayments(invoiceId).catch(() => []),
        listAuditEvents(invoiceId).catch(() => []),
        listRevisionChain(invoiceId).catch(() => []),
      ]);
      setInvoice(inv);
      setSnapshot(snap);
      setPayments(pays);
      setAudit(events);
      setChain(revChain);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load invoice data.');
    } finally {
      setLoading(false);
    }
  }, [invoiceId, workspace, activeBusiness]);

  useEffect(() => { load(); }, [load]);

  if (loading) return <p>Loading invoice details…</p>;
  if (error || !invoice || !snapshot || !workspace || !activeBusiness) {
    return <Alert kind="error">{error ?? 'Could not load invoice details.'}</Alert>;
  }

  const balance = Math.max(0, invoice.total_cents - invoice.amount_paid_cents);
  const payStatus = paymentStatusOf(invoice.total_cents, invoice.amount_paid_cents);
  const overdue = isOverdue(invoice);
  const isVoid = invoice.status === 'void';

  const doRecordPayment = async () => {
    setPayError(null);
    const amountCents = Math.round(Number(payAmount) * 100);
    if (!Number.isInteger(amountCents) || amountCents <= 0 || Number.isNaN(amountCents)) {
      setPayError('Amount must be a valid dollar figure.');
      return;
    }
    setBusy('pay');
    try {
      const payment = await recordPayment({
        invoice, amountCents, method: payMethod,
        reference: payRef, note: payNote, paymentDate: payDate,
        idempotencyKey: newIdempotencyKey(),
      });
      // Generate the receipt (non-blocking for the payment itself).
      try {
        const newBalance = balanceDue(invoice.total_cents, invoice.amount_paid_cents + amountCents);
        const blob = await renderReceiptPdfBlob(snapshot, payment, newBalance);
        await storeReceiptPdf(workspace.id, invoice.business_id, payment, blob);
      } catch {
        /* receipt can be generated later from the payment row */
      }
      setPayOpen(false);
      setPayAmount(''); setPayRef(''); setPayNote('');
      await load();
      onChanged();
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
      onChanged();
    } catch (e) {
      alert(e instanceof Error ? e.message : 'Reversal failed.');
    } finally {
      setBusy(null);
    }
  };

  const doDownloadReceipt = async (p: Payment) => {
    setBusy('pdf');
    try {
      await downloadReceiptPdf(workspace.id, snapshot, p, balance);
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
      onChanged();
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

  return (
    <div className="no-print" style={{ marginTop: 24 }}>
      {isVoid && (
        <Alert kind="warning">
          Voided{invoice.voided_at ? ` on ${invoice.voided_at.slice(0, 10)}` : ''}.
          {invoice.void_reason ? ` Reason: ${invoice.void_reason}` : ''} The number {invoice.invoice_number} will not be reused.
        </Alert>
      )}

      <div className="card">
        <div className="btn-row" style={{ justifyContent: 'space-between', alignItems: 'center' }}>
          <h2 style={{ margin: 0 }}>Invoice {invoice.invoice_number}</h2>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <span className={`badge badge-${isVoid ? 'void' : 'issued'}`}>{invoice.status.toUpperCase()}</span>
            {!isVoid && <span className="badge badge-draft">{payStatus.replace('_', ' ').toUpperCase()}</span>}
            {overdue && <span className="badge badge-draft">OVERDUE</span>}
            {invoice.revision_no > 1 && <span className="badge badge-void">Rev {invoice.revision_no}</span>}
          </div>
        </div>
        <div className="btn-row" style={{ marginTop: 12 }}>
          <Button size="sm" variant="secondary" onClick={() => window.print()}>Print</Button>
          <Button size="sm" variant="secondary" disabled title="Email arrives in Phase 4">
            Email invoice (Phase 4)
          </Button>
        </div>
      </div>

      {!isVoid && (
        <div className="card">
          <div className="btn-row" style={{ justifyContent: 'space-between', alignItems: 'center' }}>
            <h2 style={{ margin: 0 }}>Payments</h2>
            {balance > 0 && (
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
                        {!p.reversed_at && (
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
      )}

      {!isVoid && (
        <div className="card">
          <h2 style={{ marginTop: 0 }}>Corrections</h2>
          <p style={{ color: 'var(--muted)', fontSize: 14 }}>
            Issued invoices are never edited in place. Corrections go through a labeled revision
            workflow that preserves the original.
          </p>
          <div className="btn-row">
            <Button variant="secondary" size="sm" onClick={() => setRevOpen(true)}>Start revision…</Button>
            {isOwner && (
              <Button variant="danger" size="sm" onClick={() => setVoidOpen(true)}>Void invoice…</Button>
            )}
          </div>
          {chain.length > 1 && (
            <div style={{ marginTop: 12, fontSize: 14 }}>
              <strong>Revision chain:</strong>{' '}
              {chain.map((r, i) => (
                <span key={r.id}>
                  {i > 0 && ' → '}
                  {r.id === invoice.id ? (
                    <strong>{r.invoice_number} (rev {r.revision_no})</strong>
                  ) : (
                    <Link to={`/invoices/${r.id}`}>{r.invoice_number} (rev {r.revision_no})</Link>
                  )}
                </span>
              ))}
            </div>
          )}
        </div>
      )}

      <div className="card">
        <h2 style={{ marginTop: 0 }}>History</h2>
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
          <Field label="Reason * (required)" htmlFor="rev-reason" hint="Stored in the audit trail.">
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
