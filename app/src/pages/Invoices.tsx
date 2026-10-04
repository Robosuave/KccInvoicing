import { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useBusiness } from '../business/BusinessContext';
import { isOverdue, listInvoices, type InvoiceFilters, type InvoiceRow } from '../data/invoices';
import { createDraft, deleteDraft, getDraft } from '../data/drafts';
import { centsToDollars } from '../lib/money';
import type { InvoiceStatus, PaymentStatus } from '../db/types';
import {
  Alert,
  Button,
  EmptyState,
  Field,
  SelectField,
  SetupRequired,
  TextField,
} from '../components/ui';

function money(cents: number): string {
  return `$${centsToDollars(cents)}`;
}

const PAGE_SIZE = 25;

export default function Invoices() {
  const { activeBusiness, notConfigured } = useBusiness();
  const navigate = useNavigate();

  const [rows, setRows] = useState<InvoiceRow[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [search, setSearch] = useState('');
  const [status, setStatus] = useState<InvoiceStatus | 'all'>('all');
  const [paymentStatus, setPaymentStatus] = useState<PaymentStatus | 'all'>('all');
  const [overdueOnly, setOverdueOnly] = useState(false);
  const [sortBy, setSortBy] = useState<InvoiceFilters['sortBy']>('invoice_date');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc');
  const [page, setPage] = useState(0);

  const load = useCallback(async () => {
    if (!activeBusiness) return;
    setLoading(true);
    try {
      const { rows: r, total: t } = await listInvoices(activeBusiness.id, {
        search,
        status,
        paymentStatus,
        overdue: overdueOnly || undefined,
        sortBy,
        sortDir,
        page,
        pageSize: PAGE_SIZE,
      });
      setRows(r);
      setTotal(t);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load invoices.');
    } finally {
      setLoading(false);
    }
  }, [activeBusiness, search, status, paymentStatus, overdueOnly, sortBy, sortDir, page]);

  useEffect(() => {
    setPage(0);
  }, [search, status, paymentStatus, overdueOnly, activeBusiness?.id]);

  useEffect(() => {
    const t = setTimeout(load, search ? 350 : 0);
    return () => clearTimeout(t);
  }, [load]);

  if (notConfigured) return <SetupRequired what="Invoices" />;
  if (!activeBusiness) return <EmptyState title="No business selected" body="Create a business first." />;

  const duplicate = async (id: string) => {
    try {
      const { invoice, lines } = await getDraft(id);
      const copy = await createDraft({
        business_id: invoice.business_id,
        customer_id: invoice.customer_id,
        invoice_date: new Date().toISOString().slice(0, 10),
        due_date: invoice.due_date,
        po_number: invoice.po_number,
        currency: invoice.currency,
        notes: invoice.notes,
        terms: invoice.terms,
        payment_instructions: invoice.payment_instructions,
        lines: lines.map((l) => ({
          item_id: l.item_id,
          description: l.description,
          quantity: l.quantity,
          unit_label: l.unit_label,
          unit_price_cents: l.unit_price_cents,
          discount_cents: l.discount_cents,
          tax_rate: l.tax_rate,
        })),
      });
      navigate(`/invoices/${copy.id}`);
    } catch (e) {
      alert(e instanceof Error ? e.message : 'Duplicate failed.');
    }
  };

  const removeDraft = async (id: string) => {
    if (!window.confirm('Delete this draft? This cannot be undone.')) return;
    try {
      await deleteDraft(id);
      await load();
    } catch (e) {
      alert(e instanceof Error ? e.message : 'Delete failed.');
    }
  };

  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  return (
    <div>
      <h1 className="page-title">Invoices</h1>
      <p className="page-sub">
        Full history for <strong>{activeBusiness.display_name}</strong> — drafts, issued, and void.
      </p>

      <div className="btn-row" style={{ marginBottom: 16 }}>
        <Link className="btn btn-primary" to="/invoices/new">New invoice</Link>
        <div style={{ flex: 1, minWidth: 200, maxWidth: 340 }}>
          <TextField
            placeholder="Search number, P.O., notes, customer…"
            aria-label="Search invoices"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
      </div>

      <div className="card">
        <div className="form-row">
          <Field label="Document status" htmlFor="f-status">
            <SelectField id="f-status" value={status} onChange={(e) => setStatus(e.target.value as InvoiceStatus | 'all')}>
              <option value="all">All</option>
              <option value="draft">Draft</option>
              <option value="issued">Issued</option>
              <option value="void">Void</option>
            </SelectField>
          </Field>
          <Field label="Payment status" htmlFor="f-pay">
            <SelectField id="f-pay" value={paymentStatus} onChange={(e) => setPaymentStatus(e.target.value as PaymentStatus | 'all')}>
              <option value="all">All</option>
              <option value="unpaid">Unpaid</option>
              <option value="partial">Partially paid</option>
              <option value="paid">Paid</option>
            </SelectField>
          </Field>
          <Field label="Sort by" htmlFor="f-sort">
            <SelectField
              id="f-sort"
              value={`${sortBy}:${sortDir}`}
              onChange={(e) => {
                const [sb, sd] = e.target.value.split(':');
                setSortBy(sb as InvoiceFilters['sortBy']);
                setSortDir(sd as 'asc' | 'desc');
              }}
            >
              <option value="invoice_date:desc">Date (newest)</option>
              <option value="invoice_date:asc">Date (oldest)</option>
              <option value="invoice_number:asc">Number (A–Z)</option>
              <option value="invoice_number:desc">Number (Z–A)</option>
              <option value="total_cents:desc">Total (highest)</option>
              <option value="total_cents:asc">Total (lowest)</option>
            </SelectField>
          </Field>
          <div className="field">
            <label>&nbsp;</label>
            <label className="checkbox-row" style={{ minHeight: 46 }}>
              <input type="checkbox" checked={overdueOnly} onChange={(e) => setOverdueOnly(e.target.checked)} />
              Overdue only
            </label>
          </div>
        </div>
      </div>

      {error && <Alert kind="error">{error}</Alert>}

      {loading ? (
        <p>Loading…</p>
      ) : rows.length === 0 ? (
        <EmptyState
          title="No invoices match"
          body="Try widening the filters, or create a new invoice."
          action={<Link className="btn btn-primary" to="/invoices/new">New invoice</Link>}
        />
      ) : (
        <>
          <div className="table-wrap">
            <table className="grid">
              <thead>
                <tr>
                  <th>Invoice</th>
                  <th>Customer</th>
                  <th>Date</th>
                  <th>Total</th>
                  <th>Balance</th>
                  <th>Status</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => {
                  const bal = r.total_cents - r.amount_paid_cents;
                  const od = isOverdue(r);
                  return (
                    <tr key={r.id}>
                      <td>
                        <strong>{r.invoice_number ?? r.draft_key}</strong>
                        {r.revision_no > 1 && <div style={{ fontSize: 12, color: 'var(--muted)' }}>Rev {r.revision_no}</div>}
                      </td>
                      <td style={{ fontSize: 14 }}>{r.customer_name ?? '—'}</td>
                      <td style={{ fontSize: 14 }}>{r.invoice_date}</td>
                      <td>{money(r.total_cents)}</td>
                      <td>{r.status === 'issued' ? money(bal) : '—'}</td>
                      <td>
                        <span className={`badge badge-${r.status === 'draft' ? 'draft' : r.status === 'void' ? 'void' : 'issued'}`}>
                          {r.status.toUpperCase()}
                        </span>{' '}
                        {r.status === 'issued' && (
                          <span className="badge badge-draft">{r.payment_status.replace('_', ' ').toUpperCase()}</span>
                        )}
                        {od && <div style={{ marginTop: 4 }}><span className="badge badge-draft">OVERDUE</span></div>}
                      </td>
                      <td style={{ whiteSpace: 'nowrap', textAlign: 'right' }}>
                        {r.status === 'draft' ? (
                          <>
                            <Link className="btn btn-secondary btn-sm" to={`/invoices/${r.id}`}>Open</Link>{' '}
                            <Button variant="ghost" size="sm" onClick={() => duplicate(r.id)}>Duplicate</Button>{' '}
                            <Button variant="ghost" size="sm" onClick={() => removeDraft(r.id)}>Delete</Button>
                          </>
                        ) : (
                          <>
                            <Link className="btn btn-secondary btn-sm" to={`/invoices/${r.id}/view`}>Open</Link>{' '}
                            <Button variant="ghost" size="sm" onClick={() => duplicate(r.id)}>Duplicate</Button>
                          </>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <div className="btn-row" style={{ marginTop: 12, justifyContent: 'space-between' }}>
            <span style={{ fontSize: 14, color: 'var(--muted)' }}>
              {total} invoice{total === 1 ? '' : 's'} · page {page + 1} of {pages}
            </span>
            <div className="btn-row">
              <Button variant="secondary" size="sm" disabled={page === 0} onClick={() => setPage((p) => p - 1)}>← Prev</Button>
              <Button variant="secondary" size="sm" disabled={page + 1 >= pages} onClick={() => setPage((p) => p + 1)}>Next →</Button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
