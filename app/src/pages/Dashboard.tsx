import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useBusiness } from '../business/BusinessContext';
import { Alert, Button, EmptyState, SetupRequired, Stat } from '../components/ui';
import { listInvoices } from '../data/drafts';
import { listCustomers } from '../data/customers';
import { listItems } from '../data/items';
import { centsToDollars } from '../lib/money';

export default function Dashboard() {
  const { activeBusiness, notConfigured, loadError, loading: businessesLoading, isOwner } = useBusiness();
  const [stats, setStats] = useState({ drafts: 0, draftTotal: 0, issued: 0, issuedTotal: 0, customers: 0, items: 0 });
  const [statsLoading, setStatsLoading] = useState(true);

  useEffect(() => {
    if (!activeBusiness) {
      setStatsLoading(false);
      return;
    }
    setStatsLoading(true);
    Promise.all([
      listInvoices(activeBusiness.id, 'draft'),
      listInvoices(activeBusiness.id, 'issued'),
      listCustomers(activeBusiness.id),
      listItems(activeBusiness.id),
    ])
      .then(([drafts, issued, customers, items]) => {
        setStats({
          drafts: drafts.length,
          draftTotal: drafts.reduce((a, d) => a + d.total_cents, 0),
          issued: issued.length,
          issuedTotal: issued.reduce((a, d) => a + d.total_cents, 0),
          customers: customers.length,
          items: items.length,
        });
      })
      .catch(() => {})
      .finally(() => setStatsLoading(false));
  }, [activeBusiness]);

  if (notConfigured) return <SetupRequired what="The dashboard" />;
  if (loadError) return <Alert kind="error">{loadError}</Alert>;
  if (businessesLoading) return <p>Loading…</p>;
  if (!activeBusiness) {
    return isOwner ? (
      <EmptyState
        title="No business yet"
        body="Create your first business to start invoicing. Each business gets its own header, numbering, customers, and items."
        action={
          <Link className="btn btn-primary" to="/businesses">
            Create a business
          </Link>
        }
      />
    ) : (
      <EmptyState
        title="No business assigned"
        body="Your account hasn't been linked to a business yet. Ask the owner to send you an invite."
      />
    );
  }

  return (
    <div>
      <h1 className="page-title">Dashboard</h1>
      <p className="page-sub">
        {activeBusiness ? (
          isOwner ? (
            <>
              Showing <strong>{activeBusiness.display_name}</strong>. Switch businesses anytime from the
              top bar — each business keeps its own data.
            </>
          ) : (
            <>
              Showing <strong>{activeBusiness.display_name}</strong>.
            </>
          )
        ) : (
          'Loading…'
        )}
      </p>

      <div className="card">
        <h2 style={{ marginTop: 0 }}>Quick actions</h2>
        <div className="btn-row">
          <Link className="btn btn-primary" to="/invoices/new" style={{ fontSize: 16, padding: '12px 20px' }}>
            + New Commission Invoice
          </Link>
          <Link className="btn btn-secondary" to="/customers">
            Manage customers
          </Link>
          {activeBusiness?.default_template !== 'commission' && (
            <Link className="btn btn-secondary" to="/items">
              Manage items
            </Link>
          )}
        </div>
      </div>

      <h2 style={{ fontSize: 15, marginBottom: 8 }}>At a glance</h2>
      <div className="stats stats-mini">
        <Stat label="Draft invoices" value={String(stats.drafts)} note={`Draft total ${centsToDollars(stats.draftTotal)}`} />
        <Stat label="Issued invoices" value={String(stats.issued)} note={`Billed total ${centsToDollars(stats.issuedTotal)}`} />
        <Stat label="Customers" value={String(stats.customers)} />
      </div>

      <details className="card card-mini no-print">
        <summary>What each number means</summary>
        <ul style={{ margin: '8px 0 0', paddingLeft: 18, color: 'var(--muted)', fontSize: 12 }}>
          <li>Draft invoices are works in progress — they are not finalized yet.</li>
          <li>Draft total is the sum of draft amounts. It is not revenue.</li>
          <li>Issued invoices are finalized (printing / saving a PDF issues the invoice). Billed total is the sum of issued amounts.</li>
        </ul>
      </details>

      {!statsLoading && (
        <div className="no-print" style={{ marginTop: 8 }}>
          <Link to="/invoices">
            <Button variant="ghost" size="sm">
              View all invoices →
            </Button>
          </Link>
        </div>
      )}
    </div>
  );
}
