import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { useBusiness } from '../business/BusinessContext';
import type { Business, Customer, Item, InvoiceTemplate } from '../db/types';
import { createDraft, getDraft, previewTotals, saveDraft, type DraftInput } from '../data/drafts';
import { listCustomers } from '../data/customers';
import { listItems } from '../data/items';
import { centsToDollars, dollarsToCents, multiplyQuantity, calculateCommissionTotals, percentOf } from '../lib/money';
import {
  Alert,
  Button,
  EmptyState,
  Field,
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

/** Integer cents -> "15000.00" (no thousands separators — safe to parse back). */
function plainDollars(cents: number): string {
  const sign = cents < 0 ? '-' : '';
  const abs = Math.abs(Math.round(cents));
  return `${sign}${Math.floor(abs / 100)}.${String(abs % 100).padStart(2, '0')}`;
}

export default function InvoiceEditor() {
  const { id } = useParams();
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const { activeBusiness, notConfigured, setEditorDirty, onSaveDraftRef } = useBusiness();
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
  const [lines, setLines] = useState<LineState[]>([newLine()]);
  const [discountMode, setDiscountMode] = useState<DiscountMode>('none');
  const [invoiceDiscountPct, setInvoiceDiscountPct] = useState('');
  const [invoiceTaxPct, setInvoiceTaxPct] = useState('');
  const [useTax, setUseTax] = useState(false);
  const [shipping, setShipping] = useState('');
  const [notes, setNotes] = useState('');
  const [terms, setTerms] = useState('');
  const [paymentInstructions, setPaymentInstructions] = useState('');

  /* commission template (Dania Realty) */
  const [template, setTemplate] = useState<InvoiceTemplate>('standard');
  const templateTouched = useRef(false);
  const [salePrice, setSalePrice] = useState('');
  const [commissionPct, setCommissionPct] = useState('');
  const [commissionAmt, setCommissionAmt] = useState('');
  /* true once the user types a $ directly — % changes clear it and resume auto-fill */
  const commissionAmtManual = useRef(false);
  const [processingFee, setProcessingFee] = useState('295.00');
  const [otherChargeDesc, setOtherChargeDesc] = useState('');
  const [otherCharge, setOtherCharge] = useState('');
  const [agentName, setAgentName] = useState('');
  const [secondAgentName, setSecondAgentName] = useState('');
  const [propertyAddress, setPropertyAddress] = useState('');

  const [dirty, setDirty] = useState(false);
  const [saveStatus, setSaveStatus] = useState<SaveStatus>('idle');
  const [saveMessage, setSaveMessage] = useState<string | undefined>();
  const [errors, setErrors] = useState<string[]>([]);
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
        setDraftId(invoice.id);
        setExpectedUpdatedAt(invoice.updated_at);
        setCustomerId(invoice.customer_id ?? '');
        setInvoiceDate(invoice.invoice_date);
        setDueDate(invoice.due_date ?? '');
        setPoNumber(invoice.po_number ?? '');
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
        setTemplate(invoice.template ?? 'standard');
        setSalePrice(invoice.sale_price_cents ? centsToDollars(invoice.sale_price_cents) : '');
        setCommissionPct(invoice.commission_pct && Number(invoice.commission_pct) !== 0 ? String(Number(invoice.commission_pct)) : '');
        setCommissionAmt(invoice.commission_amount_cents ? plainDollars(invoice.commission_amount_cents) : '');
        commissionAmtManual.current = !!invoice.commission_amount_cents;
        setPropertyAddress(invoice.property_address ?? '');
        setProcessingFee(centsToDollars(invoice.processing_fee_cents));
        setOtherChargeDesc(invoice.other_charge_desc ?? '');
        setOtherCharge(invoice.other_charge_cents ? centsToDollars(invoice.other_charge_cents) : '');
        setAgentName(invoice.agent_name ?? '');
        setSecondAgentName(invoice.second_agent_name ?? '');
        // discount mode is not stored in phase 1; default to none
      })
      .catch((e) => setLoadError(e instanceof Error ? e.message : 'Failed to load draft.'))
      .finally(() => setLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, activeBusiness?.id]);

  /* defaults for a new draft */
  useEffect(() => {
    if (!isNew || !activeBusiness) return;
    // A business switch is a new context: re-apply that business's default template.
    templateTouched.current = false;
    setTemplate(activeBusiness.default_template === 'commission' ? 'commission' : 'standard');
    setNotes((v) => v || activeBusiness.invoice_notes || '');
    setTerms((v) => v || activeBusiness.payment_terms || '');
    setPaymentInstructions((v) => v || activeBusiness.payment_instructions || '');
    setInvoiceTaxPct((v) => v || (Number(activeBusiness.default_tax_rate) > 0 ? rateToPct(activeBusiness.default_tax_rate) : ''));
    const pre = searchParams.get('customer');
    if (pre) setCustomerId(pre);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isNew, activeBusiness?.id]);

  /* auto-fill the commission $ box from % x sale price, until the user types a $ */
  useEffect(() => {
    if (template !== 'commission' || commissionAmtManual.current) return;
    try {
      const price = salePrice.trim();
      const pct = commissionPct.trim();
      if (!price || !pct) return;
      setCommissionAmt(plainDollars(percentOf(dollarsToCents(price), pctToRate(pct))));
    } catch {
      /* leave the $ box alone while inputs are incomplete or invalid */
    }
  }, [template, salePrice, commissionPct]);

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
    const isCommission = template === 'commission';
    return {
      business_id: activeBusiness.id,
      customer_id: isCommission ? null : customerId || null,
      invoice_date: invoiceDate,
      due_date: dueDate || null,
      po_number: poNumber || null,
      currency: 'USD',
      template,
      sale_price_cents: isCommission && salePrice.trim() ? dollarsToCents(salePrice.trim()) : 0,
      commission_pct: isCommission && commissionPct.trim() ? commissionPct.trim() : '0',
      commission_amount_cents: isCommission && commissionAmt.trim() ? dollarsToCents(commissionAmt.trim()) : null,
      processing_fee_cents: isCommission && processingFee.trim() ? dollarsToCents(processingFee.trim()) : 0,
      other_charge_desc: isCommission && otherChargeDesc.trim() ? otherChargeDesc.trim() : null,
      other_charge_cents: isCommission && otherCharge.trim() ? dollarsToCents(otherCharge.trim()) : 0,
      agent_name: isCommission && agentName.trim() ? agentName.trim() : null,
      second_agent_name: isCommission && secondAgentName.trim() ? secondAgentName.trim() : null,
      property_address: isCommission && propertyAddress.trim() ? propertyAddress.trim() : null,
      invoice_discount_rate: discountMode === 'invoice' && invoiceDiscountPct.trim() ? pctToRate(invoiceDiscountPct) : undefined,
      invoice_tax_rate: useTax && invoiceTaxPct.trim() ? pctToRate(invoiceTaxPct) : undefined,
      shipping_cents: shipping.trim() ? dollarsToCents(shipping.trim()) : 0,
      notes: notes || null,
      terms: terms || null,
      payment_instructions: paymentInstructions || null,
      lines: isCommission ? [] : lines.map((l) => ({
        item_id: l.itemId,
        description: l.description.trim(),
        quantity: l.quantity.trim() || '1',
        unit_label: l.unitLabel.trim() || 'each',
        unit_price_cents: dollarsToCents(l.unitPrice.trim() || '0'),
        discount_cents: discountMode === 'lines' && l.discount.trim() ? dollarsToCents(l.discount.trim()) : 0,
        tax_rate: l.taxRate.trim() ? pctToRate(l.taxRate) : undefined,
      })),
    };
  }, [activeBusiness, customerId, invoiceDate, dueDate, poNumber, lines, discountMode, invoiceDiscountPct, useTax, invoiceTaxPct, shipping, notes, terms, paymentInstructions, template, salePrice, commissionPct, commissionAmt, processingFee, otherChargeDesc, otherCharge, agentName, secondAgentName, propertyAddress]);

  const validate = useCallback((): string[] => {
    const errs: string[] = [];
    if (template !== 'commission' && !customerId) errs.push('Choose a customer.');
    if (!invoiceDate) errs.push('Invoice date is required.');
    if (template === 'commission') {
      const amt = (label: string, v: string, opts?: { required?: boolean; positive?: boolean }) => {
        const t = v.trim();
        if (!t) {
          if (opts?.required) errs.push(`${label} is required.`);
          return;
        }
        try {
          const c = dollarsToCents(t);
          if (opts?.positive && c <= 0) errs.push(`${label} must be greater than zero.`);
        } catch {
          errs.push(`${label} must be a valid amount.`);
        }
      };
      amt('Sale price', salePrice, { required: true, positive: true });
      const pctT = commissionPct.trim();
      if (pctT && (!/^\d+(\.\d+)?$/.test(pctT) || Number(pctT) < 0)) {
        errs.push('Commission % must be a valid percent.');
      }
      amt('Commission amount', commissionAmt);
      if (!pctT && !commissionAmt.trim()) {
        errs.push('Enter a commission % or a commission amount.');
      }
      amt('Processing fee', processingFee);
      amt('Other charge', otherCharge);
      if (otherCharge.trim() && !otherChargeDesc.trim()) errs.push('Other charge needs a description.');
      try {
        toDraftInput();
        previewTotals(toDraftInput());
      } catch (e) {
        errs.push(e instanceof Error ? e.message : 'Totals could not be calculated.');
      }
      return errs;
    }
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
  }, [customerId, invoiceDate, lines, discountMode, invoiceDiscountPct, useTax, invoiceTaxPct, shipping, toDraftInput, template, salePrice, commissionPct, commissionAmt, processingFee, otherChargeDesc, otherCharge]);

  const totals = useMemo(() => {
    try {
      return previewTotals(toDraftInput());
    } catch {
      return null;
    }
  }, [toDraftInput]);

  const commissionPreview = useMemo(() => {
    if (template !== 'commission') return null;
    try {
      return calculateCommissionTotals(
        salePrice.trim() ? dollarsToCents(salePrice.trim()) : 0,
        commissionPct.trim() || '0',
        processingFee.trim() ? dollarsToCents(processingFee.trim()) : 0,
        otherCharge.trim() ? dollarsToCents(otherCharge.trim()) : 0,
        commissionAmt.trim() ? dollarsToCents(commissionAmt.trim()) : null,
      );
    } catch {
      return null;
    }
  }, [template, salePrice, commissionPct, commissionAmt, processingFee, otherCharge]);

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
        <div className="no-print">
          <div className="card">
            <div className="form-row">
              {template !== 'commission' && (
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
              )}
              <Field label="Invoice date *" htmlFor="inv-date">
                <TextField id="inv-date" type="date" value={invoiceDate} onChange={touch((e) => setInvoiceDate(e.target.value))} />
              </Field>
              <Field label="Due date" htmlFor="inv-due">
                <TextField id="inv-due" type="date" value={dueDate} onChange={touch((e) => setDueDate(e.target.value))} />
              </Field>
            </div>
            <Field label="P.O. / reference #" htmlFor="inv-po">
              <TextField id="inv-po" value={poNumber} onChange={touch((e) => setPoNumber(e.target.value))} />
            </Field>
          </div>

          <div className="card">
            <Field label="Invoice type" htmlFor="inv-template" hint="Standard = line-item invoice. Commission = Dania Realty commission / wire instruction form.">
              <SelectField
                id="inv-template"
                value={template}
                onChange={touch((e: React.ChangeEvent<HTMLSelectElement>) => {
                  templateTouched.current = true;
                  setTemplate(e.target.value as InvoiceTemplate);
                })}
              >
                <option value="standard">Standard invoice (line items)</option>
                <option value="commission">Commission / wire instructions</option>
              </SelectField>
            </Field>
          </div>

          {template === 'commission' ? (
            <div className="card">
              <h2 style={{ marginTop: 0 }}>Commission &amp; fees</h2>
              <div className="form-row">
                <Field label="Agent name" htmlFor="com-agent">
                  <TextField id="com-agent" value={agentName} onChange={touch((e) => setAgentName(e.target.value))} placeholder="Listing / selling agent" />
                </Field>
                <Field label="Second sales person" htmlFor="com-agent2" hint="If applicable">
                  <TextField id="com-agent2" value={secondAgentName} onChange={touch((e) => setSecondAgentName(e.target.value))} />
                </Field>
              </div>
              <div className="form-row">
                <Field label="Sale price $ *" htmlFor="com-sale">
                  <TextField id="com-sale" inputMode="decimal" value={salePrice} onChange={touch((e) => setSalePrice(e.target.value))} placeholder="0.00" />
                </Field>
                <Field label="Real estate commission %" htmlFor="com-pct" hint="e.g. 3 for 3%">
                  <TextField id="com-pct" inputMode="decimal" value={commissionPct} onChange={touch((e) => { commissionAmtManual.current = false; setCommissionPct(e.target.value); })} placeholder="3" />
                </Field>
              </div>
              <div className="form-row">
                <Field label="Commission amount $ *" htmlFor="com-amt" hint="Auto-filled from % — edit to override">
                  <TextField id="com-amt" inputMode="decimal" value={commissionAmt} onChange={touch((e) => { commissionAmtManual.current = true; setCommissionAmt(e.target.value); })} placeholder="0.00" />
                </Field>
                <Field label="Processing fee $" htmlFor="com-fee">
                  <TextField id="com-fee" inputMode="decimal" value={processingFee} onChange={touch((e) => setProcessingFee(e.target.value))} placeholder="295.00" />
                </Field>
              </div>
              <div className="form-row">
                <Field label="Other charge $" htmlFor="com-other">
                  <TextField id="com-other" inputMode="decimal" value={otherCharge} onChange={touch((e) => setOtherCharge(e.target.value))} placeholder="0.00" />
                </Field>
                <Field label="Other charge description" htmlFor="com-otherdesc">
                  <TextField id="com-otherdesc" value={otherChargeDesc} onChange={touch((e) => setOtherChargeDesc(e.target.value))} placeholder="What the other charge is for" />
                </Field>
              </div>
              <Field label="Property address" htmlFor="com-prop" hint="From the HUD / closing statement">
                <TextField id="com-prop" value={propertyAddress} onChange={touch((e) => setPropertyAddress(e.target.value))} placeholder="123 Main St, Hollywood, FL 33021" />
              </Field>
              {commissionPreview && (
                <div className="totals-box" aria-live="polite">
                  <div className="totals-row">
                    <span>Commission{commissionPct.trim() !== '' ? ` (${commissionPct.trim()}%)` : ''}</span>
                    <span>{money(commissionPreview.commissionCents)}</span>
                  </div>
                  <div className="totals-row">
                    <span>Processing fee</span>
                    <span>{money(commissionPreview.processingFeeCents)}</span>
                  </div>
                  {commissionPreview.otherChargeCents > 0 && (
                    <div className="totals-row">
                      <span>Other charge{otherChargeDesc.trim() !== '' ? ` — ${otherChargeDesc.trim()}` : ''}</span>
                      <span>{money(commissionPreview.otherChargeCents)}</span>
                    </div>
                  )}
                  <div className="totals-row grand">
                    <span>Total due</span>
                    <span>{money(commissionPreview.totalCents)}</span>
                  </div>
                </div>
              )}
            </div>
          ) : (
            <>
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
            </>
          )}

          <div className="card">
            <h2 style={{ marginTop: 0 }}>Notes &amp; payment</h2>
            <Field label="Notes / comments" htmlFor="inv-notes">
              <TextArea id="inv-notes" value={notes} onChange={touch((e) => setNotes(e.target.value))} />
            </Field>
            <Field label="Terms" htmlFor="inv-terms">
              <TextField id="inv-terms" value={terms} onChange={touch((e) => setTerms(e.target.value))} />
            </Field>
            <Field
              label={template === 'commission' ? 'Wire instructions' : 'Payment instructions'}
              htmlFor="inv-pay"
              hint={template === 'commission' ? 'Bank name, routing, account, and Zelle. Saved with the business for reuse.' : undefined}
            >
              <TextArea id="inv-pay" rows={6} value={paymentInstructions} onChange={touch((e) => setPaymentInstructions(e.target.value))} />
            </Field>
          </div>

          <div className="btn-row no-print" style={{ marginBottom: 24 }}>
            <Button onClick={() => doSave(true)} disabled={saveStatus === 'saving'}>
              {saveStatus === 'saving' ? 'Saving…' : draftId ? 'Save draft' : 'Create draft'}
            </Button>
            <Button variant="secondary" onClick={() => window.print()}>
              Print / Save PDF
            </Button>
            <span style={{ fontSize: 13, color: 'var(--muted)' }}>
              Drafts autosave. Invoice numbers are assigned at issuance (Phase 2).
            </span>
          </div>
        </div>

        <InvoicePreview business={activeBusiness} customer={customer} lines={lines} totals={totals}
          invoiceDate={invoiceDate} dueDate={dueDate} poNumber={poNumber}
          notes={notes} terms={terms} paymentInstructions={paymentInstructions}
          discountMode={discountMode} template={template}
          agentName={agentName} secondAgentName={secondAgentName}
          propertyAddress={propertyAddress}
          salePrice={salePrice} commissionPct={commissionPct}
          otherChargeDesc={otherChargeDesc} commissionTotals={commissionPreview} />
      </div>
    </div>
  );
}

/**
 * Shared invoice rendering model — the editor preview, the PDF, and print
 * must all render from this same structure (spec §8).
 */
/** Commission / wire-instruction preview body (Dania Realty template). */
function CommissionPreviewBody({
  agentName,
  secondAgentName,
  propertyAddress,
  salePrice,
  commissionPct,
  otherChargeDesc,
  commissionTotals,
  paymentInstructions,
}: {
  agentName: string;
  secondAgentName: string;
  propertyAddress: string;
  salePrice: string;
  commissionPct: string;
  otherChargeDesc: string;
  commissionTotals: {
    commissionCents: number;
    processingFeeCents: number;
    otherChargeCents: number;
    totalCents: number;
  } | null;
  paymentInstructions: string;
}) {
  const pct = commissionPct.trim();
  const sale = salePrice.trim() || '0.00';
  const otherDesc = otherChargeDesc.trim();
  const showOther =
    otherDesc !== '' || (commissionTotals !== null && commissionTotals.otherChargeCents > 0);
  return (
    <>
      {(agentName.trim() !== '' || secondAgentName.trim() !== '') && (
        <div style={{ marginBottom: 12, fontSize: 14 }}>
          {agentName.trim() !== '' && (
            <div>
              <strong>Agent:</strong> {agentName.trim()}
            </div>
          )}
          {secondAgentName.trim() !== '' && (
            <div>
              <strong>Second sales person:</strong> {secondAgentName.trim()}
            </div>
          )}
        </div>
      )}
      {propertyAddress.trim() !== '' && (
        <div style={{ marginBottom: 12, fontSize: 14 }}>
          <strong>Property:</strong> {propertyAddress.trim()}
        </div>
      )}
      <div style={{ marginBottom: 4 }}>
        <strong>DESCRIPTION / COMMISSION &amp; FEES</strong>
      </div>
      <table className="inv-table">
        <thead>
          <tr>
            <th>Description</th>
            <th style={{ textAlign: 'right' }}>Amount</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td>Real Estate Commission{pct !== '' ? ` (${pct}% of $${sale})` : ''}</td>
            <td style={{ textAlign: 'right' }}>
              {commissionTotals ? money(commissionTotals.commissionCents) : '—'}
            </td>
          </tr>
          <tr>
            <td>Processing Fee</td>
            <td style={{ textAlign: 'right' }}>
              {commissionTotals ? money(commissionTotals.processingFeeCents) : '—'}
            </td>
          </tr>
          {showOther && (
            <tr>
              <td>Other Charge{otherDesc !== '' ? ` — ${otherDesc}` : ''}</td>
              <td style={{ textAlign: 'right' }}>
                {commissionTotals ? money(commissionTotals.otherChargeCents) : '—'}
              </td>
            </tr>
          )}
        </tbody>
      </table>
      {commissionTotals && (
        <div className="inv-totals">
          <div className="totals-row grand">
            <span>TOTAL</span>
            <span>{money(commissionTotals.totalCents)}</span>
          </div>
        </div>
      )}
      {paymentInstructions !== '' && (
        <div
          style={{
            marginTop: 16,
            background: 'var(--card)',
            border: '1px solid var(--border)',
            borderRadius: 8,
            padding: 12,
          }}
        >
          <strong>WIRE INSTRUCTIONS</strong>
          <div style={{ whiteSpace: 'pre-wrap', marginTop: 6, fontSize: 14 }}>{paymentInstructions}</div>
        </div>
      )}
    </>
  );
}

/** Standard line-item preview body. */
function StandardPreviewBody({
  lines,
  totals,
  discountMode,
}: {
  lines: LineState[];
  totals: ReturnType<typeof previewTotals> | null;
  discountMode: DiscountMode;
}) {
  const visible = lines.filter((l) => l.description.trim() || l.unitPrice.trim());
  return (
    <>
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
            <tr>
              <td colSpan={5} style={{ color: 'var(--muted)' }}>
                No line items yet.
              </td>
            </tr>
          )}
          {visible.map((l, i) => {
            let amt = '—';
            try {
              amt = money(
                multiplyQuantity(dollarsToCents(l.unitPrice.trim() || '0'), l.quantity.trim() || '1'),
              );
            } catch {
              amt = '—';
            }
            return (
              <tr key={l.key}>
                <td>{i + 1}</td>
                <td style={{ whiteSpace: 'pre-wrap' }}>
                  {l.description || <span style={{ color: 'var(--muted)' }}>—</span>}
                </td>
                <td style={{ textAlign: 'right' }}>
                  {l.quantity} {l.unitLabel}
                </td>
                <td style={{ textAlign: 'right' }}>{l.unitPrice !== '' ? `$${l.unitPrice}` : '—'}</td>
                <td style={{ textAlign: 'right' }}>{amt}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
      {totals && (
        <div className="inv-totals">
          <div className="totals-row">
            <span>Subtotal</span>
            <span>{money(totals.subtotalCents)}</span>
          </div>
          {totals.discountCents > 0 && (
            <div className="totals-row">
              <span>Discount{discountMode === 'invoice' ? '' : ' (lines)'}</span>
              <span>−{money(totals.discountCents)}</span>
            </div>
          )}
          {totals.taxByRate.map((g) => (
            <div className="totals-row" key={g.rate}>
              <span>Tax {(Number(g.rate) * 100).toFixed(2)}%</span>
              <span>{money(g.cents)}</span>
            </div>
          ))}
          {totals.shippingCents > 0 && (
            <div className="totals-row">
              <span>Shipping</span>
              <span>{money(totals.shippingCents)}</span>
            </div>
          )}
          <div className="totals-row grand">
            <span>Total due</span>
            <span>{money(totals.totalCents)}</span>
          </div>
        </div>
      )}
    </>
  );
}

/**
 * Shared invoice rendering model — the editor preview, the PDF, and print
 * must all render from this same structure (spec §8).
 */
function InvoicePreview({
  business,
  customer,
  lines,
  totals,
  invoiceDate,
  dueDate,
  poNumber,
  notes,
  terms,
  paymentInstructions,
  discountMode,
  template,
  agentName,
  secondAgentName,
  propertyAddress,
  salePrice,
  commissionPct,
  otherChargeDesc,
  commissionTotals,
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
  template: InvoiceTemplate;
  agentName: string;
  secondAgentName: string;
  propertyAddress: string;
  salePrice: string;
  commissionPct: string;
  otherChargeDesc: string;
  commissionTotals: {
    commissionCents: number;
    processingFeeCents: number;
    otherChargeCents: number;
    totalCents: number;
  } | null;
}) {
  const isCommission = template === 'commission';
  return (
    <div className="invoice-preview" aria-label="Invoice preview">
      <div className="inv-head">
        <div>
          <h2>{business.display_name}</h2>
          <div style={{ color: 'var(--muted)', fontSize: 13 }}>
            {[business.address_line1, business.address_line2].filter(Boolean).join(', ')}
            <br />
            {[business.city, business.state, business.zip].filter(Boolean).join(', ')}
            {business.phone && (
              <>
                <br />
                {business.phone}
              </>
            )}
            {business.email && (
              <>
                <br />
                {business.email}
              </>
            )}
          </div>
        </div>
        <div style={{ textAlign: 'right' }}>
          <div style={{ fontSize: 26, fontWeight: 800, letterSpacing: 2 }}>
            {isCommission ? 'COMMISSION' : 'INVOICE'}
          </div>
          <span className="badge badge-draft">DRAFT</span>
          <div style={{ fontSize: 13, marginTop: 8 }}>Date: {invoiceDate || '—'}</div>
          {dueDate !== '' && <div style={{ fontSize: 13 }}>Due: {dueDate}</div>}
          {poNumber !== '' && <div style={{ fontSize: 13 }}>P.O. #{poNumber}</div>}
        </div>
      </div>

      {!isCommission && (
        <div style={{ marginBottom: 8 }}>
          <strong>Bill to</strong>
          <div>{customer ? customer.name : '—'}</div>
          {customer && (
            <div style={{ color: 'var(--muted)', fontSize: 13 }}>
              {[customer.billing_line1, customer.billing_city, customer.billing_state, customer.billing_zip]
                .filter(Boolean)
                .join(', ')}
              {customer.phone && (
                <>
                  <br />
                  {customer.phone}
                </>
              )}
              {customer.email && (
                <>
                  <br />
                  {customer.email}
                </>
              )}
            </div>
          )}
        </div>
      )}

      {isCommission ? (
        <CommissionPreviewBody
          agentName={agentName}
          secondAgentName={secondAgentName}
          propertyAddress={propertyAddress}
          salePrice={salePrice}
          commissionPct={commissionPct}
          otherChargeDesc={otherChargeDesc}
          commissionTotals={commissionTotals}
          paymentInstructions={paymentInstructions}
        />
      ) : (
        <StandardPreviewBody lines={lines} totals={totals} discountMode={discountMode} />
      )}

      {notes !== '' && (
        <div style={{ marginTop: 20 }}>
          <strong>Notes</strong>
          <div style={{ whiteSpace: 'pre-wrap' }}>{notes}</div>
        </div>
      )}
      {terms !== '' && (
        <div style={{ marginTop: 12 }}>
          <strong>Terms:</strong> {terms}
        </div>
      )}
      {!isCommission && paymentInstructions !== '' && (
        <div style={{ marginTop: 12 }}>
          <strong>Payment instructions</strong>
          <div style={{ whiteSpace: 'pre-wrap' }}>{paymentInstructions}</div>
        </div>
      )}
      {isCommission ? (
        <div style={{ marginTop: 24, textAlign: 'center', color: 'var(--muted)', fontSize: 13 }}>
          Commission / Wire Instruction Form | {business.display_name}
          <br />
          Verify wire instructions before payment.
        </div>
      ) : (
        <div style={{ marginTop: 24, textAlign: 'center', color: 'var(--muted)', fontSize: 13 }}>
          Thank you for your business!
        </div>
      )}
    </div>
  );
}
