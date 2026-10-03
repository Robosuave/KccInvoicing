import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useBusiness } from '../business/BusinessContext';
import { Alert, Button, EmptyState, SetupRequired, Stat } from '../components/ui';
import { listDrafts } from '../data/drafts';
import { listCustomers } from '../data/customers';
import { listItems } from '../data/items';
import { centsToDollars } from '../lib/money';

export default function Dashboard() {
  const { activeBusiness, notConfigured, loadError } = useBusiness();
  const [stats, setStats] = useState({ drafts: 0, draftTotal: 0, customers: 0, items: 0 });
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!activeBusiness) {
      setLoading(false);
      return;
    }
    setLoading(true);
    Promise.all([
      listDrafts(activeBusiness.id),
      listCustomers(activeBusiness.id),
      listItems(activeBusiness.id),
    ])
      .then(([drafts, customers, items]) => {
        setStats({
          drafts: drafts.length,
          draftTotal: drafts.reduce((a, d) => a + d.total_cents, 0),
          customers: customers.length,
          items: items.length,
        });
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [activeBusiness]);

  if (notConfigured) return <SetupRequired what="The dashboard" />;
  if (loadError) return <Alert kind="error">{loadError}</Alert>;
  if (!activeBusiness && !loading) {
    return (
      <EmptyState
        title="No business yet"
        body="Create your first business to start invoicing. Each business gets its own header, numbering, customers, and items."
        action={
          <Link className="btn btn-primary" to="/businesses">
            Create a business
          </Link>
        }
      />
    );
  }

  return (
    <div>
      <h1 className="page-title">Dashboard</h1>
      <p className="page-sub">
        {activeBusiness ? (
          <>
            Showing <strong>{activeBusiness.display_name}</strong>. Switch businesses anytime from the
            top bar — each business keeps its own data.
          </>
        ) : (
          'Loading…'
        )}
      </p>

      <div className="stats">
        <Stat label="Draft invoices" value={String(stats.drafts)} note={`Draft total ${centsToDollars(stats.draftTotal)}`} />
        <Stat label="Customers" value={String(stats.customers)} />
        <Stat label="Catalog items" value={String(stats.items)} />
      </div>

      <div className="card">
        <h2 style={{ marginTop: 0 }}>Quick actions</h2>
        <div className="btn-row">
          <Link className="btn btn-primary" to="/invoices/new">
            New invoice
          </Link>
          <Link className="btn btn-secondary" to="/customers">
            Manage customers
          </Link>
          <Link className="btn btn-secondary" to="/items">
            Manage items
          </Link>
        </div>
      </div>

      <div className="card">
        <h2 style={{ marginTop: 0 }}>What each number means</h2>
        <ul style={{ margin: 0, paddingLeft: 20, color: 'var(--muted)', fontSize: 14 }}>
          <li>Draft invoices are works in progress — they are not issued and have no invoice number yet.</li>
          <li>Draft total is the sum of draft amounts. It is not revenue.</li>
          <li>Issued invoices, payments, and reports arrive in Phase 2.</li>
        </ul>
      </div>

      {!loading && (
        <div className="no-print" style={{ marginTop: 8 }}>
          <Link to="/invoices">
            <Button variant="ghost" size="sm">
              View all drafts →
            </Button>
          </Link>
        </div>
      )}
    </div>
  );
}
