import { Document, Page, StyleSheet, Text, View } from '@react-pdf/renderer';
import type { InvoiceSnapshot } from '../lib/snapshot';
import type { Payment, PaymentMethod } from '../db/types';

const METHOD_LABEL: Record<PaymentMethod, string> = {
  cash: 'Cash',
  check: 'Check',
  bank_transfer: 'Bank transfer',
  other: 'Other',
};

function money(cents: number): string {
  const abs = Math.abs(Math.round(cents));
  return `$${Math.floor(abs / 100).toLocaleString('en-US')}.${String(abs % 100).padStart(2, '0')}`;
}

const styles = StyleSheet.create({
  page: { paddingTop: 48, paddingBottom: 48, paddingHorizontal: 52, fontFamily: 'Helvetica', fontSize: 10.5, color: '#1a1d21' },
  title: { fontSize: 22, fontWeight: 'bold', letterSpacing: 2, marginBottom: 4 },
  sub: { fontSize: 10, color: '#5b6470', marginBottom: 20 },
  businessName: { fontSize: 14, fontWeight: 'bold', marginBottom: 2 },
  businessMeta: { fontSize: 9, color: '#5b6470', marginBottom: 12, lineHeight: 1.4 },
  box: { borderWidth: 1, borderColor: '#d7dde4', borderRadius: 6, padding: 14, marginBottom: 14 },
  row: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 4, fontSize: 10.5 },
  rowLabel: { color: '#5b6470' },
  divider: { borderBottomWidth: 1, borderBottomColor: '#d7dde4', marginVertical: 6 },
  big: { fontSize: 15, fontWeight: 'bold' },
  footer: { marginTop: 24, textAlign: 'center', fontSize: 9.5, color: '#5b6470' },
});

export function ReceiptPdf({
  snapshot,
  payment,
  balanceCents,
}: {
  snapshot: InvoiceSnapshot;
  payment: Payment;
  balanceCents: number;
}) {
  const b = snapshot.business;
  return (
    <Document title={`Receipt ${snapshot.invoice_number}`} author={b.display_name}>
      <Page size="LETTER" style={styles.page}>
        <Text style={styles.title}>PAYMENT RECEIPT</Text>
        <Text style={styles.sub}>Receipt for invoice {snapshot.invoice_number}</Text>

        <Text style={styles.businessName}>{b.display_name}</Text>
        <Text style={styles.businessMeta}>
          {[b.address_line1, [b.city, b.state, b.zip].filter(Boolean).join(', ')].filter(Boolean).join('\n')}
          {b.phone ? `\n${b.phone}` : ''}{b.email ? `\n${b.email}` : ''}
        </Text>

        <View style={styles.box}>
          <View style={styles.row}><Text style={styles.rowLabel}>Invoice</Text><Text>{snapshot.invoice_number}</Text></View>
          <View style={styles.row}><Text style={styles.rowLabel}>Billed to</Text><Text>{snapshot.customer?.name ?? '—'}</Text></View>
          <View style={styles.row}><Text style={styles.rowLabel}>Invoice total</Text><Text>{money(snapshot.totals.total_cents)}</Text></View>
          <View style={styles.divider} />
          <View style={styles.row}><Text style={styles.rowLabel}>Payment date</Text><Text>{payment.payment_date}</Text></View>
          <View style={styles.row}><Text style={styles.rowLabel}>Method</Text><Text>{METHOD_LABEL[payment.method]}</Text></View>
          {payment.reference && <View style={styles.row}><Text style={styles.rowLabel}>Reference</Text><Text>{payment.reference}</Text></View>}
          {payment.note && <View style={styles.row}><Text style={styles.rowLabel}>Note</Text><Text>{payment.note}</Text></View>}
          <View style={styles.divider} />
          <View style={styles.row}><Text style={styles.big}>Amount received</Text><Text style={styles.big}>{money(payment.amount_cents)}</Text></View>
          <View style={styles.row}><Text style={styles.rowLabel}>Remaining balance</Text><Text>{money(balanceCents)}</Text></View>
        </View>

        {payment.reversed_at && (
          <Text style={{ fontSize: 10, color: '#b42318', marginBottom: 8 }}>
            This payment was reversed on {payment.reversed_at.slice(0, 10)}: {payment.reversed_reason}
          </Text>
        )}

        <Text style={styles.footer}>Thank you for your business!</Text>
      </Page>
    </Document>
  );
}

export function receiptPdfFilename(snapshot: InvoiceSnapshot, payment: Payment): string {
  const safe = (s: string) => s.replace(/[^a-zA-Z0-9-_]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60);
  return `Receipt-${safe(snapshot.invoice_number)}-${payment.payment_date}.pdf`;
}
