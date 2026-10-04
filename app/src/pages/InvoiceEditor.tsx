import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { useBusiness } from '../business/BusinessContext';
import type { Business, Customer, Item } from '../db/types';
import { createDraft, getDraft, previewTotals, saveDraft, type DraftInput } from '../data/drafts';
import { issueInvoice, previewNextNumber } from '../data/issuance';
import { renderInvoicePdfBlob, storeIssuedPdf } from '../pdf/service';
import { TEMPLATES, isTemplateId, type TemplateId } from '../templates/templates';
import { listCustomers } from '../data/customers';
import { listItems } from '../data/items';
import { centsToDollars, dollarsToCents, multiplyQuantity } from '../lib/money';
import {
  Alert,
  Button,
  EmptyState,
  Field,
  Modal,
  SaveStatusIndicator,
  SelectField,
  SetupRequired,
  TextArea,
  TextField,
  type SaveStatus,
} from '../components/ui';

interface LineState {
  key: string;
  itemId: string | null;
  description: string;
  quantity: string;
  unitLabel: string;
  unitPrice: string;
  discount: string;
  taxRate: string; // percent, '' = use invoice rate
}

type DiscountMode = 'none' | 'invoice' | 'lines';

const newLine = (): LineState => ({
  key: Math.random().toString(36).slice(2),
  itemId: null,
  description: '',
  quantity: '1',
  unitLabel: 'each',
  unitPrice: '',
  discount: '',
  taxRate: '',
});

const pctToRate = (pct: string): string => {
  const t = pct.trim();
  if (!t) return '0';
  return String(Number(t) / 100);
};
const rateToPct = (rate: string): string => String(Number(rate) * 100);

function money(n: number): string {
  return `$${centsToDollars(n)}`;
}

export default function InvoiceEditor() {
  const { id } = useParams();
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const { activeBusiness, workspace, notConfigured, setEditorDirty, onSaveDraftRef } = useBusiness();
  const isNew = !id || id === 'new';

  const [draftId, setDraftId] = useState<string | null>(isNew ? null : (id as string));
  const [expectedUpdatedAt, setExpectedUpdatedAt] = useState<string>(new Date(0).toISOString());
  const [loading, setLoading] = useState(!isNew);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [customers, setCustomers] = useState<Customer[]>([]);
  const [catalog, setCatalog] = useState<Item[]>([]);

  const [customerId, setCustomerId] = useState('');
  const [invoiceDate, setInvoiceDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [dueDate, setDueDate] = useState('');
  const [poNumber, setPoNumber] = useState('');
  const [serviceDate, setServiceDate] = useState('');
  const [servicePeriod, setServicePeriod] = useState('');
  const [lines, setLines] = useState<LineState[]>([newLine()]);
  const [discountMode, setDiscountMode] = useState<DiscountMode>('none');
  const [invoiceDiscountPct, setInvoiceDiscountPct] = useState('');
  const [invoiceTaxPct, setInvoiceTaxPct] = useState('');
  const [useTax, setUseTax] = useState(false);
  const [shipping, setShipping] = useState('');
  const [notes, setNotes] = useState('');
  const [terms, setTerms] = useState('');
  const [paymentInstructions, setPaymentInstructions] = useState('');

  const [dirty, setDirty] = useState(false);
  const [saveStatus, setSaveStatus] = useState<SaveStatus>('idle');
  const [saveMessage, setSaveMessage] = useState<string | undefined>();
  const [errors, setErrors] = useState<string[]>([]);
  const [issueOpen, setIssueOpen] = useState(false);
  const [issueBusy, setIssueBusy] = useState(false);
  const [templateId, setTemplateId] = useState<TemplateId>('classic');
  const dirtyRef = useRef(false);
  const stateRef = useRef({});

  const markDirty = useCallback(() => {
    dirtyRef.current = true;
    setDirty(true);
    setEditorDirty(true);
    setSaveStatus('idle');
  }, [setEditorDirty]);

  /* ---------- load ---------- */

  useEffect(() => {
    if (!activeBusiness) return;
    Promise.all([listCustomers(activeBusiness.id), listItems(activeBusiness.id)])
      .then(([c, i]) => {
        setCustomers(c);
        setCatalog(i);
      })
      .catch(() => {});
  }, [activeBusiness]);

  useEffect(() => {
    if (isNew || !activeBusiness) return;
    setLoading(true);
    getDraft(id as string)
      .then(({ invoice, lines: dbLines }) => {
        if (invoice.business_id !== activeBusiness.id) {
          setLoadError('This draft belongs to a different business.');
          return;
        }
        if (invoice.status !== 'draft') {
          // Issued/void invoices open read-only — never in the editor.
          navigate(`/invoices/${id}/view`, { replace: true });
          return;
        }
        setDraftId(invoice.id);
        setExpectedUpdatedAt(invoice.updated_at);
        setCustomerId(invoice.customer_id ?? '');
        setInvoiceDate(invoice.invoice_date);
        setDueDate(invoice.due_date ?? '');
        setPoNumber(invoice.po_number ?? '');
        setServiceDate(invoice.service_date ?? '');
        setServicePeriod(invoice.service_period ?? '');
        setLines(
          dbLines.map((l) => ({
            key: l.id,
            itemId: l.item_id,
            description: l.description,
            quantity: l.quantity,
            unitLabel: l.unit_label,
            unitPrice: centsToDollars(l.unit_price_cents),
            discount: l.discount_cents ? centsToDollars(l.discount_cents) : '',
            taxRate: l.tax_rate && l.tax_rate !== '0' ? rateToPct(l.tax_rate) : '',
          })),
        );
        setNotes(invoice.notes ?? '');
        setTerms(invoice.terms ?? '');
        setPaymentInstructions(invoice.payment_instructions ?? '');
        // discount mode is not stored in phase 1; default to none
      })
      .catch((e) => setLoadError(e instanceof Error ? e.message : 'Failed to load draft.'))
      .finally(() => setLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, activeBusiness?.id]);

  /* defaults for a new draft */
  useEffect(() => {
    if (!isNew || !activeBusiness) return;
    setNotes((v) => v || activeBusiness.invoice_notes || '');
    setTerms((v) => v || activeBusiness.payment_terms || '');
    setPaymentInstructions((v) => v || activeBusiness.payment_instructions || '');
    setInvoiceTaxPct((v) => v || (Number(activeBusiness.default_tax_rate) > 0 ? rateToPct(activeBusiness.default_tax_rate) : ''));
    if (isTemplateId(activeBusiness.default_template_id)) setTemplateId(activeBusiness.default_template_id);
    const pre = searchParams.get('customer');
    if (pre) setCustomerId(pre);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isNew, activeBusiness?.id]);

  /* customer default terms */
  useEffect(() => {
    if (!customerId || !isNew) return;
    const c = customers.find((x) => x.id === customerId);
    if (c?.default_payment_terms) setTerms(c.default_payment_terms);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [customerId]);

  /* ---------- draft input + validation ---------- */

  const toDraftInput = useCallback((): DraftInput => {
    if (!activeBusiness) throw new Error('No business selected.');
    return {
      business_id: activeBusiness.id,
      customer_id: customerId || null,
      invoice_date: invoiceDate,
      due_date: dueDate || null,
      po_number: poNumber || null,
      service_date: serviceDate || null,
      service_period: servicePeriod || null,
      currency: 'USD',
      invoice_discount_rate: discountMode === 'invoice' && invoiceDiscountPct.trim() ? pctToRate(invoiceDiscountPct) : undefined,
      invoice_tax_rate: useTax && invoiceTaxPct.trim() ? pctToRate(invoiceTaxPct) : undefined,
      shipping_cents: shipping.trim() ? dollarsToCents(shipping.trim()) : 0,
      notes: notes || null,
      terms: terms || null,
      payment_instructions: paymentInstructions || null,
      lines: lines.map((l) => ({
        item_id: l.itemId,
        description: l.description.trim(),
        quantity: l.quantity.trim() || '1',
        unit_label: l.unitLabel.trim() || 'each',
        unit_price_cents: dollarsToCents(l.unitPrice.trim() || '0'),
        discount_cents: discountMode === 'lines' && l.discount.trim() ? dollarsToCents(l.discount.trim()) : 0,
        tax_rate: l.taxRate.trim() ? pctToRate(l.taxRate) : undefined,
      })),
    };
  }, [activeBusiness, customerId, invoiceDate, dueDate, poNumber, serviceDate, servicePeriod, lines, discountMode, invoiceDiscountPct, useTax, invoiceTaxPct, shipping, notes, terms, paymentInstructions]);

  const validate = useCallback((): string[] => {
    const errs: string[] = [];
    if (!customerId) errs.push('Choose a customer.');
    if (!invoiceDate) errs.push('Invoice date is required.');
    const nonEmpty = lines.filter((l) => l.description.trim() || l.unitPrice.trim());
    if (nonEmpty.length === 0) errs.push('Add at least one line item.');
    lines.forEach((l, i) => {
      if (!l.description.trim() && !l.unitPrice.trim()) return; // empty row is ignored
      if (!l.description.trim()) errs.push(`Line ${i + 1}: description is required.`);
      if (!/^\d+(\.\d+)?$/.test(l.quantity.trim()) || Number(l.quantity) <= 0)
        errs.push(`Line ${i + 1}: quantity must be a positive number.`);
      try {
        dollarsToCents(l.unitPrice.trim() || '0');
      } catch {
        errs.push(`Line ${i + 1}: unit price must be a valid amount.`);
      }
      if (discountMode === 'lines' && l.discount.trim()) {
        try {
          dollarsToCents(l.discount.trim());
        } catch {
          errs.push(`Line ${i + 1}: discount must be a valid amount.`);
        }
      }
    });
    if (discountMode === 'invoice' && invoiceDiscountPct.trim() && !/^\d+(\.\d+)?$/.test(invoiceDiscountPct.trim()))
      errs.push('Invoice discount must be a valid percent.');
    if (useTax && invoiceTaxPct.trim() && !/^\d+(\.\d+)?$/.test(invoiceTaxPct.trim()))
      errs.push('Tax rate must be a valid percent.');
    if (shipping.trim()) {
      try {
        dollarsToCents(shipping.trim());
      } catch {
        errs.push('Shipping & handling must be a valid amount.');
      }
    }
    try {
      toDraftInput();
      previewTotals(toDraftInput());
    } catch (e) {
      errs.push(e instanceof Error ? e.message : 'Totals could not be calculated.');
    }
    return errs;
  }, [customerId, invoiceDate, lines, discountMode, invoiceDiscountPct, useTax, invoiceTaxPct, shipping, toDraftInput]);

  const totals = useMemo(() => {
    try {
      return previewTotals(toDraftInput());
    } catch {
      return null;
    }
  }, [toDraftInput]);

  /* ---------- save ---------- */

  const doSave = useCallback(
    async (manual: boolean): Promise<boolean> => {
      const errs = validate();
      if (errs.length > 0) {
        if (manual) setErrors(errs);
        return false;
      }
      setErrors([]);
      setSaveStatus('saving');
      setSaveMessage(undefined);
      try {
        const input = toDraftInput();
        // strip fully-empty rows
        input.lines = input.lines.filter((l) => l.description.trim() || l.unit_price_cents > 0);
        if (draftId) {
          const updated = await saveDraft(draftId, input, expectedUpdatedAt);
          setExpectedUpdatedAt(updated.updated_at);
        } else {
          const created = await createDraft(input);
          setDraftId(created.id);
          setExpectedUpdatedAt(created.updated_at);
          navigate(`/invoices/${created.id}`, { replace: true });
        }
        dirtyRef.current = false;
        setDirty(false);
        setEditorDirty(false);
        setSaveStatus('saved');
        return true;
      } catch (e) {
        setSaveStatus('failed');
        setSaveMessage(e instanceof Error ? e.message : 'Save failed.');
        if (manual) setErrors([e instanceof Error ? e.message : 'Save failed.']);
        return false;
      }
    },
    [validate, toDraftInput, draftId, expectedUpdatedAt, navigate, setEditorDirty],
  );

  // autosave
  useEffect(() => {
    if (!dirty) return;
    const t = setTimeout(() => {
      doSave(false);
    }, 1500);
    return () => clearTimeout(t);
  }, [dirty, doSave, stateRef.current]);

  // expose manual save to the business-switch guard
  useEffect(() => {
    onSaveDraftRef.current = () => doSave(true);
    return () => {
      onSaveDraftRef.current = null;
    };
  }, [doSave, onSaveDraftRef]);

  /** Issue the draft: save, assign the number atomically, snapshot, store the PDF. */
  const doIssue = useCallback(async (): Promise<void> => {
    if (!draftId || !workspace || !activeBusiness) return;
    setIssueBusy(true);
    try {
      const saved = await doSave(true);
      if (!saved) {
        setIssueBusy(false);
        setIssueOpen(false);
        return;
      }
      const { snapshot } = await issueInvoice(draftId, templateId);
      // Generate and privately store the issued PDF. A failure here does not
      // un-issue the invoice — the detail page offers a retry.
      try {
        const blob = await renderInvoicePdfBlob(snapshot, templateId);
        await storeIssuedPdf(workspace.id, activeBusiness.id, draftId, blob);
      } catch (e) {
        console.error('Issued PDF could not be stored:', e);
      }
      dirtyRef.current = false;
      setDirty(false);
      setEditorDirty(false);
      navigate(`/invoices/${draftId}/view`);
    } catch (e) {
      setErrors([e instanceof Error ? e.message : 'Issuing failed.']);
      setIssueOpen(false);
    } finally {
      setIssueBusy(false);
    }
  }, [draftId, workspace, activeBusiness, doSave, templateId, navigate, setEditorDirty]);

  // warn before leaving with unsaved changes
  useEffect(() => {
    const onBefore = (e: BeforeUnloadEvent) => {
      if (dirtyRef.current) e.preventDefault();
    };
    window.addEventListener('beforeunload', onBefore);
    return () => window.removeEventListener('beforeunload', onBefore);
  }, []);

  // keep a changing ref so the autosave effect re-arms on every keystroke
  stateRef.current = { lines, customerId, invoiceDate };

  /* ---------- line ops ---------- */

  const updateLine = (key: string, patch: Partial<LineState>) => {
    setLines((ls) => ls.map((l) => (l.key === key ? { ...l, ...patch } : l)));
    markDirty();
  };

  const addLine = (afterKey?: string) => {
    const nl = newLine();
    setLines((ls) => {
      if (!afterKey) return [...ls, nl];
      const i = ls.findIndex((l) => l.key === afterKey);
      return [...ls.slice(0, i + 1), nl, ...ls.slice(i + 1)];
    });
    markDirty();
    setTimeout(() => document.getElementById(`desc-${nl.key}`)?.focus(), 50);
  };

  const removeLine = (key: string) => {
    setLines((ls) => (ls.length > 1 ? ls.filter((l) => l.key !== key) : ls));
    markDirty();
  };

  const duplicateLine = (key: string) => {
    setLines((ls) => {
      const i = ls.findIndex((l) => l.key === key);
      if (i < 0) return ls;
      const copy = { ...ls[i], key: Math.random().toString(36).slice(2) };
      return [...ls.slice(0, i + 1), copy, ...ls.slice(i + 1)];
    });
    markDirty();
  };

  const moveLine = (key: string, dir: -1 | 1) => {
    setLines((ls) => {
      const i = ls.findIndex((l) => l.key === key);
      const j = i + dir;
      if (i < 0 || j < 0 || j >= ls.length) return ls;
      const next = [...ls];
      [next[i], next[j]] = [next[j], next[i]];
      return next;
    });
    markDirty();
  };

  const applyCatalogItem = (key: string, itemId: string) => {
    const item = catalog.find((x) => x.id === itemId);
    if (!item) return;
    updateLine(key, {
      itemId: item.id,
      description: item.description?.trim() ? `${item.name} — ${item.description}` : item.name,
      unitLabel: item.unit_label,
      unitPrice: centsToDollars(item.default_rate_cents),
      taxRate: Number(item.default_tax_rate) > 0 ? rateToPct(item.default_tax_rate) : '',
    });
  };

  const touch = <E,>(fn: (e: E) => void) => (e: E) => {
    fn(e);
    markDirty();
  };

  /* ---------- render ---------- */

  if (notConfigured) return <SetupRequired what="The invoice editor" />;
  if (!activeBusiness) return <EmptyState title="No business selected" body="Create a business first." />;
  if (loading) return <p>Loading draft…</p>;
  if (loadError) return <Alert kind="error">{loadError}</Alert>;

  const customer = customers.find((c) => c.id === customerId) ?? null;

  return (
    <div>
      <div className="btn-row no-print" style={{ marginBottom: 16, justifyContent: 'space-between' }}>
        <h1 className="page-title" style={{ margin: 0 }}>
          {isNew && !draftId ? 'New invoice' : 'Edit draft'} — {activeBusiness.display_name}
        </h1>
        <SaveStatusIndicator status={saveStatus} message={saveMessage} />
      </div>

      {errors.length > 0 && (
        <Alert kind="error">
          <ul style={{ margin: 0, paddingLeft: 18 }}>
            {errors.map((e, i) => (
              <li key={i}>{e}</li>
            ))}
          </ul>
        </Alert>
      )}

      <div className="editor-layout">
        <div>
          <div className="card">
            <div className="form-row">
              <Field label="Customer *" htmlFor="inv-cust">
                <SelectField id="inv-cust" value={customerId} onChange={touch((e: React.ChangeEvent<HTMLSelectElement>) => setCustomerId(e.target.value))}>
                  <option value="">Choose a customer…</option>
                  {customers.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </SelectField>
              </Field>
              <Field label="Invoice date *" htmlFor="inv-date">
                <TextField id="inv-date" type="date" value={invoiceDate} onChange={touch((e) => setInvoiceDate(e.target.value))} />
              </Field>
              <Field label="Due date" htmlFor="inv-due">
                <TextField id="inv-due" type="date" value={dueDate} onChange={touch((e) => setDueDate(e.target.value))} />
              </Field>
            </div>
            <div className="form-row">
              <Field label="P.O. / reference #" htmlFor="inv-po">
                <TextField id="inv-po" value={poNumber} onChange={touch((e) => setPoNumber(e.target.value))} />
              </Field>
              <Field label="Service date" htmlFor="inv-sd">
                <TextField id="inv-sd" type="date" value={serviceDate} onChange={touch((e) => setServiceDate(e.target.value))} />
              </Field>
              <Field label="Service period" htmlFor="inv-sp" hint="e.g. October 2026">
                <TextField id="inv-sp" value={servicePeriod} onChange={touch((e) => setServicePeriod(e.target.value))} />
              </Field>
            </div>
          </div>

          <div className="card">
            <h2 style={{ marginTop: 0 }}>Line items</h2>
            {lines.map((l, i) => (
              <div className="line-item" key={l.key}>
                <div className="line-item-head">
                  <strong>Line {i + 1}</strong>
                  <div className="btn-row">
                    <Button variant="ghost" size="sm" onClick={() => moveLine(l.key, -1)} aria-label={`Move line ${i + 1} up`} disabled={i === 0}>↑</Button>
                    <Button variant="ghost" size="sm" onClick={() => moveLine(l.key, 1)} aria-label={`Move line ${i + 1} down`} disabled={i === lines.length - 1}>↓</Button>
                    <Button variant="ghost" size="sm" onClick={() => duplicateLine(l.key)}>Duplicate</Button>
                    <Button variant="ghost" size="sm" onClick={() => removeLine(l.key)} disabled={lines.length === 1}>Remove</Button>
                  </div>
                </div>
                {catalog.length > 0 && (
                  <Field label="Add from catalog" htmlFor={`cat-${l.key}`}>
                    <SelectField
                      id={`cat-${l.key}`}
                      value=""
                      onChange={(e) => {
                        if (e.target.value) applyCatalogItem(l.key, e.target.value);
                        e.target.value = '';
                      }}
                    >
                      <option value="">Choose a catalog item…</option>
                      {catalog.map((c) => (
                        <option key={c.id} value={c.id}>
                          {c.name} — ${centsToDollars(c.default_rate_cents)}/{c.unit_label}
                        </option>
                      ))}
                    </SelectField>
                  </Field>
                )}
                <Field label="Description *" htmlFor={`desc-${l.key}`}>
                  <TextArea
                    id={`desc-${l.key}`}
                    rows={2}
                    value={l.description}
                    onChange={(e) => updateLine(l.key, { description: e.target.value, itemId: null })}
                    placeholder="What was done or provided"
                  />
                </Field>
                <div className="form-row">
                  <Field label="Quantity *" htmlFor={`qty-${l.key}`}>
                    <TextField id={`qty-${l.key}`} inputMode="decimal" value={l.quantity} onChange={(e) => updateLine(l.key, { quantity: e.target.value })} />
                  </Field>
                  <Field label="Unit" htmlFor={`unit-${l.key}`}>
                    <TextField id={`unit-${l.key}`} value={l.unitLabel} onChange={(e) => updateLine(l.key, { unitLabel: e.target.value })} />
                  </Field>
                  <Field label="Unit price $ *" htmlFor={`price-${l.key}`}>
                    <TextField id={`price-${l.key}`} inputMode="decimal" value={l.unitPrice} onChange={(e) => updateLine(l.key, { unitPrice: e.target.value })} placeholder="0.00" />
                  </Field>
                </div>
                {discountMode === 'lines' && (
                  <div className="form-row">
                    <Field label="Line discount $" htmlFor={`ldisc-${l.key}`}>
                      <TextField id={`ldisc-${l.key}`} inputMode="decimal" value={l.discount} onChange={(e) => updateLine(l.key, { discount: e.target.value })} placeholder="0.00" />
                    </Field>
                    <Field label="Tax % (blank = invoice rate)" htmlFor={`ltax-${l.key}`}>
                      <TextField id={`ltax-${l.key}`} inputMode="decimal" value={l.taxRate} onChange={(e) => updateLine(l.key, { taxRate: e.target.value })} placeholder="" />
                    </Field>
                  </div>
                )}
              </div>
            ))}
            <Button variant="secondary" onClick={() => addLine()}>
              Add line item
            </Button>
          </div>

          <div className="card">
            <h2 style={{ marginTop: 0 }}>Discounts, tax &amp; totals</h2>
            <Field label="Discount type" htmlFor="disc-mode">
              <SelectField id="disc-mode" value={discountMode} onChange={touch((e) => setDiscountMode(e.target.value as DiscountMode))}>
                <option value="none">No discount</option>
                <option value="invoice">Invoice discount (%)</option>
                <option value="lines">Per-line discounts ($)</option>
              </SelectField>
            </Field>
            {discountMode === 'invoice' && (
              <Field label="Invoice discount %" htmlFor="inv-disc" hint="Percent off the subtotal, e.g. 10">
                <TextField id="inv-disc" inputMode="decimal" value={invoiceDiscountPct} onChange={touch((e) => setInvoiceDiscountPct(e.target.value))} />
              </Field>
            )}
            <label className="checkbox-row">
              <input type="checkbox" checked={useTax} onChange={touch((e) => setUseTax(e.target.checked))} />
              Apply sales tax
            </label>
            {useTax && (
              <Field label="Sales tax rate %" htmlFor="inv-tax" hint="e.g. 7 for 7%. Applied per line; grouped by rate on the invoice.">
                <TextField id="inv-tax" inputMode="decimal" value={invoiceTaxPct} onChange={touch((e) => setInvoiceTaxPct(e.target.value))} />
              </Field>
            )}
            <Field label="Shipping & handling $" htmlFor="inv-ship">
              <TextField id="inv-ship" inputMode="decimal" value={shipping} onChange={touch((e) => setShipping(e.target.value))} placeholder="0.00" />
            </Field>

            {totals && (
              <div className="totals-box" aria-live="polite">
                <div className="totals-row"><span>Subtotal</span><span>{money(totals.subtotalCents)}</span></div>
                {totals.discountCents > 0 && <div className="totals-row"><span>Discount</span><span>−{money(totals.discountCents)}</span></div>}
                {totals.taxByRate.map((g) => (
                  <div className="totals-row" key={g.rate}><span>Tax {(Number(g.rate) * 100).toFixed(2)}%</span><span>{money(g.cents)}</span></div>
                ))}
                {totals.shippingCents > 0 && <div className="totals-row"><span>Shipping &amp; handling</span><span>{money(totals.shippingCents)}</span></div>}
                <div className="totals-row grand"><span>Total due</span><span>{money(totals.totalCents)}</span></div>
              </div>
            )}
          </div>

          <div className="card">
            <h2 style={{ marginTop: 0 }}>Notes &amp; payment</h2>
            <Field label="Notes / comments" htmlFor="inv-notes">
              <TextArea id="inv-notes" value={notes} onChange={touch((e) => setNotes(e.target.value))} />
            </Field>
            <Field label="Terms" htmlFor="inv-terms">
              <TextField id="inv-terms" value={terms} onChange={touch((e) => setTerms(e.target.value))} />
            </Field>
            <Field label="Payment instructions" htmlFor="inv-pay">
              <TextArea id="inv-pay" value={paymentInstructions} onChange={touch((e) => setPaymentInstructions(e.target.value))} />
            </Field>
          </div>

          <div className="btn-row no-print" style={{ marginBottom: 24 }}>
            <Button onClick={() => doSave(true)} disabled={saveStatus === 'saving'}>
              {saveStatus === 'saving' ? 'Saving…' : draftId ? 'Save draft' : 'Create draft'}
            </Button>
            {draftId && (
              <Button variant="secondary" onClick={() => setIssueOpen(true)} disabled={issueBusy}>
                Issue invoice…
              </Button>
            )}
            <span style={{ fontSize: 13, color: 'var(--muted)' }}>
              Drafts autosave. Issuing assigns the invoice number permanently.
            </span>
          </div>

          {draftId && (
            <div className="card no-print">
              <Field label="Invoice template" htmlFor="inv-template" hint="Used for the issued PDF and print. Stored with the invoice at issuance.">
                <SelectField id="inv-template" value={templateId} onChange={(e) => setTemplateId(e.target.value as TemplateId)}>
                  {TEMPLATES.map((t) => (
                    <option key={t.id} value={t.id}>{t.name} — {t.description}</option>
                  ))}
                </SelectField>
              </Field>
            </div>
          )}
        </div>

        <InvoicePreview business={activeBusiness} customer={customer} lines={lines} totals={totals}
          invoiceDate={invoiceDate} dueDate={dueDate} poNumber={poNumber}
          notes={notes} terms={terms} paymentInstructions={paymentInstructions}
          discountMode={discountMode} />
      </div>

      {issueOpen && (
        <Modal title="Issue this invoice?" onClose={() => !issueBusy && setIssueOpen(false)}>
          <p>
            This will permanently assign invoice number{' '}
            <strong>{activeBusiness ? previewNextNumber(activeBusiness) : '…'}</strong>, store an
            immutable snapshot of the business, customer, lines, and totals, and generate the
            issued PDF. The draft can no longer be edited — later corrections use the revision
            workflow.
          </p>
          {totals && (
            <p>Total due: <strong>{`$${centsToDollars(totals.totalCents)}`}</strong></p>
          )}
          <div className="btn-row">
            <Button onClick={doIssue} disabled={issueBusy}>
              {issueBusy ? 'Issuing…' : `Issue as ${activeBusiness ? previewNextNumber(activeBusiness) : ''}`}
            </Button>
            <Button variant="secondary" onClick={() => setIssueOpen(false)} disabled={issueBusy}>
              Cancel
            </Button>
          </div>
        </Modal>
      )}
    </div>
  );
}

/**
 * Shared invoice rendering model — the editor preview, the PDF, and print
 * must all render from this same structure (spec §8).
 */
function InvoicePreview({
  business, customer, lines, totals, invoiceDate, dueDate, poNumber, notes, terms, paymentInstructions, discountMode,
}: {
  business: Business;
  customer: Customer | null;
  lines: LineState[];
  totals: ReturnType<typeof previewTotals> | null;
  invoiceDate: string;
  dueDate: string;
  poNumber: string;
  notes: string;
  terms: string;
  paymentInstructions: string;
  discountMode: DiscountMode;
}) {
  const visible = lines.filter((l) => l.description.trim() || l.unitPrice.trim());
  return (
    <div className="invoice-preview" aria-label="Invoice preview">
      <div className="inv-head">
        <div>
          <h2>{business.display_name}</h2>
          <div style={{ color: 'var(--muted)', fontSize: 13 }}>
            {[business.address_line1, business.address_line2].filter(Boolean).join(', ')}
            <br />
            {[business.city, business.state, business.zip].filter(Boolean).join(', ')}
            {business.phone && <><br />{business.phone}</>}
            {business.email && <><br />{business.email}</>}
          </div>
        </div>
        <div style={{ textAlign: 'right' }}>
          <div style={{ fontSize: 26, fontWeight: 800, letterSpacing: 2 }}>INVOICE</div>
          <span className="badge badge-draft">DRAFT</span>
          <div style={{ fontSize: 13, marginTop: 8 }}>Date: {invoiceDate || '—'}</div>
          {dueDate && <div style={{ fontSize: 13 }}>Due: {dueDate}</div>}
          {poNumber && <div style={{ fontSize: 13 }}>P.O. #{poNumber}</div>}
        </div>
      </div>

      <div style={{ marginBottom: 8 }}>
        <strong>Bill to</strong>
        <div>{customer ? customer.name : '—'}</div>
        {customer && (
          <div style={{ color: 'var(--muted)', fontSize: 13 }}>
            {[customer.billing_line1, customer.billing_city, customer.billing_state, customer.billing_zip].filter(Boolean).join(', ')}
            {customer.phone && <><br />{customer.phone}</>}
            {customer.email && <><br />{customer.email}</>}
          </div>
        )}
      </div>

      <table className="inv-table">
        <thead>
          <tr>
            <th>#</th>
            <th>Description</th>
            <th style={{ textAlign: 'right' }}>Qty</th>
            <th style={{ textAlign: 'right' }}>Price</th>
            <th style={{ textAlign: 'right' }}>Amount</th>
          </tr>
        </thead>
        <tbody>
          {visible.length === 0 && (
            <tr><td colSpan={5} style={{ color: 'var(--muted)' }}>No line items yet.</td></tr>
          )}
          {visible.map((l, i) => {
            let amt = '—';
            try {
              amt = money(multiplyQuantity(dollarsToCents(l.unitPrice.trim() || '0'), l.quantity.trim() || '1'));
            } catch {
              amt = '—';
            }
            return (
              <tr key={l.key}>
                <td>{i + 1}</td>
                <td style={{ whiteSpace: 'pre-wrap' }}>{l.description || <span style={{ color: 'var(--muted)' }}>—</span>}</td>
                <td style={{ textAlign: 'right' }}>{l.quantity} {l.unitLabel}</td>
                <td style={{ textAlign: 'right' }}>{l.unitPrice ? `$${l.unitPrice}` : '—'}</td>
                <td style={{ textAlign: 'right' }}>{amt}</td>
              </tr>
            );
          })}
        </tbody>
      </table>

      {totals && (
        <div className="inv-totals">
          <div className="totals-row"><span>Subtotal</span><span>{money(totals.subtotalCents)}</span></div>
          {totals.discountCents > 0 && <div className="totals-row"><span>Discount{discountMode === 'invoice' ? '' : ' (lines)'}</span><span>−{money(totals.discountCents)}</span></div>}
          {totals.taxByRate.map((g) => (
            <div className="totals-row" key={g.rate}><span>Tax {(Number(g.rate) * 100).toFixed(2)}%</span><span>{money(g.cents)}</span></div>
          ))}
          {totals.shippingCents > 0 && <div className="totals-row"><span>Shipping</span><span>{money(totals.shippingCents)}</span></div>}
          <div className="totals-row grand"><span>Total due</span><span>{money(totals.totalCents)}</span></div>
        </div>
      )}

      {notes && <div style={{ marginTop: 20 }}><strong>Notes</strong><div style={{ whiteSpace: 'pre-wrap' }}>{notes}</div></div>}
      {terms && <div style={{ marginTop: 12 }}><strong>Terms:</strong> {terms}</div>}
      {paymentInstructions && <div style={{ marginTop: 12 }}><strong>Payment instructions</strong><div style={{ whiteSpace: 'pre-wrap' }}>{paymentInstructions}</div></div>}
      <div style={{ marginTop: 24, textAlign: 'center', color: 'var(--muted)', fontSize: 13 }}>Thank you for your business!</div>
    </div>
  );
}
