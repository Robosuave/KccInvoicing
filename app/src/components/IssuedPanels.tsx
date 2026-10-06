import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useBusiness } from '../business/BusinessContext';
import { asSnapshot, buildLiveSnapshot, type InvoiceSnapshot } from '../lib/snapshot';
import { getInvoice, isOverdue, listRevisionChain, voidInvoice, createRevision } from '../data/invoices';
import { listPayments, recordPayment, reversePayment, newIdempotencyKey } from '../data/payments';
import { listAuditEvents } from '../data/audit';
import { getCustomer } from '../data/customers';
import { listEmailsForInvoice, sendInvoiceEmail, emailStatusLabel } from '../data/email';
import TimesheetCard, { TimesheetAttachButton, useTimesheet } from './TimesheetCard';
import type { InvoiceEmail } from '../db/types';
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
export default function IssuedPanels({ invoiceId, onChanged, openEmailSignal }: { invoiceId: string; onChanged: () => void; openEmailSignal?: number }) {
  const navigate = useNavigate();
  const { workspace, activeBusiness, isOwner } = useBusiness();

  const [invoice, setInvoice] = useState<Invoice | null>(null);
  const ts = useTimesheet(invoiceId, (p) =>
    setInvoice((inv) => (inv ? { ...inv, timesheet_path: p } : inv)),
  );
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
  const [emails, setEmails] = useState<InvoiceEmail[]>([]);
  const [emailOpen, setEmailOpen] = useState(false);
  const [emailTo, setEmailTo] = useState('');
  const [emailSubject, setEmailSubject] = useState('');
  const [emailMessage, setEmailMessage] = useState('');
  const [emailError, setEmailError] = useState<string | null>(null);
  const [includeTimesheet, setIncludeTimesheet] = useState(true);

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
      const [pays, events, revChain, emailRows] = await Promise.all([
        listPayments(invoiceId).catch(() => []),
        listAuditEvents(invoiceId).catch(() => []),
        listRevisionChain(invoiceId).catch(() => []),
        listEmailsForInvoice(invoiceId).catch(() => []),
      ]);
      setInvoice(inv);
      setSnapshot(snap);
      setPayments(pays);
      setAudit(events);
      setChain(revChain);
      setEmails(emailRows);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load invoice data.');
    } finally {
      setLoading(false);
    }
  }, [invoiceId, workspace, activeBusiness]);

  useEffect(() => { load(); }, [load]);

  const emailConfigured = Boolean((activeBusiness?.email_from || '').trim());

  const openEmailModal = async () => {
    setEmailError(null);
    // Prefill recipient from the customer when available.
    let to = '';
    try {
      if (invoice?.customer_id) {
        const c = await getCustomer(invoice.customer_id).catch(() => null);
        to = c?.email ?? '';
      }
    } catch { /* non-critical */ }
    setEmailTo(to);
    setEmailSubject(
      activeBusiness?.default_email_subject ||
      `Invoice #${invoice?.invoice_number ?? ''} from ${activeBusiness?.display_name ?? ''}`.trim(),
    );
    setEmailMessage(
      activeBusiness?.default_email_message ||
      `Hello,\n\nPlease find attached invoice #${invoice?.invoice_number ?? ''}.\n\nThank you,\n${activeBusiness?.display_name ?? ''}`,
    );
    setIncludeTimesheet(true);
    setEmailOpen(true);
  };

  // Lets a parent (e.g. the draft editor's "Email invoice" button) open the
  // email dialog right after finalizing. Fires once per signal value, and only
  // once the invoice data has loaded.
  const emailSignalFired = useRef(0);
  useEffect(() => {
    if (!openEmailSignal || openEmailSignal <= emailSignalFired.current) return;
    if (!invoice || !emailConfigured || invoice.status === 'void') return;
    emailSignalFired.current = openEmailSignal;
    openEmailModal();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [openEmailSignal, invoice, emailConfigured]);

  const doSendEmail = async () => {
    setEmailError(null);
    if (!emailTo.trim() || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(emailTo.trim())) {
      setEmailError('Enter a valid recipient email address.');
      return;
    }
    setBusy('email');
    try {
      await sendInvoiceEmail({
        invoice_id: invoiceId,
        to: emailTo.trim(),
        subject: emailSubject.trim(),
        message: emailMessage.trim(),
        include_timesheet: includeTimesheet,
      });
      setEmailOpen(false);
      const rows = await listEmailsForInvoice(invoiceId).catch(() => []);
      setEmails(rows);
      onChanged();
    } catch (e) {
      setEmailError(e instanceof Error ? e.message : 'Could not send the email.');
    } finally {
      setBusy(null);
    }
  };

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
          {!isVoid && emailConfigured && (
            <Button size="sm" onClick={openEmailModal}>Email invoice</Button>
          )}
          {!isVoid && (
            <TimesheetAttachButton ts={ts} />
          )}
        </div>
        {!isVoid && !emailConfigured && isOwner && (
          <p style={{ fontSize: 14, color: 'var(--muted)', margin: '12px 0 0' }}>
            Email isn't set up yet — add a from address under{' '}
            <Link to="/businesses">Businesses &gt; Edit business</Link>.
          </p>
        )}
      </div>

      {!isVoid && (
        <div className="card">
          <div className="btn-row" style={{ justifyContent: 'space-between', alignItems: 'center' }}>
            <h2 style={{ margin: 0 }}>Email</h2>
            {emailConfigured && (
              <Button size="sm" variant="secondary" onClick={openEmailModal}>Send email</Button>
            )}
          </div>
          {emails.length === 0 ? (
            <p style={{ color: 'var(--muted)' }}>
              {emailConfigured
                ? 'This invoice has not been emailed yet.'
                : 'Email delivery tracking will appear here once email is set up.'}
            </p>
          ) : (
            <div className="table-wrap">
              <table className="grid">
                <thead>
                  <tr><th>To</th><th>Sent</th><th>Status</th></tr>
                </thead>
                <tbody>
                  {emails.map((em) => (
                    <tr key={em.id}>
                      <td>{em.to_email}</td>
                      <td style={{ fontSize: 14 }}>{new Date(em.created_at).toLocaleString()}</td>
                      <td>
                        <span className={`badge ${em.status === 'bounced' || em.status === 'failed' ? 'badge-void' : em.status === 'opened' || em.status === 'delivered' ? 'badge-issued' : 'badge-draft'}`}>
                          {emailStatusLabel(em.status)}
                        </span>
                        {em.error && <div style={{ fontSize: 13, color: 'var(--muted)' }}>{em.error}</div>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      <TimesheetCard ts={ts} />

      {emailOpen && (
        <Modal title={`Email invoice #${invoice.invoice_number}`} onClose={() => setEmailOpen(false)}>
          <Field label="To *" htmlFor="email-to">
            <TextField id="email-to" value={emailTo} onChange={(e) => setEmailTo(e.target.value)} placeholder="client@example.com" />
          </Field>
          <Field label="Subject" htmlFor="email-subject">
            <TextField id="email-subject" value={emailSubject} onChange={(e) => setEmailSubject(e.target.value)} />
          </Field>
          <Field label="Message" htmlFor="email-message">
            <TextArea id="email-message" value={emailMessage} onChange={(e) => setEmailMessage(e.target.value)} rows={5} />
          </Field>
          {ts.attachedPath ? (
            <label style={{ display: 'flex', gap: 8, alignItems: 'center', fontSize: 15, margin: '4px 0 12px' }}>
              <input
                type="checkbox"
                checked={includeTimesheet}
                onChange={(e) => setIncludeTimesheet(e.target.checked)}
              />
              Include timesheet PDF
            </label>
          ) : (
            <div style={{ margin: '4px 0 12px' }}>
              <TimesheetAttachButton ts={ts} />
              <p style={{ fontSize: 13, color: 'var(--muted)', margin: '4px 0 0' }}>
                Attach your timesheet PDF here to send it with this email.
              </p>
            </div>
          )}
          <p style={{ fontSize: 14, color: 'var(--muted)' }}>
            Sends from {activeBusiness.email_from} with the finalized PDF attached
            {ts.attachedPath && includeTimesheet ? ' plus your timesheet' : ''}.
          </p>
          {emailError && <Alert kind="error">{emailError}</Alert>}
          <div className="btn-row">
            <Button onClick={doSendEmail} disabled={busy === 'email'}>
              {busy === 'email' ? 'Sending…' : 'Send email'}
            </Button>
            <Button variant="secondary" onClick={() => setEmailOpen(false)}>Cancel</Button>
          </div>
        </Modal>
      )}

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
