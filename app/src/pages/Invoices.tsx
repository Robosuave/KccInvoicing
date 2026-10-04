import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useBusiness } from '../business/BusinessContext';
import type { Customer, Invoice } from '../db/types';
import { createDraft, deleteDraft, getDraft, listDrafts } from '../data/drafts';
import { listCustomers } from '../data/customers';
import { centsToDollars } from '../lib/money';
import { Alert, Button, EmptyState, SetupRequired } from '../components/ui';

export default function Invoices() {
  const { activeBusiness, notConfigured } = useBusiness();
  const navigate = useNavigate();
  const [drafts, setDrafts] = useState<Invoice[]>([]);
  const [customers, setCustomers] = useState<Record<string, Customer>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = async () => {
    if (!activeBusiness) return;
    setLoading(true);
    try {
      const [d, c] = await Promise.all([listDrafts(activeBusiness.id), listCustomers(activeBusiness.id)]);
      setDrafts(d);
      setCustomers(Object.fromEntries(c.map((x) => [x.id, x])));
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load drafts.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeBusiness?.id]);

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

  const remove = async (id: string) => {
    if (!window.confirm('Delete this draft? This cannot be undone.')) return;
    try {
      await deleteDraft(id);
      await load();
    } catch (e) {
      alert(e instanceof Error ? e.message : 'Delete failed.');
    }
  };

  return (
    <div>
      <h1 className="page-title">Invoices</h1>
      <p className="page-sub">
        Drafts for <strong>{activeBusiness.display_name}</strong>. Issuing, numbering, and history
        arrive in Phase 2.
      </p>

      <div className="btn-row" style={{ marginBottom: 20 }}>
        <Link className="btn btn-primary" to="/invoices/new">
          New invoice
        </Link>
      </div>

      {error && <Alert kind="error">{error}</Alert>}
      {loading ? (
        <p>Loading…</p>
      ) : drafts.length === 0 ? (
        <EmptyState
          title="No drafts"
          body="Drafts you save appear here. Nothing is issued or numbered until Phase 2."
          action={
            <Link className="btn btn-primary" to="/invoices/new">
              New invoice
            </Link>
          }
        />
      ) : (
        <div className="table-wrap">
          <table className="grid">
            <thead>
              <tr>
                <th>Draft</th>
                <th>Customer</th>
                <th>Date</th>
                <th>Total</th>
                <th>Status</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {drafts.map((d) => (
                <tr key={d.id}>
                  <td>
                    <strong>{d.draft_key}</strong>
                    {d.template === 'commission' && (
                      <span className="badge" style={{ marginLeft: 8 }}>
                        Commission
                      </span>
                    )}
                    <div style={{ fontSize: 13, color: 'var(--muted)' }}>
                      Updated {new Date(d.updated_at).toLocaleString()}
                    </div>
                  </td>
                  <td>{d.customer_id ? customers[d.customer_id]?.name ?? '—' : '—'}</td>
                  <td style={{ fontSize: 14 }}>{d.invoice_date}</td>
                  <td>${centsToDollars(d.total_cents)}</td>
                  <td>
                    <span className="badge badge-draft">Draft</span>
                  </td>
                  <td style={{ whiteSpace: 'nowrap', textAlign: 'right' }}>
                    <Link className="btn btn-secondary btn-sm" to={`/invoices/${d.id}`}>
                      Open
                    </Link>{' '}
                    <Button variant="ghost" size="sm" onClick={() => duplicate(d.id)}>
                      Duplicate
                    </Button>{' '}
                    <Button variant="ghost" size="sm" onClick={() => remove(d.id)}>
                      Delete
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
