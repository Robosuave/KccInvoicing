import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useBusiness } from '../business/BusinessContext';
import type { Customer } from '../db/types';
import {
  archiveCustomer,
  copyCustomerToBusiness,
  createCustomer,
  listCustomers,
  updateCustomer,
} from '../data/customers';
import {
  Alert,
  Button,
  EmptyState,
  Field,
  Modal,
  SelectField,
  SetupRequired,
  TextArea,
  TextField,
} from '../components/ui';

const EMPTY: Record<string, string> = {
  name: '',
  contact_person: '',
  billing_line1: '',
  billing_line2: '',
  billing_city: '',
  billing_state: '',
  billing_zip: '',
  email: '',
  phone: '',
  shipping_line1: '',
  shipping_line2: '',
  shipping_city: '',
  shipping_state: '',
  shipping_zip: '',
  notes: '',
  default_payment_terms: '',
  tax_exempt: 'no',
};

function toForm(c?: Customer): Record<string, string> {
  if (!c) return { ...EMPTY };
  return {
    name: c.name,
    contact_person: c.contact_person ?? '',
    billing_line1: c.billing_line1 ?? '',
    billing_line2: c.billing_line2 ?? '',
    billing_city: c.billing_city ?? '',
    billing_state: c.billing_state ?? '',
    billing_zip: c.billing_zip ?? '',
    email: c.email ?? '',
    phone: c.phone ?? '',
    shipping_line1: c.shipping_line1 ?? '',
    shipping_line2: c.shipping_line2 ?? '',
    shipping_city: c.shipping_city ?? '',
    shipping_state: c.shipping_state ?? '',
    shipping_zip: c.shipping_zip ?? '',
    notes: c.notes ?? '',
    default_payment_terms: c.default_payment_terms ?? '',
    tax_exempt: c.tax_exempt ? 'yes' : 'no',
  };
}

const orNull = (v: string) => (v.trim() ? v.trim() : null);

export default function Customers() {
  const { activeBusiness, businesses, notConfigured, requestSwitch, loading: businessesLoading } = useBusiness();
  const [list, setList] = useState<Customer[]>([]);
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<Customer | 'new' | null>(null);
  const [form, setForm] = useState<Record<string, string>>(EMPTY);
  const [formError, setFormError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [copying, setCopying] = useState<Customer | null>(null);
  const [copyTarget, setCopyTarget] = useState('');

  const load = async (q: string) => {
    if (!activeBusiness) return;
    setLoading(true);
    try {
      setList(await listCustomers(activeBusiness.id, q));
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load customers.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load('');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeBusiness?.id]);

  useEffect(() => {
    const t = setTimeout(() => load(search), 300);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search]);

  if (notConfigured) return <SetupRequired what="Customer management" />;
  if (businessesLoading) return <p>Loading…</p>;
  if (!activeBusiness) return <EmptyState title="No business selected" body="Create a business first." />;

  const set = (k: string) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) =>
    setForm((f) => ({ ...f, [k]: e.target.value }));

  const openNew = () => {
    setForm({ ...EMPTY });
    setFormError(null);
    setEditing('new');
  };
  const openEdit = (c: Customer) => {
    setForm(toForm(c));
    setFormError(null);
    setEditing(c);
  };

  const save = async () => {
    if (!form.name.trim()) {
      setFormError('Customer name is required.');
      return;
    }
    setSaving(true);
    setFormError(null);
    try {
      const payload = {
        business_id: activeBusiness.id,
        name: form.name.trim(),
        contact_person: orNull(form.contact_person),
        billing_line1: orNull(form.billing_line1),
        billing_line2: orNull(form.billing_line2),
        billing_city: orNull(form.billing_city),
        billing_state: orNull(form.billing_state),
        billing_zip: orNull(form.billing_zip),
        email: orNull(form.email),
        phone: orNull(form.phone),
        shipping_line1: orNull(form.shipping_line1),
        shipping_line2: orNull(form.shipping_line2),
        shipping_city: orNull(form.shipping_city),
        shipping_state: orNull(form.shipping_state),
        shipping_zip: orNull(form.shipping_zip),
        notes: orNull(form.notes),
        default_payment_terms: orNull(form.default_payment_terms),
        tax_exempt: form.tax_exempt === 'yes',
      };
      if (editing === 'new') await createCustomer(payload);
      else if (editing) await updateCustomer(editing.id, payload);
      setEditing(null);
      await load(search);
    } catch (e) {
      setFormError(e instanceof Error ? e.message : 'Save failed.');
    } finally {
      setSaving(false);
    }
  };

  const doArchive = async (c: Customer) => {
    if (!window.confirm(`Archive ${c.name}? Their invoice history is kept.`)) return;
    await archiveCustomer(c.id);
    await load(search);
  };

  const doCopy = async () => {
    if (!copying || !copyTarget) return;
    try {
      await copyCustomerToBusiness(copying.id, copyTarget);
      setCopying(null);
      await requestSwitch(copyTarget);
    } catch (e) {
      alert(e instanceof Error ? e.message : 'Copy failed.');
    }
  };

  return (
    <div>
      <h1 className="page-title">Customers</h1>
      <p className="page-sub">
        Customers belong to <strong>{activeBusiness.display_name}</strong>. Editing a customer never
        changes already-issued invoices.
      </p>

      <div className="btn-row" style={{ marginBottom: 16 }}>
        <Button onClick={openNew}>Add customer</Button>
        <div style={{ flex: 1, maxWidth: 360 }}>
          <TextField
            placeholder="Search customers…"
            aria-label="Search customers"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
      </div>

      {error && <Alert kind="error">{error}</Alert>}
      {loading ? (
        <p>Loading…</p>
      ) : list.length === 0 ? (
        <EmptyState
          title={search ? 'No matches' : 'No customers yet'}
          body={search ? 'Try a different search.' : 'Add your first customer to start invoicing them.'}
          action={!search && <Button onClick={openNew}>Add customer</Button>}
        />
      ) : (
        <div className="table-wrap">
          <table className="grid">
            <thead>
              <tr>
                <th>Name</th>
                <th>Contact</th>
                <th>Billing address</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {list.map((c) => (
                <tr key={c.id}>
                  <td>
                    <strong>{c.name}</strong>
                    {c.tax_exempt && <div style={{ fontSize: 13, color: 'var(--muted)' }}>Tax-exempt</div>}
                  </td>
                  <td style={{ fontSize: 14 }}>
                    {c.contact_person && <div>{c.contact_person}</div>}
                    {c.phone && <div>{c.phone}</div>}
                    {c.email && <div>{c.email}</div>}
                  </td>
                  <td style={{ fontSize: 14 }}>
                    {[c.billing_line1, c.billing_line2].filter(Boolean).join(', ')}
                    <div style={{ color: 'var(--muted)' }}>
                      {[c.billing_city, c.billing_state, c.billing_zip].filter(Boolean).join(', ')}
                    </div>
                  </td>
                  <td style={{ whiteSpace: 'nowrap', textAlign: 'right' }}>
                    <Link className="btn btn-primary btn-sm" to={`/invoices/new?customer=${c.id}`}>
                      New invoice
                    </Link>{' '}
                    <Button variant="secondary" size="sm" onClick={() => openEdit(c)}>
                      Edit
                    </Button>{' '}
                    <Button variant="ghost" size="sm" onClick={() => { setCopying(c); setCopyTarget(''); }}>
                      Copy to…
                    </Button>{' '}
                    <Button variant="ghost" size="sm" onClick={() => doArchive(c)}>
                      Archive
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {editing && (
        <Modal title={editing === 'new' ? 'Add customer' : `Edit ${editing.name}`} onClose={() => setEditing(null)}>
          {formError && <Alert kind="error">{formError}</Alert>}
          <Field label="Customer full name *" htmlFor="c-name">
            <TextField id="c-name" value={form.name} onChange={set('name')} required />
          </Field>
          <div className="form-row">
            <Field label="Contact person" htmlFor="c-contact">
              <TextField id="c-contact" value={form.contact_person} onChange={set('contact_person')} />
            </Field>
            <Field label="Email" htmlFor="c-email">
              <TextField id="c-email" type="email" value={form.email} onChange={set('email')} />
            </Field>
            <Field label="Phone" htmlFor="c-phone">
              <TextField id="c-phone" type="tel" value={form.phone} onChange={set('phone')} />
            </Field>
          </div>
          <h3 style={{ margin: '8px 0' }}>Billing address</h3>
          <div className="form-row">
            <Field label="Street" htmlFor="c-b1">
              <TextField id="c-b1" value={form.billing_line1} onChange={set('billing_line1')} />
            </Field>
            <Field label="Street (line 2)" htmlFor="c-b2">
              <TextField id="c-b2" value={form.billing_line2} onChange={set('billing_line2')} />
            </Field>
          </div>
          <div className="form-row">
            <Field label="City" htmlFor="c-bc">
              <TextField id="c-bc" value={form.billing_city} onChange={set('billing_city')} />
            </Field>
            <Field label="State" htmlFor="c-bs">
              <TextField id="c-bs" value={form.billing_state} onChange={set('billing_state')} />
            </Field>
            <Field label="ZIP" htmlFor="c-bz">
              <TextField id="c-bz" value={form.billing_zip} onChange={set('billing_zip')} />
            </Field>
          </div>
          <h3 style={{ margin: '8px 0' }}>Shipping / service address (optional)</h3>
          <div className="form-row">
            <Field label="Street" htmlFor="c-s1">
              <TextField id="c-s1" value={form.shipping_line1} onChange={set('shipping_line1')} />
            </Field>
            <Field label="Street (line 2)" htmlFor="c-s2">
              <TextField id="c-s2" value={form.shipping_line2} onChange={set('shipping_line2')} />
            </Field>
          </div>
          <div className="form-row">
            <Field label="City" htmlFor="c-sc">
              <TextField id="c-sc" value={form.shipping_city} onChange={set('shipping_city')} />
            </Field>
            <Field label="State" htmlFor="c-ss">
              <TextField id="c-ss" value={form.shipping_state} onChange={set('shipping_state')} />
            </Field>
            <Field label="ZIP" htmlFor="c-sz">
              <TextField id="c-sz" value={form.shipping_zip} onChange={set('shipping_zip')} />
            </Field>
          </div>
          <div className="form-row">
            <Field label="Default payment terms" htmlFor="c-terms">
              <TextField id="c-terms" value={form.default_payment_terms} onChange={set('default_payment_terms')} />
            </Field>
            <Field label="Tax-exempt" htmlFor="c-te">
              <SelectField id="c-te" value={form.tax_exempt} onChange={set('tax_exempt')}>
                <option value="no">No</option>
                <option value="yes">Yes</option>
              </SelectField>
            </Field>
          </div>
          <Field label="Customer notes" htmlFor="c-notes" hint="Internal notes. Never printed on invoices.">
            <TextArea id="c-notes" value={form.notes} onChange={set('notes')} />
          </Field>
          <div className="btn-row">
            <Button onClick={save} disabled={saving}>
              {saving ? 'Saving…' : editing === 'new' ? 'Add customer' : 'Save changes'}
            </Button>
            <Button variant="secondary" onClick={() => setEditing(null)}>
              Cancel
            </Button>
          </div>
        </Modal>
      )}

      {copying && (
        <Modal title={`Copy ${copying.name} to another business`} onClose={() => setCopying(null)}>
          <p>
            This creates a separate copy under the other business. The two copies are independent —
            nothing is shared silently.
          </p>
          <Field label="Target business" htmlFor="copy-target">
            <SelectField id="copy-target" value={copyTarget} onChange={(e) => setCopyTarget(e.target.value)}>
              <option value="">Choose a business…</option>
              {businesses
                .filter((b) => b.id !== activeBusiness.id)
                .map((b) => (
                  <option key={b.id} value={b.id}>
                    {b.display_name}
                  </option>
                ))}
            </SelectField>
          </Field>
          <div className="btn-row">
            <Button onClick={doCopy} disabled={!copyTarget}>
              Copy customer
            </Button>
            <Button variant="secondary" onClick={() => setCopying(null)}>
              Cancel
            </Button>
          </div>
        </Modal>
      )}
    </div>
  );
}
