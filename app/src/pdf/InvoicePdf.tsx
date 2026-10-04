import { Document, Image, Page, StyleSheet, Text, View } from '@react-pdf/renderer';
import type { InvoiceSnapshot, SnapshotLine } from '../lib/snapshot';
import type { TemplateId } from '../templates/templates';

export type PdfPageSize = 'LETTER' | 'A4';
const PAGE: Record<PdfPageSize, { label: string; linesPerPage: number }> = {
  LETTER: { label: 'LETTER', linesPerPage: 22 },
  A4: { label: 'A4', linesPerPage: 24 },
};

function money(cents: number): string {
  const sign = cents < 0 ? '-' : '';
  const abs = Math.abs(Math.round(cents));
  return `${sign}$${Math.floor(abs / 100).toLocaleString('en-US')}.${String(abs % 100).padStart(2, '0')}`;
}

function pct(rate: string): string {
  return `${(Number(rate) * 100).toFixed(2)}%`;
}

const styles = StyleSheet.create({
  page: { paddingTop: 44, paddingBottom: 48, paddingHorizontal: 48, fontFamily: 'Helvetica', fontSize: 10, color: '#1a1d21' },
  headerRow: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 18 },
  businessName: { fontSize: 17, fontWeight: 'bold', marginBottom: 4 },
  businessMeta: { fontSize: 9, color: '#5b6470', lineHeight: 1.4 },
  logo: { width: 110, height: 60, objectFit: 'contain', marginBottom: 6 },
  titleBlock: { textAlign: 'right' },
  title: { fontSize: 24, fontWeight: 'bold', letterSpacing: 2, marginBottom: 6 },
  meta: { fontSize: 9, color: '#1a1d21', marginBottom: 2 },
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
  totalsBox: { width: 240 },
  totalRow: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 3, fontSize: 10 },
  grandRow: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 6, fontSize: 13, fontWeight: 'bold', borderTopWidth: 2, borderTopColor: '#1a1d21', marginTop: 4 },
  notes: { marginTop: 14, fontSize: 9.5, lineHeight: 1.45 },
  notesLabel: { fontWeight: 'bold', marginBottom: 2 },
  footer: { position: 'absolute', bottom: 28, left: 48, right: 48, textAlign: 'center', fontSize: 9, color: '#5b6470' },
  modernBar: { height: 6, backgroundColor: '#1d4ed8', marginBottom: 14 },
  compactPage: { fontSize: 9 },
});

function addressLines(b: InvoiceSnapshot['business']): string[] {
  const lines: string[] = [];
  const street = [b.address_line1, b.address_line2].filter(Boolean).join(', ');
  if (street) lines.push(street);
  const city = [b.city, b.state, b.zip].filter(Boolean).join(', ');
  if (city) lines.push(city);
  if (b.phone) lines.push(b.phone);
  if (b.email) lines.push(b.email);
  if (b.website) lines.push(b.website);
  return lines;
}

function Header({ snap, template, logoUrl }: { snap: InvoiceSnapshot; template: TemplateId; logoUrl?: string }) {
  return (
    <View>
      {template === 'modern' && <View style={styles.modernBar} />}
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
          <Text style={styles.title}>INVOICE</Text>
          <Text style={styles.meta}>Invoice #: {snap.invoice_number}</Text>
          <Text style={styles.meta}>Date: {snap.invoice_date}</Text>
          {snap.due_date && <Text style={styles.meta}>Due: {snap.due_date}</Text>}
          {snap.po_number && <Text style={styles.meta}>P.O. #{snap.po_number}</Text>}
        </View>
      </View>
    </View>
  );
}

function TableHeader() {
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

function Totals({ snap }: { snap: InvoiceSnapshot }) {
  const t = snap.totals;
  return (
    <View style={styles.totalsWrap} wrap={false}>
      <View style={styles.totalsBox}>
        <View style={styles.totalRow}><Text>Subtotal</Text><Text>{money(t.subtotal_cents)}</Text></View>
        {t.discount_cents > 0 && (
          <View style={styles.totalRow}><Text>Discount</Text><Text>-{money(t.discount_cents)}</Text></View>
        )}
        {t.tax_by_rate.map((g) => (
          <View style={styles.totalRow} key={g.rate}><Text>Tax {pct(g.rate)}</Text><Text>{money(g.cents)}</Text></View>
        ))}
        {t.shipping_cents > 0 && (
          <View style={styles.totalRow}><Text>Shipping &amp; handling</Text><Text>{money(t.shipping_cents)}</Text></View>
        )}
        <View style={styles.grandRow}><Text>Total due</Text><Text>{money(t.total_cents)}</Text></View>
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
      {snap.payment_instructions && (
        <View style={{ marginBottom: 8 }}>
          <Text style={styles.notesLabel}>Payment instructions</Text>
          <Text>{snap.payment_instructions}</Text>
        </View>
      )}
    </View>
  );
}

export function InvoicePdf({
  snapshot,
  template = 'classic',
  pageSize = 'LETTER',
  logoUrl,
}: {
  snapshot: InvoiceSnapshot;
  template?: TemplateId;
  pageSize?: PdfPageSize;
  logoUrl?: string;
}) {
  const { label, linesPerPage } = PAGE[pageSize];
  const chunks: SnapshotLine[][] = [];
  for (let i = 0; i < snapshot.lines.length; i += linesPerPage) {
    chunks.push(snapshot.lines.slice(i, i + linesPerPage));
  }
  if (chunks.length === 0) chunks.push([]);

  const cust = snapshot.customer;
  const custLines: string[] = [];
  if (cust) {
    const street = [cust.billing_line1, cust.billing_line2].filter(Boolean).join(', ');
    if (street) custLines.push(street);
    const city = [cust.billing_city, cust.billing_state, cust.billing_zip].filter(Boolean).join(', ');
    if (city) custLines.push(city);
    if (cust.phone) custLines.push(cust.phone);
    if (cust.email) custLines.push(cust.email);
  }

  return (
    <Document title={`Invoice ${snapshot.invoice_number}`} author={snapshot.business.display_name}>
      {chunks.map((chunk, pageIdx) => (
        <Page key={pageIdx} size={label as 'LETTER'} style={[styles.page, template === 'compact' ? styles.compactPage : undefined]}>
          {pageIdx === 0 ? (
            <View>
              <Header snap={snapshot} template={template} logoUrl={logoUrl} />
              <View style={styles.billTo}>
                <Text style={styles.sectionLabel}>Bill to</Text>
                <Text style={styles.billToName}>{cust ? cust.name : '—'}</Text>
                {cust?.contact_person && <Text style={styles.billToMeta}>Attn: {cust.contact_person}</Text>}
                {custLines.map((l, i) => (
                  <Text key={i} style={styles.billToMeta}>{l}</Text>
                ))}
              </View>
            </View>
          ) : (
            <Text style={styles.continued}>Invoice {snapshot.invoice_number} — continued (page {pageIdx + 1})</Text>
          )}

          <View style={styles.table}>
            <TableHeader />
            {chunk.map((l, i) => (
              <View key={l.position} style={styles.tableRow} wrap={false}>
                <Text style={[styles.td, styles.colNum]}>{pageIdx * linesPerPage + i + 1}</Text>
                <Text style={[styles.td, styles.colDesc]}>{l.description}</Text>
                <Text style={[styles.td, styles.colQty]}>{l.quantity} {l.unit_label}</Text>
                <Text style={[styles.td, styles.colPrice]}>{money(l.unit_price_cents)}</Text>
                <Text style={[styles.td, styles.colAmount]}>{money(l.line_total_cents)}</Text>
              </View>
            ))}
          </View>

          {pageIdx === chunks.length - 1 && (
            <View>
              <Totals snap={snapshot} />
              <Notes snap={snapshot} />
            </View>
          )}

          <Text
            style={styles.footer}
            render={({ pageNumber, totalPages }) => `Thank you for your business! — Page ${pageNumber} of ${totalPages}`}
            fixed
          />
        </Page>
      ))}
    </Document>
  );
}

/** Safe, descriptive filename: Invoice-<number>-<customer>.pdf */
export function invoicePdfFilename(snapshot: InvoiceSnapshot): string {
  const safe = (s: string) => s.replace(/[^a-zA-Z0-9-_]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60);
  const cust = snapshot.customer ? `-${safe(snapshot.customer.name)}` : '';
  return `Invoice-${safe(snapshot.invoice_number)}${cust}.pdf`;
}
