import { Document, Image, Page, StyleSheet, Text, View } from '@react-pdf/renderer';
import type { InvoiceSnapshot, SnapshotLine } from '../lib/snapshot';

export type PdfPageSize = 'LETTER' | 'A4';
export type InvoiceStyle = 'classic' | 'modern' | 'compact';

const PAGE: Record<PdfPageSize, { label: 'LETTER' | 'A4'; linesPerPage: number }> = {
  LETTER: { label: 'LETTER', linesPerPage: 22 },
  A4: { label: 'A4', linesPerPage: 24 },
};

export function pdfMoney(cents: number): string {
  const sign = cents < 0 ? '-' : '';
  const abs = Math.abs(Math.round(cents));
  return `${sign}$${Math.floor(abs / 100).toLocaleString('en-US')}.${String(abs % 100).padStart(2, '0')}`;
}

function pct(rate: string): string {
  return `${(Number(rate) * 100).toFixed(2)}%`;
}

const ACCENT: Record<InvoiceStyle, string> = {
  classic: '#1a1d21',
  modern: '#1d4ed8',
  compact: '#1a1d21',
};

const styles = StyleSheet.create({
  page: { paddingTop: 44, paddingBottom: 48, paddingHorizontal: 48, fontFamily: 'Helvetica', fontSize: 10, color: '#1a1d21' },
  compactPage: { fontSize: 9, paddingTop: 36, paddingHorizontal: 40 },
  headerRow: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 18 },
  businessName: { fontSize: 17, fontWeight: 'bold', marginBottom: 4 },
  businessMeta: { fontSize: 9, color: '#5b6470', lineHeight: 1.4 },
  logo: { width: 110, height: 60, objectFit: 'contain', marginBottom: 6 },
  titleBlock: { textAlign: 'right' },
  title: { fontSize: 24, fontWeight: 'bold', letterSpacing: 2, marginBottom: 6 },
  meta: { fontSize: 9, marginBottom: 2 },
  billTo: { marginBottom: 14 },
  billToName: { fontSize: 11, fontWeight: 'bold', marginBottom: 2 },
  billToMeta: { fontSize: 9, color: '#5b6470', lineHeight: 1.4 },
  sectionLabel: { fontSize: 9, fontWeight: 'bold', color: '#5b6470', marginBottom: 4, textTransform: 'uppercase' },
  table: { marginBottom: 12 },
  tableHeader: { flexDirection: 'row', borderBottomWidth: 2, borderBottomColor: '#1a1d21', paddingBottom: 5, marginBottom: 2 },
  tableRow: { flexDirection: 'row', borderBottomWidth: 0.5, borderBottomColor: '#d7dde4', paddingVertical: 5 },
  colNum: { width: '6%' },
  colDesc: { width: '46%' },
  colQty: { width: '14%', textAlign: 'right' },
  colPrice: { width: '16%', textAlign: 'right' },
  colAmount: { width: '18%', textAlign: 'right' },
  th: { fontSize: 8, fontWeight: 'bold', textTransform: 'uppercase', color: '#5b6470' },
  td: { fontSize: 9.5, lineHeight: 1.35 },
  continued: { fontSize: 8, color: '#5b6470', fontStyle: 'italic', marginBottom: 6 },
  totalsWrap: { marginTop: 4, alignItems: 'flex-end' },
  totalsBox: { width: 250 },
  totalRow: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 3, fontSize: 10 },
  grandRow: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 6, fontSize: 13, fontWeight: 'bold', borderTopWidth: 2, borderTopColor: '#1a1d21', marginTop: 4 },
  notes: { marginTop: 14, fontSize: 9.5, lineHeight: 1.45 },
  notesLabel: { fontWeight: 'bold', marginBottom: 2 },
  footer: { position: 'absolute', bottom: 28, left: 48, right: 48, textAlign: 'center', fontSize: 9, color: '#5b6470' },
  accentBar: { height: 6, borderRadius: 3, marginBottom: 14 },
  wireBox: { marginTop: 14, backgroundColor: '#e7f3e7', borderWidth: 1, borderColor: '#b9d8b9', borderRadius: 6, padding: 12 },
  wireTitle: { fontSize: 10, fontWeight: 'bold', marginBottom: 6 },
  wireText: { fontSize: 10, fontWeight: 'bold', lineHeight: 1.5 },
  propLine: { fontSize: 11, marginBottom: 10 },
  agentLine: { fontSize: 10, marginBottom: 3 },
});

function addressLines(b: InvoiceSnapshot['business']): string[] {
  const lines: string[] = [];
  if (b.header_line) lines.push(b.header_line);
  const street = [b.address_line1, b.address_line2].filter(Boolean).join(', ');
  if (street) lines.push(street);
  const city = [b.city, b.state, b.zip].filter(Boolean).join(', ');
  if (city) lines.push(city);
  if (b.phone) lines.push(b.phone);
  if (b.email) lines.push(b.email);
  if (b.website) lines.push(b.website);
  return lines;
}

function Header({
  snap, style, logoUrl, title, subtitle,
}: {
  snap: InvoiceSnapshot; style: InvoiceStyle; logoUrl?: string; title: string; subtitle?: string;
}) {
  return (
    <View>
      {style === 'modern' && <View style={[styles.accentBar, { backgroundColor: ACCENT[style] }]} />}
      <View style={styles.headerRow}>
        <View>
          {logoUrl && <Image style={styles.logo} src={logoUrl} />}
          <Text style={styles.businessName}>{snap.business.display_name}</Text>
          {snap.business.legal_name && <Text style={styles.businessMeta}>{snap.business.legal_name}</Text>}
          {addressLines(snap.business).map((l, i) => (
            <Text key={i} style={styles.businessMeta}>{l}</Text>
          ))}
          {snap.business.tax_id && <Text style={styles.businessMeta}>Tax ID: {snap.business.tax_id}</Text>}
        </View>
        <View style={styles.titleBlock}>
          <Text style={styles.title}>{title}</Text>
          {subtitle && <Text style={styles.meta}>{subtitle}</Text>}
          <Text style={styles.meta}>Invoice #: {snap.invoice_number}</Text>
          <Text style={styles.meta}>Date: {snap.invoice_date}</Text>
          {snap.due_date && <Text style={styles.meta}>Due: {snap.due_date}</Text>}
          {snap.po_number && <Text style={styles.meta}>P.O. #{snap.po_number}</Text>}
        </View>
      </View>
    </View>
  );
}

function Notes({ snap }: { snap: InvoiceSnapshot }) {
  return (
    <View style={styles.notes}>
      {snap.notes && (
        <View style={{ marginBottom: 8 }}>
          <Text style={styles.notesLabel}>Notes</Text>
          <Text>{snap.notes}</Text>
        </View>
      )}
      {snap.terms && (
        <View style={{ marginBottom: 8 }}>
          <Text><Text style={styles.notesLabel}>Terms: </Text>{snap.terms}</Text>
        </View>
      )}
      {snap.template === 'standard' && snap.payment_instructions && (
        <View style={{ marginBottom: 8 }}>
          <Text style={styles.notesLabel}>Payment instructions</Text>
          <Text>{snap.payment_instructions}</Text>
        </View>
      )}
    </View>
  );
}

function StandardTableHeader() {
  return (
    <View style={styles.tableHeader}>
      <Text style={[styles.th, styles.colNum]}>#</Text>
      <Text style={[styles.th, styles.colDesc]}>Description</Text>
      <Text style={[styles.th, styles.colQty]}>Qty</Text>
      <Text style={[styles.th, styles.colPrice]}>Unit price</Text>
      <Text style={[styles.th, styles.colAmount]}>Amount</Text>
    </View>
  );
}

function StandardTotals({ snap }: { snap: InvoiceSnapshot }) {
  const t = snap.totals;
  return (
    <View>
      <View style={styles.totalsWrap} wrap={false}>
        <View style={styles.totalsBox}>
          <View style={styles.totalRow}><Text>Subtotal</Text><Text>{pdfMoney(t.subtotal_cents)}</Text></View>
          {t.discount_cents > 0 && (
            <View style={styles.totalRow}><Text>Discount</Text><Text>-{pdfMoney(t.discount_cents)}</Text></View>
          )}
          {t.tax_by_rate.map((g) => (
            <View style={styles.totalRow} key={g.rate}><Text>Tax {pct(g.rate)}</Text><Text>{pdfMoney(g.cents)}</Text></View>
          ))}
          {t.shipping_cents > 0 && (
            <View style={styles.totalRow}><Text>Shipping &amp; handling</Text><Text>{pdfMoney(t.shipping_cents)}</Text></View>
          )}
          <View style={styles.grandRow}><Text>Total due</Text><Text>{pdfMoney(t.total_cents)}</Text></View>
        </View>
      </View>
      <Notes snap={snap} />
    </View>
  );
}

function CommissionBody({ snap }: { snap: InvoiceSnapshot }) {
  const c = snap.commission;
  const t = snap.totals;
  const pctStr = (c.commission_pct ?? '').trim();
  const otherDesc = (c.other_charge_desc ?? '').trim();
  const showOther = otherDesc !== '' || c.other_charge_cents > 0;
  const wire = snap.payment_instructions ?? '';

  return (
    <View>
      {c.property_address && (
        <Text style={styles.propLine}><Text style={{ fontWeight: 'bold' }}>Property: </Text>{c.property_address}</Text>
      )}
      {(c.agent_name || c.second_agent_name) && (
        <View style={{ marginBottom: 10 }}>
          {c.agent_name && <Text style={styles.agentLine}><Text style={{ fontWeight: 'bold' }}>Agent: </Text>{c.agent_name}</Text>}
          {c.second_agent_name && <Text style={styles.agentLine}><Text style={{ fontWeight: 'bold' }}>Second sales person: </Text>{c.second_agent_name}</Text>}
        </View>
      )}
      <View style={styles.table}>
        <View style={styles.tableHeader}>
          <Text style={[styles.th, { width: '70%' }]}>Description</Text>
          <Text style={[styles.th, { width: '30%', textAlign: 'right' }]}>Amount</Text>
        </View>
        <View style={styles.tableRow}>
          <Text style={[styles.td, { width: '70%' }]}>
            Real Estate Commission{pctStr !== '' ? ` (${pctStr}% of ${pdfMoney(c.sale_price_cents)})` : ''}
          </Text>
          <Text style={[styles.td, { width: '30%', textAlign: 'right' }]}>{pdfMoney(t.subtotal_cents)}</Text>
        </View>
        <View style={styles.tableRow}>
          <Text style={[styles.td, { width: '70%' }]}>Processing Fee</Text>
          <Text style={[styles.td, { width: '30%', textAlign: 'right' }]}>{pdfMoney(c.processing_fee_cents)}</Text>
        </View>
        {showOther && (
          <View style={styles.tableRow}>
            <Text style={[styles.td, { width: '70%' }]}>Other Charge{otherDesc !== '' ? ` — ${otherDesc}` : ''}</Text>
            <Text style={[styles.td, { width: '30%', textAlign: 'right' }]}>{pdfMoney(c.other_charge_cents)}</Text>
          </View>
        )}
      </View>
      <View style={styles.totalsWrap} wrap={false}>
        <View style={styles.totalsBox}>
          <View style={styles.grandRow}><Text>TOTAL</Text><Text>{pdfMoney(t.total_cents)}</Text></View>
        </View>
      </View>
      {snap.notes && (
        <View style={styles.notes}>
          <Text style={styles.notesLabel}>Notes</Text>
          <Text>{snap.notes}</Text>
        </View>
      )}
      {wire !== '' && (
        <View style={styles.wireBox} wrap={false}>
          {!/^wire instructions/im.test(wire) && <Text style={styles.wireTitle}>WIRE INSTRUCTIONS</Text>}
          <Text style={styles.wireText}>{wire}</Text>
        </View>
      )}
    </View>
  );
}

export function InvoicePdf({
  snapshot,
  style = 'classic',
  pageSize = 'LETTER',
  logoUrl,
}: {
  snapshot: InvoiceSnapshot;
  style?: InvoiceStyle;
  pageSize?: PdfPageSize;
  logoUrl?: string;
}) {
  const { label, linesPerPage } = PAGE[pageSize];
  const isCommission = snapshot.template === 'commission';
  const cust = snapshot.customer;

  // Paginate standard line items so table headers repeat on every page.
  const chunks: SnapshotLine[][] = [];
  if (!isCommission) {
    for (let i = 0; i < snapshot.lines.length; i += linesPerPage) {
      chunks.push(snapshot.lines.slice(i, i + linesPerPage));
    }
    if (chunks.length === 0) chunks.push([]);
  }

  const custLines: string[] = [];
  if (cust) {
    if (cust.company) custLines.push(cust.company);
    const street = [cust.billing_line1, cust.billing_line2].filter(Boolean).join(', ');
    if (street) custLines.push(street);
    const city = [cust.billing_city, cust.billing_state, cust.billing_zip].filter(Boolean).join(', ');
    if (city) custLines.push(city);
    if (cust.phone) custLines.push(cust.phone);
    if (cust.email) custLines.push(cust.email);
  }

  const title = isCommission ? 'COMMISSION' : 'INVOICE';
  const subtitle = isCommission ? 'Wire instructions' : undefined;
  const pageStyle = [styles.page, style === 'compact' ? styles.compactPage : undefined];

  const billTo = !isCommission && (
    <View style={styles.billTo}>
      <Text style={styles.sectionLabel}>Bill to</Text>
      <Text style={styles.billToName}>{cust ? cust.name : '—'}</Text>
      {cust?.contact_person && <Text style={styles.billToMeta}>Attn: {cust.contact_person}</Text>}
      {custLines.map((l, i) => (
        <Text key={i} style={styles.billToMeta}>{l}</Text>
      ))}
    </View>
  );

  if (isCommission) {
    return (
      <Document title={`Commission ${snapshot.invoice_number}`} author={snapshot.business.display_name}>
        <Page size={label} style={pageStyle}>
          <Header snap={snapshot} style={style} logoUrl={logoUrl} title={title} subtitle={subtitle} />
          <CommissionBody snap={snapshot} />
          <Text style={styles.footer} render={({ pageNumber, totalPages }) => `Page ${pageNumber} of ${totalPages}`} fixed />
        </Page>
      </Document>
    );
  }

  return (
    <Document title={`Invoice ${snapshot.invoice_number}`} author={snapshot.business.display_name}>
      {chunks.map((chunk, pageIdx) => (
        <Page key={pageIdx} size={label} style={pageStyle}>
          {pageIdx === 0 ? (
            <View>
              <Header snap={snapshot} style={style} logoUrl={logoUrl} title={title} subtitle={subtitle} />
              {billTo}
            </View>
          ) : (
            <Text style={styles.continued}>Invoice {snapshot.invoice_number} — continued (page {pageIdx + 1})</Text>
          )}
          <View style={styles.table}>
            <StandardTableHeader />
            {chunk.map((l, i) => (
              <View key={l.position} style={styles.tableRow} wrap={false}>
                <Text style={[styles.td, styles.colNum]}>{pageIdx * linesPerPage + i + 1}</Text>
                <Text style={[styles.td, styles.colDesc]}>{l.description}</Text>
                <Text style={[styles.td, styles.colQty]}>{l.quantity} {l.unit_label}</Text>
                <Text style={[styles.td, styles.colPrice]}>{pdfMoney(l.unit_price_cents)}</Text>
                <Text style={[styles.td, styles.colAmount]}>{pdfMoney(l.line_total_cents)}</Text>
              </View>
            ))}
          </View>
          {pageIdx === chunks.length - 1 && <StandardTotals snap={snapshot} />}
          <Text style={styles.footer} render={({ pageNumber, totalPages }) => `Thank you for your business! — Page ${pageNumber} of ${totalPages}`} fixed />
        </Page>
      ))}
    </Document>
  );
}

/** Safe, descriptive filename: Invoice-<number>[-<customer>].pdf */
export function invoicePdfFilename(snapshot: InvoiceSnapshot): string {
  const safe = (s: string) => s.replace(/[^a-zA-Z0-9-_]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60);
  const cust = snapshot.customer ? `-${safe(snapshot.customer.name)}` : '';
  return `Invoice-${safe(snapshot.invoice_number ?? 'draft')}${cust}.pdf`;
}
