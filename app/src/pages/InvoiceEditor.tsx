import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useParams, useSearchParams } from 'react-router-dom';
import { useBusiness } from '../business/BusinessContext';
import type { Business, Customer, Invoice, Item, InvoiceTemplate, InvoiceStatus } from '../db/types';
import { createDraft, getDraft, previewTotals, saveDraft, markIssued, type DraftInput } from '../data/drafts';
import { listCustomers, createCustomer } from '../data/customers';
import { listItems } from '../data/items';
import { centsToDollars, dollarsToCents, multiplyQuantity, percentOf, pctToRate as strictPctToRate } from '../lib/money';
import { formatPhone, isValidPhone, PHONE_HINT } from '../lib/phone';
import { getLogoUrl } from '../data/businesses';
import IssuedPanels from '../components/IssuedPanels';
import TimesheetCard, { TimesheetAttachButton, useTimesheet } from '../components/TimesheetCard';
import { generateAndStoreIssuedPdf, type InvoiceStyle } from '../pdf/service';

/** Extract a human-readable message from anything thrown — Supabase/PostgREST
 *  errors are plain objects ({message, details, hint, code}), not Error instances. */
function formatSaveError(e: unknown): string {
  if (e instanceof Error && e.message) return e.message;
  if (e && typeof e === 'object') {
    const o = e as Record<string, unknown>;
    const msg = [o.message, o.details, o.hint].filter(
      (v): v is string => typeof v === 'string' && v.length > 0,
    );
    if (msg.length > 0) {
      const code = typeof o.code === 'string' && o.code ? ` [${o.code}]` : '';
      return msg.join(' — ') + code;
    }
  }
  if (typeof e === 'string' && e) return e;
  return 'Save failed.';
}
import {
  Alert,
  BackButton,
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

/** Integer cents -> "15000.00" (no thousands separators — safe to parse back). */
function plainDollars(cents: number): string {
  const sign = cents < 0 ? '-' : '';
  const abs = Math.abs(Math.round(cents));
  return `${sign}${Math.floor(abs / 100)}.${String(abs % 100).padStart(2, '0')}`;
}

/** Parse a money field without throwing: null means empty or not a valid number. */
function tryCents(v: string): number | null {
  const t = v.trim();
  if (!t) return null;
  try {
    return dollarsToCents(t);
  } catch {
    return null;
  }
}

/** Per-row commission preview. A null amount means that row can't be calculated
 *  (field empty or invalid); badFields names the fields with invalid input. */
interface CommissionPreviewData {
  commissionCents: number | null;
  processingFeeCents: number | null;
  otherChargeCents: number | null;
  totalCents: number | null;
  badFields: string[];
}

export default function InvoiceEditor() {
  const { id } = useParams();
  const [searchParams] = useSearchParams();
  const { activeBusiness, workspace, notConfigured, setEditorDirty, onSaveDraftRef, loading: businessesLoading } = useBusiness();
  const isNew = !id || id === 'new';

  const [draftId, setDraftId] = useState<string | null>(isNew ? null : (id as string));
  const [invoiceStatus, setInvoiceStatus] = useState<InvoiceStatus>('draft');
  const isIssued = invoiceStatus !== 'draft';
  const [expectedUpdatedAt, setExpectedUpdatedAt] = useState<string>(new Date(0).toISOString());
  const [loading, setLoading] = useState(!isNew);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [customers, setCustomers] = useState<Customer[]>([]);
  const [catalog, setCatalog] = useState<Item[]>([]);

  const [customerId, setCustomerId] = useState('');
  const [invoiceDate, setInvoiceDate] = useState(() => new Date().toISOString().slice(0, 10));
  // Quick-add company (commission invoices): create a customer without leaving the editor.
  const [quickAddOpen, setQuickAddOpen] = useState(false);
  const [quickCompany, setQuickCompany] = useState('');
  const [quickContact, setQuickContact] = useState('');
  const [quickPhone, setQuickPhone] = useState('');
  const [quickEmail, setQuickEmail] = useState('');
  const [quickError, setQuickError] = useState<string | null>(null);
  const [quickSaving, setQuickSaving] = useState(false);
  // Tracks arrow-key navigation in the Company picker so auto-advance only
  // fires when an option is actually picked (not while arrowing on desktop).
  const companyArrowRef = useRef(false);
  const custArrowRef = useRef(false);
  const catArrowRef = useRef(false);
  const [invoiceNumber, setInvoiceNumber] = useState<string | null>(null);
  const [lines, setLines] = useState<LineState[]>([newLine()]);
  const [discountMode, setDiscountMode] = useState<DiscountMode>('none');
  const [invoiceDiscountPct, setInvoiceDiscountPct] = useState('');
  const [invoiceTaxPct, setInvoiceTaxPct] = useState('');
  const [useTax, setUseTax] = useState(false);
  const [shipping, setShipping] = useState('');
  const [notes, setNotes] = useState('');
  const [terms, setTerms] = useState('');
  /* The full invoice record as loaded (for the issued payment-instructions snapshot). */
  const [loadedInvoice, setLoadedInvoice] = useState<Invoice | null>(null);

  /* commission template (Dania Realty) */
  const [template, setTemplate] = useState<InvoiceTemplate>('standard');
  const [salePrice, setSalePrice] = useState('');
  const [commissionPct, setCommissionPct] = useState('');
  const [commissionAmt, setCommissionAmt] = useState('');
  /* true once the user types a $ directly — % or sale-price changes clear it and resume auto-fill */
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
  const [toast, setToast] = useState<string | null>(null);
  const [errors, setErrors] = useState<string[]>([]);
  const [invalidFields, setInvalidFields] = useState<Set<string>>(new Set());
  const fieldError = (key: string) => (invalidFields.has(key) ? 'This field is required.' : undefined);
  const [showPreview, setShowPreview] = useState(false);
  const [logoUrl, setLogoUrl] = useState<string | null>(null);

  // Business logo for the invoice header (signed URL, refreshed when the business changes).
  useEffect(() => {
    let cancelled = false;
    setLogoUrl(null);
    const path = activeBusiness?.logo_path;
    if (!path) return;
    getLogoUrl(path).then((url) => {
      if (!cancelled) setLogoUrl(url);
    });
    return () => {
      cancelled = true;
    };
  }, [activeBusiness?.id, activeBusiness?.logo_path]);
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
        setLoadedInvoice(invoice);
        setInvoiceStatus(invoice.status);
        setExpectedUpdatedAt(invoice.updated_at);
        setCustomerId(invoice.customer_id ?? '');
        setInvoiceDate(invoice.invoice_date);
        setInvoiceNumber(invoice.invoice_number ?? null);
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
    setTemplate(activeBusiness.default_template === 'commission' ? 'commission' : 'standard');
    setNotes((v) => v || activeBusiness.invoice_notes || '');
    setTerms((v) => v || activeBusiness.payment_terms || '');
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

  /* Payment / wire instructions are owner-controlled (migration 0016) and
     read-only here. Issued invoices show the snapshot frozen at issue time;
     drafts show the business's current default. */
  const displayPaymentInstructions =
    loadedInvoice?.payment_instructions_snapshot ??
    loadedInvoice?.payment_instructions ??
    activeBusiness?.payment_instructions ??
    '';

  /* ---------- draft input + validation ---------- */

  const toDraftInput = useCallback((): DraftInput => {
    if (!activeBusiness) throw new Error('No business selected.');
    const isCommission = template === 'commission';
    return {
      business_id: activeBusiness.id,
      customer_id: customerId || null,
      invoice_date: invoiceDate,
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
  }, [activeBusiness, customerId, invoiceDate, lines, discountMode, invoiceDiscountPct, useTax, invoiceTaxPct, shipping, notes, terms, template, salePrice, commissionPct, commissionAmt, processingFee, otherChargeDesc, otherCharge, agentName, secondAgentName, propertyAddress]);

  const validate = useCallback((): { errors: string[]; invalid: string[] } => {
    const errs: string[] = [];
    const invalid: string[] = [];
    if (template !== 'commission' && !customerId) { errs.push('Choose a customer.'); invalid.push('customer'); }
    if (!invoiceDate) { errs.push('Invoice date is required.'); invalid.push('invoiceDate'); }
    if (template === 'commission') {
      const amt = (label: string, v: string, fieldKey: string, opts?: { required?: boolean; positive?: boolean }) => {
        const t = v.trim();
        if (!t) {
          if (opts?.required) { errs.push(`${label} is required.`); invalid.push(fieldKey); }
          return;
        }
        try {
          const c = dollarsToCents(t);
          if (opts?.positive && c <= 0) { errs.push(`${label} must be greater than zero.`); invalid.push(fieldKey); }
        } catch {
          errs.push(`${label} must be a valid amount.`); invalid.push(fieldKey);
        }
      };
      amt('Sale price', salePrice, 'salePrice', { required: true, positive: true });
      const pctT = commissionPct.trim();
      if (pctT && (!/^\d+(\.\d+)?$/.test(pctT) || Number(pctT) < 0)) {
        errs.push('Commission % must be a valid percent.');
        invalid.push('commissionPct');
      }
      amt('Commission amount', commissionAmt, 'commissionAmt');
      if (!pctT && !commissionAmt.trim()) {
        errs.push('Enter a commission % or a commission amount.');
        invalid.push('commissionPct', 'commissionAmt');
      }
      if (!propertyAddress.trim()) { errs.push('Property address is required.'); invalid.push('propertyAddress'); }
      if (!agentName.trim()) { errs.push('Agent name is required.'); invalid.push('agentName'); }
      amt('Processing fee', processingFee, 'processingFee');
      amt('Other charge', otherCharge, 'otherCharge');
      if (otherCharge.trim() && !otherChargeDesc.trim()) { errs.push('Other charge needs a description.'); invalid.push('otherChargeDesc'); }
      try {
        toDraftInput();
        previewTotals(toDraftInput());
      } catch (e) {
        errs.push(e instanceof Error ? e.message : 'Totals could not be calculated.');
      }
      return { errors: errs, invalid };
    }
    const nonEmpty = lines.filter((l) => l.description.trim() || l.unitPrice.trim());
    if (nonEmpty.length === 0) errs.push('Add at least one line item.');
    lines.forEach((l, i) => {
      if (!l.description.trim() && !l.unitPrice.trim()) return; // empty row is ignored
      if (!l.description.trim()) { errs.push(`Line ${i + 1}: description is required.`); invalid.push(`desc-${l.key}`); }
      if (!/^\d+(\.\d+)?$/.test(l.quantity.trim()) || Number(l.quantity) <= 0) {
        errs.push(`Line ${i + 1}: quantity must be a positive number.`);
        invalid.push(`qty-${l.key}`);
      }
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
    return { errors: errs, invalid };
  }, [customerId, invoiceDate, lines, discountMode, invoiceDiscountPct, useTax, invoiceTaxPct, shipping, toDraftInput, template, salePrice, commissionPct, commissionAmt, processingFee, otherChargeDesc, otherCharge]);

  const totals = useMemo(() => {
    try {
      return previewTotals(toDraftInput());
    } catch {
      return null;
    }
  }, [toDraftInput]);

  const commissionPreview = useMemo((): CommissionPreviewData | null => {
    if (template !== 'commission') return null;
    const badFields: string[] = [];

    // One bad field must never blank the whole table: compute each row on its own.
    const saleCents = tryCents(salePrice);
    if (salePrice.trim() !== '' && saleCents === null) badFields.push('Sale price');

    const pctStr = commissionPct.trim();
    let pctValid = true;
    if (pctStr !== '') {
      try {
        strictPctToRate(pctStr);
      } catch {
        pctValid = false;
        badFields.push('Commission %');
      }
    }

    // Commission $: a typed amount wins; otherwise derive from sale price x %.
    let commissionCents: number | null = null;
    const overrideCents = tryCents(commissionAmt);
    if (commissionAmt.trim() !== '') {
      if (overrideCents === null) badFields.push('Commission amount');
      else commissionCents = overrideCents;
    } else if (saleCents !== null && pctStr !== '' && pctValid) {
      try {
        commissionCents = percentOf(saleCents, pctToRate(pctStr));
      } catch {
        commissionCents = null;
      }
    }

    const feeCents = processingFee.trim() === '' ? 0 : tryCents(processingFee);
    if (feeCents === null) badFields.push('Processing fee');

    const otherCents = otherCharge.trim() === '' ? 0 : tryCents(otherCharge);
    if (otherCents === null) badFields.push('Other charge');

    const totalCents =
      commissionCents !== null && feeCents !== null && otherCents !== null
        ? commissionCents + feeCents + otherCents
        : null;

    return { commissionCents, processingFeeCents: feeCents, otherChargeCents: otherCents, totalCents, badFields };
  }, [template, salePrice, commissionPct, commissionAmt, processingFee, otherCharge]);

  /* ---------- save ---------- */

  const emailConfigured = Boolean((activeBusiness?.email_from || '').trim());
  const [emailSignal, setEmailSignal] = useState(0);
  const ts = useTimesheet(draftId, undefined, setExpectedUpdatedAt);

  const doSave = useCallback(
    async (manual: boolean): Promise<string | null> => {
      if (isIssued) return null; // finalized invoices are read-only
      const { errors: errs, invalid } = validate();
      if (errs.length > 0) {
        if (manual) {
          setErrors(errs);
          setInvalidFields(new Set(invalid));
          // The user is often scrolled down at the preview — bring the errors into view.
          requestAnimationFrame(() => {
            document.getElementById('invoice-errors')?.scrollIntoView({ behavior: 'smooth', block: 'center' });
          });
        }
        return null;
      }
      setErrors([]);
      setInvalidFields(new Set());
      setSaveStatus('saving');
      setSaveMessage(undefined);
      try {
        const input = toDraftInput();
        // strip fully-empty rows
        input.lines = input.lines.filter((l) => l.description.trim() || l.unit_price_cents > 0);
        let savedId: string;
        if (draftId) {
          const updated = await saveDraft(draftId, input, expectedUpdatedAt);
          setExpectedUpdatedAt(updated.updated_at);
          setInvoiceNumber(updated.invoice_number ?? null);
          savedId = draftId;
        } else {
          const created = await createDraft(input);
          setDraftId(created.id);
          setExpectedUpdatedAt(created.updated_at);
          setInvoiceNumber(created.invoice_number ?? null);
          // Swap the URL without a router navigation: navigating from /invoices/new
          // to /invoices/:id would unmount and remount the editor (separate routes),
          // losing focus and jumping the page to the top mid-typing.
          window.history.replaceState(null, '', `/invoices/${created.id}`);
          savedId = created.id;
        }
        dirtyRef.current = false;
        setDirty(false);
        setEditorDirty(false);
        setSaveStatus('saved');
        return savedId;
      } catch (e) {
        setSaveStatus('failed');
        setSaveMessage(formatSaveError(e));
        if (manual) setErrors([formatSaveError(e)]);
        return null;
      }
    },
    [validate, toDraftInput, draftId, expectedUpdatedAt, setEditorDirty, isIssued],
  );

  /** Save + finalize (draft -> issued). Returns the invoice id, or null on failure. */
  const finalizeInvoice = useCallback(async (): Promise<string | null> => {
    const printId = await doSave(true);
    if (!printId) return null;
    try {
      await markIssued(printId);
    } catch (e) {
      setErrors([e instanceof Error ? e.message : 'Could not finalize the invoice.']);
      return null;
    }
    setInvoiceStatus('issued');
    // Show confirmation toast
    try {
      const issued = await getDraft(printId);
      setToast(`Invoice #${issued.invoice?.invoice_number ?? ''} issued`.trim());
      setTimeout(() => setToast(null), 4000);
    } catch { /* non-critical */ }
    // Generate and privately store the issued PDF from the frozen snapshot.
    // Best-effort: emailing still works if this fails; the panels offer a retry.
    if (workspace && activeBusiness) {
      try {
        await generateAndStoreIssuedPdf(
          workspace.id,
          printId,
          (activeBusiness.invoice_style as InvoiceStyle) || 'classic',
        );
      } catch (e) {
        console.error('Issued PDF could not be stored:', e);
      }
    }
    return printId;
  }, [doSave, workspace, activeBusiness]);

  /** Print / Save PDF. Finalizes the invoice (draft -> issued) on first print. */
  const doPrint = useCallback(async () => {
    // iPad/iPhone: the iOS print dialog can't save as PDF reliably, so download
    // the generated PDF file directly instead of opening window.print().
    const isIOS =
      /iPad|iPhone|iPod/.test(navigator.userAgent) ||
      (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
    if (!isIssued) {
      const printId = await finalizeInvoice();
      if (!printId) return;
      if (isIOS && workspace && activeBusiness) {
        // iOS: the in-browser PDF renderer doesn't work on Safari, so use the
        // native print dialog. The user can save as PDF via Share > Save to Files.
        window.print();
        return;
      }
    } else if (isIOS && workspace && activeBusiness && draftId) {
      // Already issued: use the native print dialog on iOS.
      window.print();
      return;
    }
    window.print();
  }, [isIssued, finalizeInvoice, workspace, activeBusiness, draftId]);

  /** Email from a draft: finalize first, then open the email dialog — no printing needed. */
  const doEmailDraft = useCallback(async () => {
    const id = await finalizeInvoice();
    if (id) setEmailSignal((s) => s + 1);
  }, [finalizeInvoice]);

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

  /** Refresh issued/void state after panel actions (void, payments). */
  const refreshIssuedState = useCallback(async () => {
    if (!draftId) return;
    try {
      const { invoice } = await getDraft(draftId);
      setInvoiceStatus(invoice.status);
      setLoadedInvoice(invoice);
    } catch {
      /* panels already surfaced the error */
    }
  }, [draftId]);

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
    setTimeout(() => {
      const targetId = catalog.length > 0 ? `cat-${nl.key}` : `qty-${nl.key}`;
      document.getElementById(targetId)?.focus();
    }, 50);
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

  /* Commission invoices: Enter advances through a fixed field order.
     Skips the auto-calculated Commission $ and the fixed Processing fee.
     From the last field it scrolls to the Save / Preview / Print buttons. */
  const COMMISSION_ENTER_FLOW = [
    'inv-date',
    'com-prop',
    'com-agent',
    'com-agent2',
    'com-sale',
    'com-pct',
    // com-amt (auto-filled) and com-fee (fixed $295) are skipped
    'com-other',
    'com-otherdesc',
  ];
  const COMMISSION_SKIP_REDIRECT: Record<string, string> = {
    'com-amt': 'com-other',
    'com-fee': 'com-other',
  };

  const commissionEnterToNext = (e: React.KeyboardEvent<HTMLElement>) => {
    if (e.key !== 'Enter') return;
    const target = e.target as HTMLElement;
    if (target.tagName !== 'INPUT') return;
    const id = (target as HTMLInputElement).id;
    let idx = COMMISSION_ENTER_FLOW.indexOf(id);
    if (idx === -1) {
      // Skipped field (Commission $ / Processing fee): jump to Other Charge.
      const redirect = COMMISSION_SKIP_REDIRECT[id];
      if (!redirect) return;
      idx = COMMISSION_ENTER_FLOW.indexOf(redirect) - 1;
    }
    e.preventDefault();
    // Focus the next enabled, visible field in the flow.
    for (let i = idx + 1; i < COMMISSION_ENTER_FLOW.length; i++) {
      const el = document.getElementById(COMMISSION_ENTER_FLOW[i]) as
        | HTMLInputElement
        | HTMLSelectElement
        | null;
      if (el && !el.disabled && el.offsetParent !== null) {
        el.focus({ preventScroll: true });
        el.scrollIntoView({ behavior: 'smooth', block: 'center' });
        try {
          if (el instanceof HTMLInputElement && el.type === 'text') el.select();
        } catch {
          /* select() unsupported for this input type — focus is enough */
        }
        return;
      }
    }
    // Last field in the flow: scroll to the action buttons and focus Print.
    const actions = document.getElementById('invoice-actions');
    if (actions) {
      actions.scrollIntoView({ behavior: 'smooth', block: 'start' });
      const printBtn = actions.querySelector<HTMLElement>('[data-action="print"]');
      printBtn?.focus({ preventScroll: true });
    }
  };

  /* Live check: a non-empty line needs a positive quantity — flagged red immediately. */
  const qtyNeedsNumber = (l: LineState) => {
    if (!l.description.trim() && !l.unitPrice.trim()) return false; // empty row is ignored
    const q = l.quantity.trim();
    return !/^\d+(\.\d+)?$/.test(q) || Number(q) <= 0;
  };

  /* Standard invoice Enter flow: invoice date -> catalog item -> quantity,
     skipping description / unit / unit price (auto-filled from the catalog). */
  const blankDefaultQty = (key: string) => {
    const line = lines.find((x) => x.key === key);
    if (line && line.quantity === '1') updateLine(key, { quantity: '' });
  };
  const standardEnterToNext = (e: React.KeyboardEvent<HTMLElement>) => {
    if (e.key !== 'Enter') return;
    const target = e.target as HTMLElement;
    if (target.tagName !== 'INPUT') return;
    const id = (target as HTMLInputElement).id;
    const flow: string[] = ['inv-date'];
    for (const l of lines) {
      if (catalog.length > 0) flow.push(`cat-${l.key}`);
      flow.push(`qty-${l.key}`);
    }
    flow.push('add-line-btn');
    const idx = flow.indexOf(id);
    if (idx === -1) return;
    e.preventDefault();
    for (let i = idx + 1; i < flow.length; i++) {
      const el = document.getElementById(flow[i]) as HTMLElement | null;
      if (el && !(el as HTMLInputElement | HTMLSelectElement).disabled && el.offsetParent !== null) {
        if (flow[i].startsWith('qty-')) blankDefaultQty(flow[i].slice(4));
        el.focus({ preventScroll: true });
        el.scrollIntoView({ behavior: 'smooth', block: 'center' });
        try {
          if (el instanceof HTMLInputElement && el.type === 'text') el.select();
        } catch {
          /* select() unsupported for this input type — focus is enough */
        }
        return;
      }
    }
  };

  /* Quick-add a company/customer without leaving the invoice editor. */
  const quickAddCompany = async () => {
    const companyName = quickCompany.trim();
    if (!companyName) {
      setQuickError('Company name is required.');
      return;
    }
    if (quickPhone.trim() !== '' && !isValidPhone(quickPhone)) {
      setQuickError(`Phone number format is not valid — ${PHONE_HINT}.`);
      return;
    }
    if (!activeBusiness) return;
    setQuickSaving(true);
    setQuickError(null);
    try {
      const created = await createCustomer({
        business_id: activeBusiness.id,
        name: companyName,
        company: companyName,
        contact_person: quickContact.trim() || null,
        phone: quickPhone.trim() ? formatPhone(quickPhone) : null,
        email: quickEmail.trim() || null,
      });
      setCustomers((prev) => [...prev, created].sort((a, b) => (a.company || a.name).localeCompare(b.company || b.name)));
      setCustomerId(created.id);
      markDirty();
      setQuickAddOpen(false);
      setQuickCompany('');
      setQuickContact('');
      setQuickPhone('');
      setQuickEmail('');
    } catch (e) {
      setQuickError(e instanceof Error ? e.message : 'Could not create the company.');
    } finally {
      setQuickSaving(false);
    }
  };

  /* ---------- render ---------- */

  if (notConfigured) return <SetupRequired what="The invoice editor" />;
  if (businessesLoading) return <p>Loading…</p>;
  if (!activeBusiness) return <EmptyState title="No business selected" body="Create a business first." />;
  if (loading) return <p>Loading draft…</p>;
  if (loadError) return <Alert kind="error">{loadError}</Alert>;

  const customer = customers.find((c) => c.id === customerId) ?? null;

  const previewEl = (
    <InvoicePreview business={activeBusiness} customer={customer} lines={lines} totals={totals}
      invoiceDate={invoiceDate} invoiceNumber={invoiceNumber}
      notes={notes} paymentInstructions={displayPaymentInstructions}
      discountMode={discountMode} template={template}
      agentName={agentName} secondAgentName={secondAgentName}
      propertyAddress={propertyAddress}
      salePrice={salePrice} commissionPct={commissionPct}
      otherChargeDesc={otherChargeDesc} commissionTotals={commissionPreview} invoiceStatus={invoiceStatus}
      logoUrl={logoUrl} />
  );

  const actionButtons = (
    <>
      <Button variant="secondary" onClick={() => setShowPreview(true)}>
        Preview
      </Button>
      <Button variant="secondary" onClick={doPrint} data-action="print">
        Print / Save PDF
      </Button>
      {!isIssued && emailConfigured && (
        <Button variant="secondary" onClick={doEmailDraft}>
          Email invoice
        </Button>
      )}
      {!isIssued && draftId && (
        <TimesheetAttachButton ts={ts} />
      )}
      {!isIssued && (
        <span style={{ fontSize: 13, color: 'var(--muted)' }}>
          Drafts autosave{invoiceNumber ? ` as invoice #${invoiceNumber}` : ''}.
        </span>
      )}
    </>
  );

  return (
    <div>
      <BackButton />
      <div className="btn-row no-print" style={{ marginBottom: 16 }}>
        {actionButtons}
      </div>
      <div className="btn-row no-print" style={{ marginBottom: 16, justifyContent: 'space-between' }}>
        <h1 className="page-title" style={{ margin: 0 }}>
          {isNew && !draftId ? 'New invoice' : isIssued ? 'Invoice' : 'Edit draft'} — {activeBusiness.display_name}
        </h1>
        <SaveStatusIndicator status={saveStatus} message={saveMessage} />
      </div>

      {toast && (
        <div
          role="status"
          style={{
            position: 'fixed',
            bottom: 24,
            left: '50%',
            transform: 'translateX(-50%)',
            background: '#166534',
            color: '#fff',
            padding: '12px 24px',
            borderRadius: 8,
            fontWeight: 600,
            zIndex: 100,
            boxShadow: '0 4px 12px rgba(0,0,0,0.2)',
          }}
        >
          ✓ {toast}
        </div>
      )}

      {errors.length > 0 && (
        <div id="invoice-errors">
          <Alert kind="error">
            <ul style={{ margin: 0, paddingLeft: 18 }}>
              {errors.map((e, i) => (
                <li key={i}>{e}</li>
              ))}
            </ul>
          </Alert>
        </div>
      )}

      {isIssued && (
        <Alert kind="info">This invoice is finalized. It can be reprinted, but not edited.</Alert>
      )}

      <div className="editor-layout">
        <div className="no-print">
          <fieldset
            disabled={isIssued}
            style={{ border: 0, padding: 0, margin: 0, minWidth: 0 }}
            onKeyDown={template === 'commission' ? commissionEnterToNext : standardEnterToNext}
          >
          <div className="card">
            <div className="form-row">
              {template !== 'commission' && (
                <Field label="Customer *" htmlFor="inv-cust" error={fieldError('customer')}>
                  <div style={{ display: 'flex', gap: 8, alignItems: 'flex-end' }}>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <SelectField
                        id="inv-cust"
                        value={customerId}
                        onKeyDown={(e) => {
                          if (e.key === 'ArrowUp' || e.key === 'ArrowDown') custArrowRef.current = true;
                        }}
                        onChange={(e) => {
                          const viaArrows = custArrowRef.current;
                          custArrowRef.current = false;
                          touch((ev: React.ChangeEvent<HTMLSelectElement>) => setCustomerId(ev.target.value))(e);
                          if (!viaArrows && e.target.value && lines.length > 0) {
                            // Picked from the dropdown: jump straight to the first line's catalog item.
                            requestAnimationFrame(() => {
                              const first = lines[0];
                              const targetId = catalog.length > 0 ? `cat-${first.key}` : `qty-${first.key}`;
                              if (catalog.length === 0) blankDefaultQty(first.key);
                              document.getElementById(targetId)?.focus({ preventScroll: true });
                            });
                          }
                        }}
                      >
                        <option value="">Choose a customer…</option>
                        {customers.map((c) => (
                          <option key={c.id} value={c.id}>
                            {c.name}
                          </option>
                        ))}
                      </SelectField>
                    </div>
                    <Button
                      variant="secondary"
                      onClick={() => {
                        setQuickCompany('');
                        setQuickContact('');
                        setQuickPhone('');
                        setQuickEmail('');
                        setQuickError(null);
                        setQuickAddOpen(true);
                      }}
                      aria-label="Add a new customer"
                    >
                      + New
                    </Button>
                  </div>
                </Field>
              )}
              {template === 'commission' && (
                <Field label="Company" htmlFor="inv-company" hint="Choose the title company or law firm — prints under the date on the invoice">
                  <div style={{ display: 'flex', gap: 8, alignItems: 'flex-end' }}>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <SelectField
                        id="inv-company"
                        value={customerId}
                        onKeyDown={(e) => {
                          if (e.key === 'ArrowUp' || e.key === 'ArrowDown') companyArrowRef.current = true;
                        }}
                        onChange={(e) => {
                          const viaArrows = companyArrowRef.current;
                          companyArrowRef.current = false;
                          touch((ev: React.ChangeEvent<HTMLSelectElement>) => setCustomerId(ev.target.value))(e);
                          if (!viaArrows) {
                            // Option picked from the dropdown: move straight to Property address.
                            requestAnimationFrame(() => {
                              document.getElementById('com-prop')?.focus();
                            });
                          }
                        }}
                      >
                        <option value="">Choose a company…</option>
                        {customers.map((c) => (
                          <option key={c.id} value={c.id}>
                            {c.company || c.name}
                          </option>
                        ))}
                      </SelectField>
                    </div>
                    <Button
                      variant="secondary"
                      onClick={() => {
                        setQuickCompany('');
                        setQuickContact('');
                        setQuickPhone('');
                        setQuickEmail('');
                        setQuickError(null);
                        setQuickAddOpen(true);
                      }}
                      aria-label="Add a new company"
                    >
                      + New
                    </Button>
                  </div>
                </Field>
              )}
              <Field label="Invoice date *" htmlFor="inv-date" error={fieldError('invoiceDate')}>
                <TextField id="inv-date" type="date" value={invoiceDate} onChange={touch((e) => setInvoiceDate(e.target.value))} />
              </Field>
            </div>
          </div>

          {/* Invoice type is fixed per business (Businesses > Edit business > Default invoice template):
              Dania Realty always uses the commission form, Kaleky Computer Consulting always uses standard. */}

          {template === 'commission' ? (
            <div className="card">
              <h2 style={{ marginTop: 0 }}>Commission &amp; fees</h2>
              <Field label="Property address *" htmlFor="com-prop" error={fieldError('propertyAddress')} hint="From the HUD / closing statement">
                <TextField id="com-prop" enterKeyHint="next" value={propertyAddress} onChange={touch((e) => setPropertyAddress(e.target.value))} placeholder="123 Main St, Hollywood, FL 33021" />
              </Field>
              <div className="form-row">
                <Field label="Agent name *" htmlFor="com-agent" error={fieldError('agentName')}>
                  <TextField id="com-agent" enterKeyHint="next" value={agentName} onChange={touch((e) => setAgentName(e.target.value))} placeholder="Listing / selling agent" />
                </Field>
                <Field label="Second sales person" htmlFor="com-agent2" hint="If applicable">
                  <TextField id="com-agent2" enterKeyHint="next" value={secondAgentName} onChange={touch((e) => setSecondAgentName(e.target.value))} />
                </Field>
              </div>
              <div className="form-row">
                <Field label="Sale price $ *" htmlFor="com-sale" error={fieldError('salePrice')}>
                  <TextField id="com-sale" inputMode="decimal" enterKeyHint="next" value={salePrice} onChange={touch((e) => { commissionAmtManual.current = false; setSalePrice(e.target.value); })} placeholder="0.00" />
                </Field>
                <Field label="Real estate commission %" htmlFor="com-pct" error={fieldError('commissionPct')} hint="e.g. 3 for 3%">
                  <TextField id="com-pct" inputMode="decimal" enterKeyHint="next" value={commissionPct} onChange={touch((e) => { commissionAmtManual.current = false; setCommissionPct(e.target.value); })} />
                </Field>
              </div>
              <div className="form-row">
                <Field label="Commission amount $ *" htmlFor="com-amt" error={fieldError('commissionAmt')} hint="Auto-filled from % — edit to override">
                  <TextField id="com-amt" inputMode="decimal" tabIndex={-1} value={commissionAmt} onChange={touch((e) => { commissionAmtManual.current = true; setCommissionAmt(e.target.value); })} placeholder="0.00" />
                </Field>
                <Field label="Processing fee $" htmlFor="com-fee">
                  <TextField id="com-fee" inputMode="decimal" tabIndex={-1} value={processingFee} onChange={touch((e) => setProcessingFee(e.target.value))} placeholder="295.00" />
                </Field>
              </div>
              <div className="form-row">
                <Field label="Other charge $" htmlFor="com-other">
                  <TextField id="com-other" inputMode="decimal" enterKeyHint="next" value={otherCharge} onChange={touch((e) => setOtherCharge(e.target.value))} placeholder="0.00" />
                </Field>
                <Field label="Other charge description" htmlFor="com-otherdesc" error={fieldError('otherChargeDesc')}>
                  <TextField id="com-otherdesc" enterKeyHint="done" value={otherChargeDesc} onChange={touch((e) => setOtherChargeDesc(e.target.value))} placeholder="What the other charge is for" />
                </Field>
              </div>
              {commissionPreview && (
                <div className="totals-box" aria-live="polite">
                  <div className="totals-row">
                    <span>Commission{commissionPct.trim() !== '' ? ` (${commissionPct.trim()}%)` : ''}</span>
                    <span>{commissionPreview.commissionCents !== null ? money(commissionPreview.commissionCents) : '—'}</span>
                  </div>
                  <div className="totals-row">
                    <span>Processing fee</span>
                    <span>{commissionPreview.processingFeeCents !== null ? money(commissionPreview.processingFeeCents) : '—'}</span>
                  </div>
                  {(commissionPreview.otherChargeCents ?? 0) > 0 && (
                    <div className="totals-row">
                      <span>Other charge{otherChargeDesc.trim() !== '' ? ` — ${otherChargeDesc.trim()}` : ''}</span>
                      <span>{money(commissionPreview.otherChargeCents ?? 0)}</span>
                    </div>
                  )}
                  <div className="totals-row grand">
                    <span>Total due</span>
                    <span>{commissionPreview.totalCents !== null ? money(commissionPreview.totalCents) : '—'}</span>
                  </div>
                  {commissionPreview.badFields.length > 0 && (
                    <div style={{ fontSize: 12, color: 'var(--danger)', marginTop: 4 }}>
                      Check {commissionPreview.badFields.join(', ')} — not a valid amount.
                    </div>
                  )}
                </div>
              )}
            </div>
          ) : (
            <>
              <div className="card">
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
                  <h2 style={{ margin: 0 }}>Line items</h2>
                  <Button variant="secondary" size="sm" onClick={() => addLine()}>
                    + Add line item
                  </Button>
                </div>
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
                      onKeyDown={(e) => {
                        if (e.key === 'ArrowUp' || e.key === 'ArrowDown') catArrowRef.current = true;
                      }}
                      onChange={(e) => {
                        const viaArrows = catArrowRef.current;
                        catArrowRef.current = false;
                        if (e.target.value) {
                          applyCatalogItem(l.key, e.target.value);
                          if (!viaArrows) {
                            // Blank the untouched default quantity, then jump to it.
                            blankDefaultQty(l.key);
                            requestAnimationFrame(() => {
                              document.getElementById(`qty-${l.key}`)?.focus({ preventScroll: true });
                            });
                          }
                        }
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
                <Field label="Description *" htmlFor={`desc-${l.key}`} error={fieldError(`desc-${l.key}`)}>
                  <TextArea
                    id={`desc-${l.key}`}
                    rows={2}
                    style={{ minHeight: 54 }}
                    value={l.description}
                    onChange={(e) => updateLine(l.key, { description: e.target.value, itemId: null })}
                    placeholder="What was done or provided"
                  />
                </Field>
                <div className="line-amounts">
                  <div style={{ flex: '0 0 64px', minWidth: 0 }}>
                    <Field label="Quantity *" htmlFor={`qty-${l.key}`} error={fieldError(`qty-${l.key}`) ?? (qtyNeedsNumber(l) ? 'Enter a quantity.' : undefined)}>
                      <TextField id={`qty-${l.key}`} inputMode="decimal" enterKeyHint="next" value={l.quantity} onChange={(e) => updateLine(l.key, { quantity: e.target.value })} />
                    </Field>
                  </div>
                  <div style={{ flex: '0 0 52px', minWidth: 0 }}>
                    <Field label="Unit" htmlFor={`unit-${l.key}`}>
                      <TextField id={`unit-${l.key}`} value={l.unitLabel} onChange={(e) => updateLine(l.key, { unitLabel: e.target.value })} />
                    </Field>
                  </div>
                  <div style={{ flex: '1 1 0', minWidth: 0 }}>
                    <Field label="Unit price $ *" htmlFor={`price-${l.key}`}>
                      <TextField id={`price-${l.key}`} inputMode="decimal" value={l.unitPrice} onChange={(e) => updateLine(l.key, { unitPrice: e.target.value })} placeholder="0.00" />
                    </Field>
                  </div>
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
            <Button variant="secondary" id="add-line-btn" onClick={() => addLine()}>
              Add line item
            </Button>
          </div>

          {!isIssued && draftId && <TimesheetCard ts={ts} />}

          <div className="card">
            <h2 style={{ marginTop: 0 }}>Discounts, tax &amp; totals</h2>
            <div className="line-amounts">
              <div style={{ flex: '1 1 160px', maxWidth: 230, minWidth: 0 }}>
                <Field label="Discount type" htmlFor="disc-mode">
                  <SelectField id="disc-mode" value={discountMode} onChange={touch((e) => setDiscountMode(e.target.value as DiscountMode))}>
                    <option value="none">No discount</option>
                    <option value="invoice">Invoice discount (%)</option>
                    <option value="lines">Per-line discounts ($)</option>
                  </SelectField>
                </Field>
              </div>
              {discountMode === 'invoice' && (
                <div style={{ flex: '0 0 84px', minWidth: 0 }}>
                  <Field label="Discount %" htmlFor="inv-disc">
                    <TextField id="inv-disc" inputMode="decimal" value={invoiceDiscountPct} onChange={touch((e) => setInvoiceDiscountPct(e.target.value))} />
                  </Field>
                </div>
              )}
              <div style={{ flex: '0 0 130px', minWidth: 0 }}>
                <Field label="Shipping & handling $" htmlFor="inv-ship">
                  <TextField id="inv-ship" inputMode="decimal" value={shipping} onChange={touch((e) => setShipping(e.target.value))} placeholder="0.00" />
                </Field>
              </div>
            </div>
            <div className="line-amounts" style={{ alignItems: 'center' }}>
              <label className="checkbox-row" style={{ marginBottom: 10 }}>
                <input type="checkbox" checked={useTax} onChange={touch((e) => setUseTax(e.target.checked))} />
                Apply sales tax
              </label>
              {useTax && (
                <div style={{ flex: '0 0 84px', minWidth: 0 }}>
                  <Field label="Tax %" htmlFor="inv-tax">
                    <TextField id="inv-tax" inputMode="decimal" value={invoiceTaxPct} onChange={touch((e) => setInvoiceTaxPct(e.target.value))} />
                  </Field>
                </div>
              )}
            </div>

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
              <TextArea id="inv-notes" value={notes} onChange={touch((e) => setNotes(e.target.value))} style={{ minHeight: 54 }} />
            </Field>
            <Field
              label={template === 'commission' ? 'Wire instructions' : 'Payment instructions'}
              htmlFor="inv-pay"
            >
              <div
                id="inv-pay"
                style={{
                  whiteSpace: 'pre-wrap',
                  padding: '10px 12px',
                  border: '1px solid var(--border)',
                  borderRadius: 8,
                  background: 'var(--surface-muted, #f6f8fb)',
                  minHeight: 44,
                }}
              >
                {displayPaymentInstructions || <span style={{ color: 'var(--muted)' }}>None set for this business.</span>}
              </div>
            </Field>
          </div>
          </fieldset>

          {quickAddOpen && (
            <Modal title="Add a new company" onClose={() => setQuickAddOpen(false)}>
              {quickError && <Alert kind="error">{quickError}</Alert>}
              <Field label="Company name *" htmlFor="qc-company">
                <TextField
                  id="qc-company"
                  value={quickCompany}
                  onChange={(e) => setQuickCompany(e.target.value)}
                  autoComplete="organization"
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') quickAddCompany();
                  }}
                />
              </Field>
              <div className="form-row">
                <Field label="Contact person" htmlFor="qc-contact">
                  <TextField
                    id="qc-contact"
                    value={quickContact}
                    onChange={(e) => setQuickContact(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') quickAddCompany();
                    }}
                  />
                </Field>
                <Field label="Phone" htmlFor="qc-phone">
                  <TextField
                    id="qc-phone"
                    type="tel"
                    value={quickPhone}
                    onChange={(e) => setQuickPhone(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') quickAddCompany();
                    }}
                  />
                </Field>
                <Field label="Email" htmlFor="qc-email">
                  <TextField
                    id="qc-email"
                    type="email"
                    value={quickEmail}
                    onChange={(e) => setQuickEmail(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') quickAddCompany();
                    }}
                  />
                </Field>
              </div>
              <div className="btn-row">
                <Button onClick={quickAddCompany} disabled={quickSaving}>
                  {quickSaving ? 'Adding…' : 'Add company'}
                </Button>
                <Button variant="secondary" onClick={() => setQuickAddOpen(false)}>
                  Cancel
                </Button>
              </div>
            </Modal>
          )}

          <div id="invoice-actions" className="btn-row no-print" style={{ marginBottom: 24 }}>
            {actionButtons}
          </div>
        </div>

        {previewEl}
      </div>

      {showPreview && (
        <div
          className="no-print"
          role="dialog"
          aria-modal="true"
          aria-label="Invoice print preview"
          style={{ position: 'fixed', inset: 0, zIndex: 80, background: 'rgba(15,23,42,0.65)', overflowY: 'auto', padding: '20px 12px' }}
          onClick={() => setShowPreview(false)}
        >
          <div
            style={{ maxWidth: 800, margin: '0 auto', background: '#fff', borderRadius: 12, padding: 16 }}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="btn-row" style={{ marginBottom: 12 }}>
              <Button variant="secondary" onClick={async () => { setShowPreview(false); await doPrint(); }}>
                Print / Save PDF
              </Button>
              <Button variant="ghost" onClick={() => setShowPreview(false)}>
                Back to editing
              </Button>
              <span style={{ fontSize: 13, color: 'var(--muted)' }}>This is how your invoice will print.</span>
            </div>
            {previewEl}
          </div>
        </div>
      )}
      {isIssued && draftId && (
        <IssuedPanels invoiceId={draftId} onChanged={refreshIssuedState} openEmailSignal={emailSignal} />
      )}
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
  notes,
}: {
  agentName: string;
  secondAgentName: string;
  propertyAddress: string;
  salePrice: string;
  commissionPct: string;
  otherChargeDesc: string;
  commissionTotals: CommissionPreviewData | null;
  paymentInstructions: string;
  notes: string;
}) {
  const pct = commissionPct.trim();
  const sale = salePrice.trim() || '0.00';
  const otherDesc = otherChargeDesc.trim();
  const showOther =
    otherDesc !== '' || (commissionTotals !== null && (commissionTotals.otherChargeCents ?? 0) > 0);
  return (
    <>
      {commissionTotals && commissionTotals.badFields.length > 0 && (
        <div
          className="no-print"
          style={{
            marginBottom: 12,
            background: '#fef3f2',
            border: '1px solid #f3b8b3',
            borderRadius: 8,
            padding: '10px 12px',
            fontSize: 13,
            color: '#8f1d14',
          }}
        >
          <strong>Can't calculate the totals</strong> — check{' '}
          {commissionTotals.badFields.join(', ')}: it doesn't look like a valid amount. Fix it in
          the form and the numbers will appear.
        </div>
      )}      {(propertyAddress.trim() !== '' || agentName.trim() !== '' || secondAgentName.trim() !== '') && (
        <div className="inv-agentcols">
          <div style={{ fontSize: 14 }}>
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
          {propertyAddress.trim() !== '' && (
            <div style={{ fontSize: 14 }}>
              <strong>Property address</strong>
              <div>{propertyAddress.trim()}</div>
            </div>
          )}
        </div>
      )}
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
              {commissionTotals?.commissionCents != null ? money(commissionTotals.commissionCents) : '—'}
            </td>
          </tr>
          <tr>
            <td>Processing Fee</td>
            <td style={{ textAlign: 'right' }}>
              {commissionTotals?.processingFeeCents != null ? money(commissionTotals.processingFeeCents) : '—'}
            </td>
          </tr>
          {showOther && (
            <tr>
              <td>Other Charge{otherDesc !== '' ? ` — ${otherDesc}` : ''}</td>
              <td style={{ textAlign: 'right' }}>
                {commissionTotals?.otherChargeCents != null ? money(commissionTotals.otherChargeCents) : '—'}
              </td>
            </tr>
          )}
        </tbody>
      </table>
      {commissionTotals?.totalCents != null && (
        <div className="inv-totals">
          <div className="totals-row grand">
            <span>TOTAL</span>
            <span>{money(commissionTotals.totalCents)}</span>
          </div>
        </div>
      )}
      {notes.trim() !== '' && (
        <div style={{ marginTop: 12 }}>
          <strong>Notes</strong>
          <div style={{ whiteSpace: 'pre-wrap', marginTop: 4, fontSize: 14 }}>{notes.trim()}</div>
        </div>
      )}
      {paymentInstructions !== '' && (
        <div
          className="inv-wirebox"
          style={{
            marginTop: 16,
            background: '#e7f3e7',
            border: '1px solid var(--border)',
            borderRadius: 8,
            padding: 12,
          }}
        >
          {!/^wire instructions/im.test(paymentInstructions) && <strong style={{ fontSize: 16 }}>WIRE INSTRUCTIONS</strong>}
          <div style={{ whiteSpace: 'pre-wrap', marginTop: 6, fontSize: 16 }}>{paymentInstructions}</div>
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
  invoiceNumber,
  notes,
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
  invoiceStatus,
  logoUrl,
}: {
  business: Business;
  customer: Customer | null;
  lines: LineState[];
  totals: ReturnType<typeof previewTotals> | null;
  invoiceStatus: InvoiceStatus;
  invoiceDate: string;
  invoiceNumber: string | null;
  notes: string;
  paymentInstructions: string;
  discountMode: DiscountMode;
  template: InvoiceTemplate;
  agentName: string;
  secondAgentName: string;
  propertyAddress: string;
  salePrice: string;
  commissionPct: string;
  otherChargeDesc: string;
  commissionTotals: CommissionPreviewData | null;
  logoUrl: string | null;
}) {
  const isCommission = template === 'commission';
  return (
    <div className="invoice-preview" aria-label="Invoice preview">
      <div className="inv-head">
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', textAlign: 'center', gap: 10 }}>
          {logoUrl && (
            <img
              src={logoUrl}
              alt={`${business.display_name} logo`}
              className="inv-logo"
              style={{ height: 72, width: 'auto', maxWidth: 260, objectFit: 'contain' }}
            />
          )}
          <div>
            <h2 style={{ margin: 0 }}>{business.display_name}</h2>
            {business.header_line && (
              <div style={{ fontSize: 15, fontWeight: 700, margin: '2px 0 4px' }}>
                {business.header_line}
              </div>
            )}
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
        </div>
        <div style={{ textAlign: 'right' }}>
          <div className="inv-title" style={{ fontSize: isCommission ? 20 : 26, fontWeight: 800, letterSpacing: isCommission ? 1 : 2 }}>
            {isCommission ? 'COMMISSION / WIRE INSTRUCTIONS' : 'INVOICE'}
          </div>
          {invoiceNumber && <div style={{ fontSize: 15, fontWeight: 700 }}>#{invoiceNumber}</div>}
          {invoiceStatus === 'draft' && <span className="badge badge-draft">DRAFT</span>}
          <div className="inv-date-line" style={{ fontSize: 20, fontWeight: 700, marginTop: 8 }}>Date: {invoiceDate || '—'}</div>
          {isCommission && customer && (
            <div className="inv-company-block" style={{ marginTop: 4 }}>
              {(customer.company || customer.name) && (
                <div style={{ fontSize: 16, fontWeight: 600 }}>{customer.company || customer.name}</div>
              )}
              {customer.contact_person && <div style={{ fontSize: 14 }}>{customer.contact_person}</div>}
              {(customer.billing_line1 || customer.billing_city || customer.billing_state || customer.billing_zip) && (
                <div style={{ fontSize: 14 }}>
                  {customer.billing_line1 && <div>{customer.billing_line1}</div>}
                  {(customer.billing_city || customer.billing_state || customer.billing_zip) && (
                    <div>
                      {[customer.billing_city, customer.billing_state].filter(Boolean).join(', ')}
                      {customer.billing_zip ? ` ${customer.billing_zip}` : ''}
                    </div>
                  )}
                </div>
              )}
              {customer.phone && <div style={{ fontSize: 14 }}>{customer.phone}</div>}
              {customer.email && <div style={{ fontSize: 14 }}>{customer.email}</div>}
            </div>
          )}
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
          notes={notes}
        />
      ) : (
        <StandardPreviewBody lines={lines} totals={totals} discountMode={discountMode} />
      )}

      {!isCommission && notes.trim() !== '' && (
        <div className="inv-section" style={{ marginTop: 20 }}>
          <strong>Notes</strong>
          <div style={{ whiteSpace: 'pre-wrap' }}>{notes.trim()}</div>
        </div>
      )}
      {!isCommission && paymentInstructions !== '' && (
        <div className="inv-section" style={{ marginTop: 12 }}>
          <strong>Payment instructions</strong>
          <div style={{ whiteSpace: 'pre-wrap' }}>{paymentInstructions}</div>
        </div>
      )}
      {isCommission ? (
        <div className="inv-footer" style={{ marginTop: 24, textAlign: 'center', color: 'var(--muted)', fontSize: 13 }}>
          Commission / Wire Instruction Form | {business.display_name}
        </div>
      ) : (
        <div className="inv-footer" style={{ marginTop: 24, textAlign: 'center', color: 'var(--muted)', fontSize: 13 }}>
          Thank you for your business!
        </div>
      )}
    </div>
  );
}
