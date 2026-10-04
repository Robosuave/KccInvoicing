import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useBusiness } from '../business/BusinessContext';
import type { Customer, Invoice } from '../db/types';
import { createDraft, deleteDraft, getDraft, listInvoices } from '../data/drafts';
import { listCustomers } from '../data/customers';
import { listBusinessMembers } from '../data/team';
import { centsToDollars } from '../lib/money';
import { Alert, Button, EmptyState, SetupRequired } from '../components/ui';

export default function Invoices() {
  const { activeBusiness, notConfigured, isOwner, loading: businessesLoading } = useBusiness();
  const navigate = useNavigate();
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [filter, setFilter] = useState<'all' | 'draft' | 'issued'>('all');
  const [customers, setCustomers] = useState<Record<string, Customer>>({});
  const [creatorEmails, setCreatorEmails] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = async () => {
    if (!activeBusiness) return;
    setLoading(true);
    try {
      const [inv, c] = await Promise.all([
        listInvoices(activeBusiness.id, filter === 'all' ? undefined : filter),
        listCustomers(activeBusiness.id),
      ]);
      setInvoices(inv);
      setCustomers(Object.fromEntries(c.map((x) => [x.id, x])));
      // Owners see who created each invoice.
      if (isOwner) {
        try {
          const members = await listBusinessMembers(activeBusiness.id);
          const byId: Record<string, string> = {};
          for (const m of members) byId[m.user_id] = m.email;
          setCreatorEmails(byId);
        } catch {
          setCreatorEmails({});
        }
      } else {
        setCreatorEmails({});
      }
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load invoices.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeBusiness?.id, filter]);

  if (notConfigured) return <SetupRequired what="Invoices" />;
  if (businessesLoading) return <p>Loading…</p>;
  if (!activeBusiness) return <EmptyState title="No business selected" body="Create a business first." />;

  const duplicate = async (id: string) => {
    try {
      const { invoice, lines } = await getDraft(id);
      const copy = await createDraft({
        business_id: invoice.business_id,
        customer_id: invoice.customer_id,
        invoice_date: new Date().toISOString().slice(0, 10),
        currency: invoice.currency,
        notes: invoice.notes,
        terms: invoice.terms,
        template: invoice.template,
        sale_price_cents: invoice.sale_price_cents,
        commission_pct: invoice.commission_pct,
        commission_amount_cents: invoice.commission_amount_cents,
        processing_fee_cents: invoice.processing_fee_cents,
        other_charge_desc: invoice.other_charge_desc,
        other_charge_cents: invoice.other_charge_cents,
        agent_name: invoice.agent_name,
        second_agent_name: invoice.second_agent_name,
        property_address: invoice.property_address,
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
        Invoices for <strong>{activeBusiness.display_name}</strong>. Drafts are works in progress;
        issued invoices are finalized and read-only.
      </p>

      <div className="btn-row" style={{ marginBottom: 20 }}>
        <Link className="btn btn-primary" to="/invoices/new">
          New invoice
        </Link>
      </div>

      <div className="btn-row" style={{ marginBottom: 20 }} role="tablist" aria-label="Filter invoices">
        {(['all', 'draft', 'issued'] as const).map((f) => (
          <Button
            key={f}
            variant={filter === f ? 'primary' : 'secondary'}
            size="sm"
            onClick={() => setFilter(f)}
          >
            {f === 'all' ? 'All' : f === 'draft' ? 'Drafts' : 'Issued'}
          </Button>
        ))}
      </div>

      {error && <Alert kind="error">{error}</Alert>}
      {loading ? (
        <p>Loading…</p>
      ) : invoices.length === 0 ? (
        <EmptyState
          title={filter === 'issued' ? 'No issued invoices' : filter === 'draft' ? 'No drafts' : 'No invoices'}
          body={
            filter === 'issued'
              ? 'Issued invoices appear here after you print / finalize a draft.'
              : 'Drafts you save appear here. Invoice numbers are assigned automatically.'
          }
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
                <th>Invoice</th>
                <th>Customer</th>
                <th>Date</th>
                <th>Total</th>
                <th>Status</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {invoices.map((d) => (
                <tr key={d.id}>
                  <td>
                    {d.invoice_number ? (
                      <strong>Invoice #{d.invoice_number}</strong>
                    ) : (
                      <strong>{d.draft_key}</strong>
                    )}
                    {d.template === 'commission' && (
                      <span className="badge" style={{ marginLeft: 8 }}>
                        Commission
                      </span>
                    )}
                    <div style={{ fontSize: 13, color: 'var(--muted)' }}>
                      Updated {new Date(d.updated_at).toLocaleString()}
                    </div>
                    {isOwner && d.created_by && creatorEmails[d.created_by] && (
                      <div style={{ fontSize: 13, color: 'var(--muted)' }}>
                        By {creatorEmails[d.created_by]}
                      </div>
                    )}
                  </td>
                  <td>{d.customer_id ? customers[d.customer_id]?.name ?? '—' : d.property_address ?? '—'}</td>
                  <td style={{ fontSize: 14 }}>{d.invoice_date}</td>
                  <td>${centsToDollars(d.total_cents)}</td>
                  <td>
                    {d.status === 'issued' ? (
                      <span className="badge badge-issued">Issued</span>
                    ) : (
                      <span className="badge badge-draft">Draft</span>
                    )}
                  </td>
                  <td style={{ whiteSpace: 'nowrap', textAlign: 'right' }}>
                    <Link className="btn btn-secondary btn-sm" to={`/invoices/${d.id}`}>
                      Open
                    </Link>{' '}
                    <Button variant="ghost" size="sm" onClick={() => duplicate(d.id)}>
                      Duplicate
                    </Button>{' '}
                    {d.status === 'draft' && (
                      <Button variant="ghost" size="sm" onClick={() => remove(d.id)}>
                        Delete
                      </Button>
                    )}
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
