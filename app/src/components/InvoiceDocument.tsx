import type { InvoiceSnapshot } from '../lib/snapshot';
import type { TemplateId } from '../templates/templates';

function money(cents: number): string {
  const sign = cents < 0 ? '-' : '';
  const abs = Math.abs(Math.round(cents));
  return `${sign}$${Math.floor(abs / 100).toLocaleString('en-US')}.${String(abs % 100).padStart(2, '0')}`;
}

function addr(lines: (string | null | undefined)[]): string[] {
  return lines.filter(Boolean) as string[];
}

/**
 * Shared HTML invoice rendering (spec §8): the issued-invoice detail page and
 * the print view both render from the immutable snapshot through this
 * component. Drafts use the editor's own preview.
 */
export default function InvoiceDocument({
  snapshot,
  template,
  logoUrl,
  watermark,
}: {
  snapshot: InvoiceSnapshot;
  template: TemplateId;
  logoUrl?: string;
  watermark?: string;
}) {
  const b = snapshot.business;
  const c = snapshot.customer;
  const t = snapshot.totals;

  return (
    <div className={`invoice-doc tpl-${template}`}>
      {watermark && <div className="doc-watermark">{watermark}</div>}
      {template === 'modern' && <div className="doc-accent-bar" />}

      <div className="doc-header">
        <div className="doc-business">
          {logoUrl && <img src={logoUrl} alt={`${b.display_name} logo`} className="doc-logo" />}
          <div className="doc-business-name">{b.display_name}</div>
          {b.legal_name && <div className="doc-meta">{b.legal_name}</div>}
          {addr([[b.address_line1, b.address_line2].filter(Boolean).join(', '), [b.city, b.state, b.zip].filter(Boolean).join(', '), b.phone, b.email, b.website].filter(Boolean)).map((l, i) => (
            <div key={i} className="doc-meta">{l}</div>
          ))}
          {b.tax_id && <div className="doc-meta">Tax ID: {b.tax_id}</div>}
        </div>
        <div className="doc-title-block">
          <div className="doc-title">INVOICE</div>
          <div className="doc-meta"><strong>Invoice #:</strong> {snapshot.invoice_number}</div>
          <div className="doc-meta"><strong>Date:</strong> {snapshot.invoice_date}</div>
          {snapshot.due_date && <div className="doc-meta"><strong>Due:</strong> {snapshot.due_date}</div>}
          {snapshot.po_number && <div className="doc-meta"><strong>P.O. #:</strong> {snapshot.po_number}</div>}
          {snapshot.service_date && <div className="doc-meta"><strong>Service date:</strong> {snapshot.service_date}</div>}
          {snapshot.service_period && <div className="doc-meta"><strong>Service period:</strong> {snapshot.service_period}</div>}
        </div>
      </div>

      <div className="doc-billto">
        <div className="doc-section-label">Bill to</div>
        <div className="doc-billto-name">{c ? c.name : '—'}</div>
        {c?.contact_person && <div className="doc-meta">Attn: {c.contact_person}</div>}
        {c && addr([[c.billing_line1, c.billing_line2].filter(Boolean).join(', '), [c.billing_city, c.billing_state, c.billing_zip].filter(Boolean).join(', '), c.phone, c.email].filter(Boolean)).map((l, i) => (
          <div key={i} className="doc-meta">{l}</div>
        ))}
      </div>

      <table className="doc-table">
        <thead>
          <tr>
            <th className="n">#</th>
            <th>Description</th>
            <th className="r">Qty</th>
            <th className="r">Unit price</th>
            <th className="r">Amount</th>
          </tr>
        </thead>
        <tbody>
          {snapshot.lines.map((l, i) => (
            <tr key={l.position}>
              <td className="n">{i + 1}</td>
              <td className="desc">{l.description}</td>
              <td className="r">{l.quantity} {l.unit_label}</td>
              <td className="r">{money(l.unit_price_cents)}</td>
              <td className="r">{money(l.line_total_cents)}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <div className="doc-totals">
        <div className="doc-total-row"><span>Subtotal</span><span>{money(t.subtotal_cents)}</span></div>
        {t.discount_cents > 0 && <div className="doc-total-row"><span>Discount</span><span>-{money(t.discount_cents)}</span></div>}
        {t.tax_by_rate.map((g) => (
          <div className="doc-total-row" key={g.rate}><span>Tax {(Number(g.rate) * 100).toFixed(2)}%</span><span>{money(g.cents)}</span></div>
        ))}
        {t.shipping_cents > 0 && <div className="doc-total-row"><span>Shipping &amp; handling</span><span>{money(t.shipping_cents)}</span></div>}
        <div className="doc-total-row grand"><span>Total due</span><span>{money(t.total_cents)}</span></div>
      </div>

      {(snapshot.notes || snapshot.terms || snapshot.payment_instructions) && (
        <div className="doc-notes">
          {snapshot.notes && <div className="doc-note-block"><div className="doc-section-label">Notes</div><div className="doc-note-text">{snapshot.notes}</div></div>}
          {snapshot.terms && <div className="doc-note-block"><strong>Terms:</strong> {snapshot.terms}</div>}
          {snapshot.payment_instructions && <div className="doc-note-block"><div className="doc-section-label">Payment instructions</div><div className="doc-note-text">{snapshot.payment_instructions}</div></div>}
        </div>
      )}

      <div className="doc-footer">Thank you for your business!</div>
    </div>
  );
}
