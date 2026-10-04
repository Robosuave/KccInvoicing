import { useState } from 'react';
import { useBusiness } from '../business/BusinessContext';
import type { Business, InvoiceTemplate } from '../db/types';
import {
  archiveBusiness,
  createBusiness,
  getLogoUrl,
  updateBusiness,
  uploadLogo,
} from '../data/businesses';
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
  display_name: '',
  legal_name: '',
  header_line: '',
  address_line1: '',
  address_line2: '',
  city: '',
  state: '',
  zip: '',
  phone: '',
  email: '',
  website: '',
  tax_id: '',
  currency: 'USD',
  payment_terms: 'Due upon receipt',
  invoice_notes: '',
  payment_instructions: '',
  invoice_prefix: '',
  next_number: '1',
  default_tax_rate: '0',
  default_email_subject: '',
  default_email_message: '',
  default_template: 'standard',
  invoice_style: 'classic',
};

function toForm(b?: Business): Record<string, string> {
  if (!b) return { ...EMPTY };
  return {
    display_name: b.display_name,
    legal_name: b.legal_name ?? '',
    header_line: b.header_line ?? '',
    address_line1: b.address_line1 ?? '',
    address_line2: b.address_line2 ?? '',
    city: b.city ?? '',
    state: b.state ?? '',
    zip: b.zip ?? '',
    phone: b.phone ?? '',
    email: b.email ?? '',
    website: b.website ?? '',
    tax_id: b.tax_id ?? '',
    currency: b.currency,
    payment_terms: b.payment_terms,
    invoice_notes: b.invoice_notes ?? '',
    payment_instructions: b.payment_instructions ?? '',
    invoice_prefix: b.invoice_prefix,
    next_number: String(b.next_number),
    default_tax_rate: String(Number(b.default_tax_rate) * 100),
    default_email_subject: b.default_email_subject ?? '',
    default_email_message: b.default_email_message ?? '',
    default_template: (b as { default_template?: string }).default_template ?? 'standard',
    invoice_style: (b as { invoice_style?: string }).invoice_style ?? 'classic',
  };
}

export default function Businesses() {
  const { workspace, businesses, activeBusiness, refresh, notConfigured, loading } = useBusiness();
  const [editing, setEditing] = useState<Business | 'new' | null>(null);
  const [form, setForm] = useState<Record<string, string>>(EMPTY);
  const [formError, setFormError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [archiving, setArchiving] = useState<Business | null>(null);
  const [logoFile, setLogoFile] = useState<File | null>(null);
  const [logoPreview, setLogoPreview] = useState<string | null>(null);

  if (notConfigured) return <SetupRequired what="Business management" />;

  const openNew = () => {
    setForm({ ...EMPTY });
    setLogoFile(null);
    setLogoPreview(null);
    setFormError(null);
    setEditing('new');
  };

  const openEdit = async (b: Business) => {
    setForm(toForm(b));
    setLogoFile(null);
    setFormError(null);
    setEditing(b);
    if (b.logo_path) {
      setLogoPreview(await getLogoUrl(b.logo_path));
    } else {
      setLogoPreview(null);
    }
  };

  const set = (k: string) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) =>
    setForm((f) => ({ ...f, [k]: e.target.value }));

  const save = async () => {
    if (!workspace) return;
    if (!form.display_name.trim()) {
      setFormError('Display name is required.');
      return;
    }
    const nextNum = parseInt(form.next_number, 10);
    if (!Number.isInteger(nextNum) || nextNum < 1) {
      setFormError('Next invoice number must be a whole number of 1 or more.');
      return;
    }
    setSaving(true);
    setFormError(null);
    try {
      const payload = {
        workspace_id: workspace.id,
        display_name: form.display_name.trim(),
        legal_name: form.legal_name.trim() || null,
        header_line: form.header_line.trim() || null,
        address_line1: form.address_line1.trim() || null,
        address_line2: form.address_line2.trim() || null,
        city: form.city.trim() || null,
        state: form.state.trim() || null,
        zip: form.zip.trim() || null,
        phone: form.phone.trim() || null,
        email: form.email.trim() || null,
        website: form.website.trim() || null,
        tax_id: form.tax_id.trim() || null,
        currency: form.currency,
        payment_terms: form.payment_terms.trim() || 'Due upon receipt',
        invoice_notes: form.invoice_notes.trim() || null,
        payment_instructions: form.payment_instructions.trim() || null,
        invoice_prefix: form.invoice_prefix,
        next_number: nextNum,
        default_tax_rate: String(Number(form.default_tax_rate || '0') / 100),
        default_email_subject: form.default_email_subject.trim() || null,
        default_email_message: form.default_email_message.trim() || null,
        default_template: (form.default_template === 'commission' ? 'commission' : 'standard') as InvoiceTemplate,
        invoice_style: ['classic', 'modern', 'compact'].includes(form.invoice_style) ? form.invoice_style : 'classic',
      };
      let business: Business;
      if (editing === 'new') {
        business = await createBusiness(payload);
      } else if (editing) {
        business = await updateBusiness(editing.id, payload);
      } else {
        return;
      }
      if (logoFile) {
        const path = await uploadLogo(workspace.id, business.id, logoFile);
        await updateBusiness(business.id, { logo_path: path });
      }
      setEditing(null);
      await refresh();
    } catch (e) {
      setFormError(e instanceof Error ? e.message : 'Save failed.');
    } finally {
      setSaving(false);
    }
  };

  const doArchive = async () => {
    if (!archiving) return;
    try {
      await archiveBusiness(archiving.id);
      setArchiving(null);
      await refresh();
    } catch (e) {
      alert(e instanceof Error ? e.message : 'Archive failed.');
    }
  };

  return (
    <div>
      <h1 className="page-title">Businesses</h1>
      <p className="page-sub">
        Each business has its own header, numbering, customers, items, and templates. Active business:{' '}
        <strong>{activeBusiness?.display_name ?? 'none'}</strong>
      </p>

      <div className="btn-row" style={{ marginBottom: 20 }}>
        <Button onClick={openNew}>Add business</Button>
      </div>

      {loading ? (
        <p>Loading…</p>
      ) : businesses.length === 0 ? (
        <EmptyState
          title="No businesses yet"
          body="Add your first business — for example, Kaleky Computer Consulting Inc. You can add Dania Realty Inc as a second business with its own invoice header."
          action={<Button onClick={openNew}>Add business</Button>}
        />
      ) : (
        <div className="table-wrap">
          <table className="grid">
            <thead>
              <tr>
                <th>Business</th>
                <th>Contact</th>
                <th>Numbering</th>
                <th>Default tax</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {businesses.map((b) => (
                <tr key={b.id}>
                  <td>
                    <strong>{b.display_name}</strong>
                    {b.legal_name && <div style={{ color: 'var(--muted)', fontSize: 13 }}>{b.legal_name}</div>}
                    <div style={{ color: 'var(--muted)', fontSize: 13 }}>
                      {[b.city, b.state].filter(Boolean).join(', ')}
                    </div>
                  </td>
                  <td style={{ fontSize: 14 }}>
                    {b.phone && <div>{b.phone}</div>}
                    {b.email && <div>{b.email}</div>}
                  </td>
                  <td style={{ fontSize: 14 }}>
                    {b.invoice_prefix}… next #{b.next_number}
                  </td>
                  <td style={{ fontSize: 14 }}>{(Number(b.default_tax_rate) * 100).toFixed(2)}%</td>
                  <td style={{ whiteSpace: 'nowrap', textAlign: 'right' }}>
                    <Button variant="secondary" size="sm" onClick={() => openEdit(b)}>
                      Edit
                    </Button>{' '}
                    <Button variant="ghost" size="sm" onClick={() => setArchiving(b)}>
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
        <Modal title={editing === 'new' ? 'Add business' : `Edit ${editing.display_name}`} onClose={() => setEditing(null)}>
          {formError && <Alert kind="error">{formError}</Alert>}
          <div className="form-row">
            <Field label="Display name *" htmlFor="b-display">
              <TextField id="b-display" value={form.display_name} onChange={set('display_name')} required />
            </Field>
            <Field label="Legal business name" htmlFor="b-legal">
              <TextField id="b-legal" value={form.legal_name} onChange={set('legal_name')} />
            </Field>
            <Field label="Header line (under business name on invoices)" htmlFor="b-headerline">
              <TextField id="b-headerline" value={form.header_line} onChange={set('header_line')} placeholder="Robert Kaleky, Broker" />
            </Field>
          </div>
          <div className="form-row">
            <Field label="Address line 1" htmlFor="b-a1">
              <TextField id="b-a1" value={form.address_line1} onChange={set('address_line1')} />
            </Field>
            <Field label="Address line 2" htmlFor="b-a2">
              <TextField id="b-a2" value={form.address_line2} onChange={set('address_line2')} />
            </Field>
          </div>
          <div className="form-row">
            <Field label="City" htmlFor="b-city">
              <TextField id="b-city" value={form.city} onChange={set('city')} />
            </Field>
            <Field label="State" htmlFor="b-state">
              <TextField id="b-state" value={form.state} onChange={set('state')} />
            </Field>
            <Field label="ZIP" htmlFor="b-zip">
              <TextField id="b-zip" value={form.zip} onChange={set('zip')} />
            </Field>
          </div>
          <div className="form-row">
            <Field label="Phone" htmlFor="b-phone">
              <TextField id="b-phone" type="tel" value={form.phone} onChange={set('phone')} />
            </Field>
            <Field label="Email" htmlFor="b-email">
              <TextField id="b-email" type="email" value={form.email} onChange={set('email')} />
            </Field>
            <Field label="Website" htmlFor="b-web">
              <TextField id="b-web" value={form.website} onChange={set('website')} />
            </Field>
          </div>
          <div className="form-row">
            <Field label="Tax / registration ID" htmlFor="b-taxid">
              <TextField id="b-taxid" value={form.tax_id} onChange={set('tax_id')} />
            </Field>
            <Field label="Default currency" htmlFor="b-cur">
              <SelectField id="b-cur" value={form.currency} onChange={set('currency')}>
                <option value="USD">USD — US Dollar</option>
              </SelectField>
            </Field>
            <Field label="Default payment terms" htmlFor="b-terms">
              <TextField id="b-terms" value={form.payment_terms} onChange={set('payment_terms')} />
            </Field>
          </div>
          <div className="form-row">
            <Field label="Invoice number prefix" htmlFor="b-prefix" hint="Added before the number, e.g. DR-">
              <TextField id="b-prefix" value={form.invoice_prefix} onChange={set('invoice_prefix')} />
            </Field>
            <Field label="Next invoice number *" htmlFor="b-next">
              <TextField id="b-next" inputMode="numeric" value={form.next_number} onChange={set('next_number')} />
            </Field>
            <Field label="Default tax rate %" htmlFor="b-taxrate" hint="e.g. 7 for 7%">
              <TextField id="b-taxrate" inputMode="decimal" value={form.default_tax_rate} onChange={set('default_tax_rate')} />
            </Field>
            <Field label="Default invoice type" htmlFor="b-template" hint="Pre-selected when creating a new invoice.">
              <SelectField id="b-template" value={form.default_template} onChange={set('default_template')}>
                <option value="standard">Standard invoice (line items)</option>
                <option value="commission">Commission / wire instructions</option>
              </SelectField>
            </Field>
            <Field label="Invoice visual style" htmlFor="b-style" hint="Used for generated PDFs.">
              <SelectField id="b-style" value={form.invoice_style} onChange={set('invoice_style')}>
                <option value="classic">Classic</option>
                <option value="modern">Modern</option>
                <option value="compact">Compact</option>
              </SelectField>
            </Field>
          </div>
          <Field label="Default invoice notes" htmlFor="b-notes">
            <TextArea id="b-notes" value={form.invoice_notes} onChange={set('invoice_notes')} />
          </Field>
          <Field label="Default payment instructions" htmlFor="b-payinst" hint="For Dania Realty: wire instructions and Zelle.">
            <TextArea id="b-payinst" value={form.payment_instructions} onChange={set('payment_instructions')} />
          </Field>
          <div className="form-row">
            <Field label="Default email subject" htmlFor="b-esub">
              <TextField id="b-esub" value={form.default_email_subject} onChange={set('default_email_subject')} />
            </Field>
          </div>
          <Field label="Default email message" htmlFor="b-emsg">
            <TextArea id="b-emsg" value={form.default_email_message} onChange={set('default_email_message')} />
          </Field>
          <Field
            label="Logo"
            htmlFor="b-logo"
            hint="Square-ish image, under 2 MB. Stored privately."
          >
            {logoPreview && (
              <img src={logoPreview} alt="Current logo" style={{ maxHeight: 80, marginBottom: 8, display: 'block' }} />
            )}
            <input
              id="b-logo"
              type="file"
              accept="image/*"
              className="input"
              onChange={(e) => setLogoFile(e.target.files?.[0] ?? null)}
            />
          </Field>
          <div className="btn-row">
            <Button onClick={save} disabled={saving}>
              {saving ? 'Saving…' : editing === 'new' ? 'Add business' : 'Save changes'}
            </Button>
            <Button variant="secondary" onClick={() => setEditing(null)}>
              Cancel
            </Button>
          </div>
        </Modal>
      )}

      {archiving && (
        <Modal title={`Archive ${archiving.display_name}?`} onClose={() => setArchiving(null)}>
          <p>
            Archiving hides <strong>{archiving.display_name}</strong> from the business switcher but keeps
            all of its historical records. This is reversible.
          </p>
          <div className="btn-row">
            <Button variant="danger" onClick={doArchive}>
              Archive {archiving.display_name}
            </Button>
            <Button variant="secondary" onClick={() => setArchiving(null)}>
              Cancel
            </Button>
          </div>
        </Modal>
      )}
    </div>
  );
}
