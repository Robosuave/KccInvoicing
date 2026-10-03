import { useEffect, useState } from 'react';
import { useBusiness } from '../business/BusinessContext';
import type { Item } from '../db/types';
import { archiveItem, createItem, listItems, updateItem } from '../data/items';
import { centsToDollars, dollarsToCents } from '../lib/money';
import {
  Alert,
  Button,
  EmptyState,
  Field,
  Modal,
  SetupRequired,
  TextArea,
  TextField,
} from '../components/ui';

interface ItemForm {
  name: string;
  description: string;
  item_code: string;
  unit_label: string;
  rate: string;
  tax_rate: string;
  active: boolean;
}

const EMPTY: ItemForm = {
  name: '',
  description: '',
  item_code: '',
  unit_label: 'each',
  rate: '',
  tax_rate: '',
  active: true,
};

function toForm(i?: Item): ItemForm {
  if (!i) return { ...EMPTY };
  return {
    name: i.name,
    description: i.description ?? '',
    item_code: i.item_code ?? '',
    unit_label: i.unit_label,
    rate: centsToDollars(i.default_rate_cents),
    tax_rate: String(Number(i.default_tax_rate) * 100),
    active: i.active,
  };
}

export default function Items() {
  const { activeBusiness, notConfigured } = useBusiness();
  const [list, setList] = useState<Item[]>([]);
  const [search, setSearch] = useState('');
  const [showInactive, setShowInactive] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<Item | 'new' | null>(null);
  const [form, setForm] = useState<ItemForm>(EMPTY);
  const [formError, setFormError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const load = async () => {
    if (!activeBusiness) return;
    setLoading(true);
    try {
      setList(await listItems(activeBusiness.id, { includeInactive: showInactive, search }));
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load items.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeBusiness?.id, showInactive]);

  useEffect(() => {
    const t = setTimeout(load, 300);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search]);

  if (notConfigured) return <SetupRequired what="The item catalog" />;
  if (!activeBusiness) return <EmptyState title="No business selected" body="Create a business first." />;

  const set = (k: keyof ItemForm) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) =>
    setForm((f) => ({ ...f, [k]: e.target.type === 'checkbox' ? (e.target as HTMLInputElement).checked : e.target.value }));

  const openNew = () => {
    setForm({ ...EMPTY });
    setFormError(null);
    setEditing('new');
  };
  const openEdit = (i: Item) => {
    setForm(toForm(i));
    setFormError(null);
    setEditing(i);
  };

  const save = async () => {
    if (!form.name.trim()) {
      setFormError('Item name is required.');
      return;
    }
    let rateCents = 0;
    try {
      rateCents = dollarsToCents(form.rate.trim() || '0');
    } catch {
      setFormError('Rate must be a valid dollar amount, e.g. 150.00.');
      return;
    }
    setSaving(true);
    setFormError(null);
    try {
      const payload = {
        business_id: activeBusiness.id,
        name: form.name.trim(),
        description: form.description.trim() || null,
        item_code: form.item_code.trim() || null,
        unit_label: form.unit_label.trim() || 'each',
        default_rate_cents: rateCents,
        default_tax_rate: String(Number(form.tax_rate || '0') / 100),
        active: form.active,
      };
      if (editing === 'new') await createItem(payload);
      else if (editing) await updateItem(editing.id, payload);
      setEditing(null);
      await load();
    } catch (e) {
      setFormError(e instanceof Error ? e.message : 'Save failed.');
    } finally {
      setSaving(false);
    }
  };

  const doArchive = async (i: Item) => {
    if (!window.confirm(`Archive "${i.name}"? Old invoices keep their original prices.`)) return;
    await archiveItem(i.id);
    await load();
  };

  return (
    <div>
      <h1 className="page-title">Products &amp; services</h1>
      <p className="page-sub">
        Reusable catalog for <strong>{activeBusiness.display_name}</strong>. Changing an item never
        alters already-issued invoices.
      </p>

      <div className="btn-row" style={{ marginBottom: 16 }}>
        <Button onClick={openNew}>Add item</Button>
        <div style={{ flex: 1, maxWidth: 360 }}>
          <TextField
            placeholder="Search items…"
            aria-label="Search items"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        <label className="checkbox-row" style={{ minHeight: 0 }}>
          <input type="checkbox" checked={showInactive} onChange={(e) => setShowInactive(e.target.checked)} />
          Show archived
        </label>
      </div>

      {error && <Alert kind="error">{error}</Alert>}
      {loading ? (
        <p>Loading…</p>
      ) : list.length === 0 ? (
        <EmptyState
          title={search ? 'No matches' : 'No items yet'}
          body={search ? 'Try a different search.' : 'Add services and products you bill for repeatedly.'}
          action={!search && <Button onClick={openNew}>Add item</Button>}
        />
      ) : (
        <div className="table-wrap">
          <table className="grid">
            <thead>
              <tr>
                <th>Item</th>
                <th>Rate</th>
                <th>Unit</th>
                <th>Status</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {list.map((i) => (
                <tr key={i.id}>
                  <td>
                    <strong>{i.name}</strong>
                    {i.item_code && <div style={{ fontSize: 13, color: 'var(--muted)' }}>Code: {i.item_code}</div>}
                    {i.description && <div style={{ fontSize: 13, color: 'var(--muted)' }}>{i.description}</div>}
                  </td>
                  <td>${centsToDollars(i.default_rate_cents)}</td>
                  <td style={{ fontSize: 14 }}>{i.unit_label}</td>
                  <td>{i.active ? <span className="badge badge-issued">Active</span> : <span className="badge badge-void">Archived</span>}</td>
                  <td style={{ whiteSpace: 'nowrap', textAlign: 'right' }}>
                    <Button variant="secondary" size="sm" onClick={() => openEdit(i)}>
                      Edit
                    </Button>{' '}
                    {i.active && (
                      <Button variant="ghost" size="sm" onClick={() => doArchive(i)}>
                        Archive
                      </Button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {editing && (
        <Modal title={editing === 'new' ? 'Add item' : `Edit ${editing.name}`} onClose={() => setEditing(null)}>
          {formError && <Alert kind="error">{formError}</Alert>}
          <Field label="Item / service name *" htmlFor="i-name">
            <TextField id="i-name" value={form.name} onChange={set('name')} required />
          </Field>
          <Field label="Description" htmlFor="i-desc">
            <TextArea id="i-desc" value={form.description} onChange={set('description')} />
          </Field>
          <div className="form-row">
            <Field label="Item code (optional)" htmlFor="i-code">
              <TextField id="i-code" value={form.item_code} onChange={set('item_code')} />
            </Field>
            <Field label="Unit label" htmlFor="i-unit" hint='e.g. hours, each, visit, month'>
              <TextField id="i-unit" value={form.unit_label} onChange={set('unit_label')} />
            </Field>
          </div>
          <div className="form-row">
            <Field label="Default rate $" htmlFor="i-rate" hint="e.g. 150.00">
              <TextField id="i-rate" inputMode="decimal" value={form.rate} onChange={set('rate')} />
            </Field>
            <Field label="Default tax % (optional)" htmlFor="i-tax" hint="e.g. 7 for 7%">
              <TextField id="i-tax" inputMode="decimal" value={form.tax_rate} onChange={set('tax_rate')} />
            </Field>
          </div>
          <label className="checkbox-row">
            <input type="checkbox" checked={form.active} onChange={set('active')} />
            Active (uncheck to archive)
          </label>
          <div className="btn-row" style={{ marginTop: 8 }}>
            <Button onClick={save} disabled={saving}>
              {saving ? 'Saving…' : editing === 'new' ? 'Add item' : 'Save changes'}
            </Button>
            <Button variant="secondary" onClick={() => setEditing(null)}>
              Cancel
            </Button>
          </div>
        </Modal>
      )}
    </div>
  );
}
