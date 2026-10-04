import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { useBusiness } from '../business/BusinessContext';
import { asSnapshot, type InvoiceSnapshot } from '../lib/snapshot';
import { getIssuedInvoice } from '../data/invoices';
import { getLogoUrl } from '../data/businesses';
import type { TemplateId } from '../templates/templates';
import InvoiceDocument from '../components/InvoiceDocument';
import { Alert, Button, SetupRequired } from '../components/ui';

export default function InvoicePrint() {
  const { id } = useParams();
  const { notConfigured } = useBusiness();
  const [snapshot, setSnapshot] = useState<InvoiceSnapshot | null>(null);
  const [logoUrl, setLogoUrl] = useState<string | undefined>();
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!id) return;
    getIssuedInvoice(id)
      .then(async (inv) => {
        const snap = asSnapshot(inv.snapshot);
        setSnapshot(snap);
        if (snap.business.logo_path) {
          setLogoUrl((await getLogoUrl(snap.business.logo_path)) ?? undefined);
        }
      })
      .catch((e) => setError(e instanceof Error ? e.message : 'Failed to load invoice.'));
  }, [id]);

  if (notConfigured) return <SetupRequired what="Printing" />;
  if (error) return <Alert kind="error">{error}</Alert>;
  if (!snapshot) return <p>Loading…</p>;

  return (
    <div>
      <div className="no-print" style={{ marginBottom: 16 }}>
        <Button onClick={() => window.print()}>Print this invoice</Button>
        <p style={{ fontSize: 13, color: 'var(--muted)' }}>
          Invoice {snapshot.invoice_number} · {snapshot.business.display_name}. The printed copy
          matches the stored issued document.
        </p>
      </div>
      <InvoiceDocument
        snapshot={snapshot}
        template={(snapshot.template_id as TemplateId) || 'classic'}
        logoUrl={logoUrl}
      />
    </div>
  );
}
