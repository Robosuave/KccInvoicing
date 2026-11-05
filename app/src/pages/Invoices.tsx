import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useBusiness } from '../business/BusinessContext';
import type { Customer, Invoice } from '../db/types';
import { listInvoices, setBoardUpInvoiced, setInvoiceCompleted } from '../data/drafts';
import { listCustomers } from '../data/customers';
import { listBusinessMembers } from '../data/team';
import { deleteInvoiceDeep, isOverdue } from '../data/invoices';
import { paymentStatusOf } from '../db/types';
import { centsToDollars } from '../lib/money';
import { emailStatusByInvoice, emailStatusLabel } from '../data/email';
import type { InvoiceEmail } from '../db/types';
import { Alert, BackButton, Button, EmptyState, Modal, SetupRequired, TextField } from '../components/ui';
import {
  asBoardUpDetails,
  buildBoardUpCsv,
  estimateBoardUp,
} from '../lib/boardup';

export default function Invoices() {
  const { activeBusiness, notConfigured, isOwner, loading: businessesLoading } = useBusiness();
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [filter, setFilter] = useState<'all' | 'draft' | 'issued' | 'void'>('all');
  const [search, setSearch] = useState('');
  const [overdueOnly, setOverdueOnly] = useState(false);
  const [customers, setCustomers] = useState<Record<string, Customer>>({});
  const [creatorEmails, setCreatorEmails] = useState<Record<string, string>>({});
  const [emailByInvoice, setEmailByInvoice] = useState<Record<string, InvoiceEmail>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  // Delete uses an in-app Modal, never window.confirm/alert: the native
  // browser dialog needs a second press, blocks automation, and pauses
  // between every delete. One in-app confirm, then the delete runs.
  const [deleteTarget, setDeleteTarget] = useState<Invoice | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  // Bulk delete: owner picks invoices, one confirm deletes them all in one
  // go — no per-invoice dialog, no pause between each one.
  const [selected, setSelected] = useState<Record<string, boolean>>({});
  const [bulkTarget, setBulkTarget] = useState<Invoice[] | null>(null);
  const [bulkDeleting, setBulkDeleting] = useState(false);
  const [bulkError, setBulkError] = useState<string | null>(null);

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
      emailStatusByInvoice(inv.map((i) => i.id)).then(setEmailByInvoice).catch(() => setEmailByInvoice({}));
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

  // ALL hooks must run before any early return, or React throws
  // "Rendered more hooks than during the previous render" (#310) on a
  // cold load: render 1 returns early while loading, render 2 reaches
  // the hook. This useMemo used to sit after the returns below.
  const isBoardUp = activeBusiness?.default_template === 'boardup';

  /** Live counters for the board-up job board (Dan's header stats). */
  const boardUpStats = useMemo(() => {
    if (!isBoardUp) return null;
    let jobs = 0;
    let emergency = 0;
    let sheets = 0;
    for (const inv of invoices) {
      if (inv.template !== 'boardup') continue;
      jobs++;
      const d = asBoardUpDetails(inv.boardup_details);
      if (d.urgency.startsWith('Emergency')) emergency++;
      sheets += estimateBoardUp(d.windows, d.doors, d.sliders, d.garageDoors, d.acUnits).sheets;
    }
    return { jobs, emergency, sheets };
  }, [invoices, isBoardUp]);

  if (notConfigured) return <SetupRequired what="Invoices" />;
  if (businessesLoading) return <p>Loading…</p>;
  if (!activeBusiness) return <EmptyState title="No business selected" body="Create a business first." />;

  // Owner-only delete, any status. deleteInvoiceDeep (not deleteDraft)
  // deletes the row plus its stored PDF/photos and logs it. deleteDraft
  // silently deletes nothing for issued/void invoices — its Supabase delete
  // is filtered to status='draft', so the button looked broken on those.
  const confirmDelete = async () => {
    if (!deleteTarget || deleting) return;
    setDeleting(true);
    setDeleteError(null);
    try {
      await deleteInvoiceDeep(deleteTarget.id);
      setSelected((s) => {
        const next = { ...s };
        delete next[deleteTarget.id];
        return next;
      });
      setDeleteTarget(null);
      await load();
    } catch (e) {
      setDeleteError(e instanceof Error ? e.message : 'Delete failed.');
    } finally {
      setDeleting(false);
    }
  };

  const confirmBulkDelete = async () => {
    if (!bulkTarget || bulkTarget.length === 0 || bulkDeleting) return;
    setBulkDeleting(true);
    setBulkError(null);
    const failed: string[] = [];
    for (const inv of bulkTarget) {
      try {
        await deleteInvoiceDeep(inv.id);
      } catch (e) {
        failed.push(`#${inv.invoice_number ?? inv.draft_key}: ${e instanceof Error ? e.message : 'Delete failed.'}`);
      }
    }
    setSelected({});
    setBulkTarget(null);
    setBulkDeleting(false);
    if (failed.length > 0) setBulkError(`${failed.length} could not be deleted — ${failed.join('; ')}`);
    await load();
  };

  const toggleDone = async (d: Invoice) => {
    try {
      await setInvoiceCompleted(d.id, !d.completed);
      await load();
    } catch (e) {
      alert(e instanceof Error ? e.message : 'Update failed.');
    }
  };

  /** Dan, Oct 26: "Mark invoiced" flips to a green Invoiced badge, saved with the job. */
  const toggleInvoiced = async (d: Invoice) => {
    try {
      const details = asBoardUpDetails(d.boardup_details);
      await setBoardUpInvoiced(d.id, { ...details, invoiced: !details.invoiced });
      await load();
    } catch (e) {
      alert(e instanceof Error ? e.message : 'Update failed.');
    }
  };

  const downloadCsv = () => {
    const rows = invoices
      .filter((d) => d.template === 'boardup')
      .map((d) => ({
        jobNumber: d.invoice_number,
        completed: !!d.completed,
        createdAt: d.created_at,
        details: asBoardUpDetails(d.boardup_details),
      }));
    const blob = new Blob([buildBoardUpCsv(rows)], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `aquick-jobs-${new Date().toISOString().slice(0, 10)}.csv`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  };

  const q = search.trim().toLowerCase();
  const visible = invoices
    .filter((d) => {
      if (overdueOnly && !isOverdue(d)) return false;
      if (!q) return true;
      const hay = [
        d.invoice_number ?? '',
        d.po_number ?? '',
        d.notes ?? '',
        d.property_address ?? '',
        d.agent_name ?? '',
        d.customer_id ? customers[d.customer_id]?.name ?? '' : '',
      ]
        .join(' ')
        .toLowerCase();
      return hay.includes(q);
    })
    // Dan, Oct 26: board-up history sorts by the job's own date, newest first.
    .sort((a, b) => {
      if (a.template !== 'boardup' || b.template !== 'boardup') return 0;
      return (b.invoice_date ?? '').localeCompare(a.invoice_date ?? '');
    });

  return (
    <div>
      <BackButton />
      <h1 className="page-title">Invoices</h1>
      <p className="page-sub">
        Invoices for <strong>{activeBusiness.display_name}</strong>. Drafts are works in progress;
        issued invoices are finalized and read-only.
      </p>

      <div className="btn-row" style={{ marginBottom: 20 }}>
        <Link className="btn btn-primary" to="/invoices/new">
          {activeBusiness.default_template === 'boardup' ? 'New Job' : 'New invoice'}
        </Link>
        <div style={{ flex: 1, minWidth: 200, maxWidth: 340 }}>
          <TextField
            placeholder="Search address, invoice #, agent…"
            aria-label="Search invoices"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        <label className="checkbox-row" style={{ alignSelf: 'center' }}>
          <input
            type="checkbox"
            checked={overdueOnly}
            onChange={(e) => setOverdueOnly(e.target.checked)}
          />
          Overdue only
        </label>
      </div>

      <div className="btn-row" style={{ marginBottom: 20 }} role="tablist" aria-label="Filter invoices">
        {(['all', 'draft', 'issued', 'void'] as const).map((f) => (
          <Button
            key={f}
            variant={filter === f ? 'primary' : 'secondary'}
            size="sm"
            onClick={() => setFilter(f)}
          >
            {f === 'all' ? 'All' : f === 'draft' ? 'Drafts' : f === 'issued' ? 'Issued' : 'Void'}
          </Button>
        ))}
      </div>

      {error && <Alert kind="error">{error}</Alert>}
      {deleteError && <Alert kind="error">{deleteError}</Alert>}
      {bulkError && <Alert kind="error">{bulkError}</Alert>}
      {isOwner && (
        <div className="btn-row" style={{ marginBottom: 16, alignItems: 'center' }}>
          <Button
            variant="secondary"
            size="sm"
            onClick={() => {
              const all = Object.fromEntries(visible.map((d) => [d.id, true]));
              setSelected(all);
            }}
          >
            Select all visible ({visible.length})
          </Button>
          <Button
            variant="secondary"
            size="sm"
            onClick={() => setSelected({})}
          >
            Clear selection
          </Button>
          {Object.values(selected).filter(Boolean).length > 0 && (
            <Button
              variant="secondary"
              size="sm"
              onClick={() => setBulkTarget(visible.filter((d) => selected[d.id]))}
            >
              Delete selected ({Object.values(selected).filter(Boolean).length})
            </Button>
          )}
          <span style={{ fontSize: 13, color: 'var(--muted)' }}>
            One confirm deletes them all — no pause between each one.
          </span>
        </div>
      )}
      {isBoardUp && boardUpStats && (
        <div className="btn-row" style={{ marginBottom: 16, alignItems: 'center' }}>
          <span className="badge">{boardUpStats.jobs} JOBS LOGGED</span>
          <span className="badge">{boardUpStats.emergency} EMERGENCY</span>
          <span className="badge">{boardUpStats.sheets} PLYWOOD SHEETS EST.</span>
          <Button variant="secondary" size="sm" onClick={downloadCsv}>
            Download CSV
          </Button>
        </div>
      )}
      {loading ? (
        <p>Loading…</p>
      ) : visible.length === 0 ? (
        <EmptyState
          title={
            q || overdueOnly
              ? 'No invoices match'
              : filter === 'issued'
                ? 'No issued invoices'
                : filter === 'draft'
                  ? 'No drafts'
                  : 'No invoices'
          }
          body={
            q || overdueOnly
              ? 'Try widening the search or clearing the overdue filter.'
              : filter === 'issued'
                ? 'Issued invoices appear here after you print / finalize a draft.'
                : 'Drafts you save appear here. Invoice numbers are assigned automatically.'
          }
          action={
            <Link className="btn btn-primary" to="/invoices/new">
              {activeBusiness.default_template === 'boardup' ? 'New Job' : 'New invoice'}
            </Link>
          }
        />
      ) : (
        <div className="table-wrap">
          <table className="grid">
            <thead>
              <tr>
                {isOwner && <th aria-label="Select"></th>}
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
              {visible.map((d) => (
                <tr key={d.id}>
                  {isOwner && (
                    <td>
                      <input
                        type="checkbox"
                        aria-label={`Select invoice #${d.invoice_number ?? d.draft_key}`}
                        checked={!!selected[d.id]}
                        onChange={(e) =>
                          setSelected((s) => ({ ...s, [d.id]: e.target.checked }))
                        }
                      />
                    </td>
                  )}
                  <td>
                    {d.template === 'commission' && d.property_address ? (
                      <strong>{d.property_address}</strong>
                    ) : d.invoice_number ? (
                      <strong>{d.template === 'boardup' ? 'Job' : 'Invoice'} #{d.invoice_number}</strong>
                    ) : (
                      <strong>{d.draft_key}</strong>
                    )}
                    {d.template === 'commission' && (
                      <span className="badge" style={{ marginLeft: 8 }}>
                        Commission
                      </span>
                    )}
                    {d.template === 'boardup' && (
                      <span className="badge" style={{ marginLeft: 8 }}>
                        Board-Up
                      </span>
                    )}
                    {d.template === 'commission' && d.invoice_number && (
                      <div style={{ fontSize: 13, color: 'var(--muted)' }}>#{d.invoice_number}</div>
                    )}
                    {d.template === 'boardup' && d.invoice_number && (
                      <div style={{ fontSize: 13, color: 'var(--muted)' }}>Job #{d.invoice_number}</div>
                    )}
                    {d.revision_no > 1 && (
                      <span className="badge" style={{ marginLeft: 8 }}>
                        Rev {d.revision_no}
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
                      <>${centsToDollars(Math.max(0, d.total_cents - d.amount_paid_cents))}</>
                    ) : (
                      '—'
                    )}
                  </td>
                  <td>
                    {d.status === 'issued' ? (
                      <span className="badge badge-issued">Issued</span>
                    ) : d.status === 'void' ? (
                      <span className="badge badge-void">Void</span>
                    ) : (
                      <span className="badge badge-draft">Draft</span>
                    )}{' '}
                    {d.status === 'issued' && (
                      <span className="badge badge-draft">
                        {paymentStatusOf(d.total_cents, d.amount_paid_cents).toUpperCase()}
                      </span>
                    )}
                    {emailByInvoice[d.id] && (
                      <div style={{ marginTop: 4 }}>
                        <span className={`badge ${emailByInvoice[d.id].status === 'bounced' || emailByInvoice[d.id].status === 'failed' ? 'badge-void' : 'badge-issued'}`}>
                          ✉ {emailStatusLabel(emailByInvoice[d.id].status)}
                        </span>
                      </div>
                    )}
                    {isOverdue(d) && (
                      <div style={{ marginTop: 4 }}>
                        <span className="badge badge-draft">OVERDUE</span>
                      </div>
                    )}
                    {d.template === 'boardup' && !!d.completed && (
                      <div style={{ marginTop: 4 }}>
                        <span className="badge badge-issued">DONE</span>
                      </div>
                    )}
                    {d.template === 'boardup' && asBoardUpDetails(d.boardup_details).invoiced && (
                      <div style={{ marginTop: 4 }}>
                        <span className="badge badge-issued">✓ Invoiced</span>
                      </div>
                    )}
                  </td>
                  <td style={{ whiteSpace: 'nowrap', textAlign: 'right' }}>
                    <Link className="btn btn-secondary btn-sm" to={`/invoices/${d.id}`}>
                      Open
                    </Link>{' '}
                    {d.template === 'boardup' && (
                      <Button variant="ghost" size="sm" onClick={() => toggleDone(d)}>
                        {d.completed ? 'Reopen' : 'Mark done'}
                      </Button>
                    )}{' '}
                    {d.template === 'boardup' && (
                      <Button variant="ghost" size="sm" onClick={() => toggleInvoiced(d)}>
                        {asBoardUpDetails(d.boardup_details).invoiced ? '✓ Invoiced' : 'Mark invoiced'}
                      </Button>
                    )}{' '}
                    {isOwner && (
                      <Button variant="ghost" size="sm" onClick={() => setDeleteTarget(d)}>
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
      {deleteTarget && (
        <Modal title={`Delete invoice #${deleteTarget.invoice_number ?? deleteTarget.draft_key}?`} onClose={() => !deleting && setDeleteTarget(null)}>
          <p>
            {deleteTarget.status === 'issued'
              ? `This invoice is issued${deleteTarget.amount_paid_cents > 0 ? ` and $${centsToDollars(deleteTarget.amount_paid_cents)} has been paid on it` : ''} — `
              : deleteTarget.status === 'void'
                ? 'This invoice is void — '
                : ''}
            Delete invoice #{deleteTarget.invoice_number ?? deleteTarget.draft_key} (
            {deleteTarget.customer_id ? customers[deleteTarget.customer_id]?.name ?? deleteTarget.property_address ?? '—' : deleteTarget.property_address ?? '—'}
            , ${centsToDollars(deleteTarget.total_cents)}) permanently? Its stored PDF and photos go with it. This cannot be undone.
          </p>
          <div className="btn-row">
            <Button variant="secondary" onClick={() => setDeleteTarget(null)} disabled={deleting}>
              Cancel
            </Button>
            <Button onClick={confirmDelete} disabled={deleting}>
              {deleting ? 'Deleting…' : 'Delete permanently'}
            </Button>
          </div>
        </Modal>
      )}
      {bulkTarget && (
        <Modal title={`Delete ${bulkTarget.length} invoices?`} onClose={() => !bulkDeleting && setBulkTarget(null)}>
          <p>
            Delete these invoices permanently? Their stored PDFs and photos go with them. This cannot be undone.
          </p>
          <p style={{ fontSize: 14 }}>
            {bulkTarget.map((d) => `#${d.invoice_number ?? d.draft_key} — ${d.status} — $${centsToDollars(d.total_cents)}`).join(', ')}
          </p>
          <div className="btn-row">
            <Button variant="secondary" onClick={() => setBulkTarget(null)} disabled={bulkDeleting}>
              Cancel
            </Button>
            <Button onClick={confirmBulkDelete} disabled={bulkDeleting}>
              {bulkDeleting ? 'Deleting…' : `Delete ${bulkTarget.length} invoices`}
            </Button>
          </div>
        </Modal>
      )}
    </div>
  );
}
