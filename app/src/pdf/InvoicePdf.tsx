import { Document, Image, Page, StyleSheet, Text, View } from '@react-pdf/renderer';
import type { InvoiceSnapshot, SnapshotLine } from '../lib/snapshot';
import { exifRawToDate, formatDuration, formatIsoDateTime } from '../lib/exif';
import {
  BOARDUP_FORMULA_NOTE,
  PHOTOS_PER_PDF_PAGE,
  asBoardUpDetails,
  boardUpOutputRows,
  boardUpPhotoCaption,
  chunkArray,
  estimateBoardUp,
} from '../lib/boardup';

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
  wireTitle: { fontSize: 12, fontWeight: 'bold', marginBottom: 6 },
  wireText: { fontSize: 12, fontWeight: 'bold', lineHeight: 1.5 },
  propLine: { fontSize: 11, marginBottom: 10 },
  agentLine: { fontSize: 10, marginBottom: 3 },
  buRow: { flexDirection: 'row', marginBottom: 4, fontSize: 10.5, lineHeight: 1.4 },
  buLabel: { width: 150, fontWeight: 'bold' },
  buValue: { flex: 1 },
  buEstBox: { backgroundColor: '#eff6ff', borderWidth: 1, borderColor: '#bfdbfe', borderRadius: 6, padding: 10, marginTop: 10, marginBottom: 6 },
  buEstTitle: { fontSize: 13, fontWeight: 'bold', marginBottom: 2 },
  buEstMeta: { fontSize: 10.5 },
  buFormula: { fontSize: 8, color: '#5b6470', marginBottom: 10 },
  buContact: { marginTop: 14, paddingTop: 8, borderTopWidth: 1, borderTopColor: '#d1d5db' },
  buContactName: { fontSize: 11, fontWeight: 'bold', marginBottom: 2 },
  buContactLine: { fontSize: 10, color: '#374151', marginBottom: 1 },
  buPhotoPage: { flexDirection: 'row', flexWrap: 'wrap', marginTop: 6, marginBottom: 2 },
  buPhotoCell: { width: '48%', marginRight: '2%', marginBottom: 10 },
  buPhotoImg: { width: '100%', height: 230, objectFit: 'contain', backgroundColor: '#efe9de' },
  /** Dark address banner under each photo, matching the reference PDF. */
  buPhotoCaption: {
    fontSize: 9,
    fontWeight: 'bold',
    color: '#ffffff',
    backgroundColor: '#22303f',
    padding: 6,
  },
  /** Screenshot-style photo page header: "{BUSINESS} — JOB PHOTOS" + count + address. */
  buPhotosTitle: { fontSize: 15, fontWeight: 'bold', marginTop: 10, marginBottom: 2 },
  buPhotosCount: { fontSize: 11, fontWeight: 'bold', color: '#c2410c', marginBottom: 2 },
  buPhotosAddr: { fontSize: 10, marginBottom: 4 },
  /** Taken-at date/time under each job photo. */
  buPhotoTakenAt: { fontSize: 8.5, color: '#4b5563', marginTop: 3 },
  /** Labeled job timeline box at the top of the job detail PDF. */
  buTimeline: {
    backgroundColor: '#f1f5f9',
    borderWidth: 1,
    borderColor: '#cbd5e1',
    borderRadius: 8,
    padding: 10,
    marginBottom: 12,
  },
  buTimelineTitle: {
    fontSize: 9,
    fontWeight: 'bold',
    color: '#64748b',
    marginBottom: 6,
  },
  buTimelineRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 3,
  },
  buTimelineLabel: { fontSize: 10, color: '#475569' },
  buTimelineValue: { fontSize: 10, fontWeight: 'bold', color: '#0f172a' },
  buTimelineTotal: {
    marginTop: 4,
    paddingTop: 6,
    borderTopWidth: 1,
    borderTopColor: '#cbd5e1',
  },
  buTimelineTotalValue: { fontSize: 11, fontWeight: 'bold', color: '#1d4ed8' },
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
      {(c.property_address || c.property_city || c.property_state || c.property_zip) && (
        <Text style={styles.propLine}>
          <Text style={{ fontWeight: 'bold' }}>Property: </Text>
          {[c.property_address, [c.property_city, c.property_state].filter(Boolean).join(', ') + (c.property_zip ? ` ${c.property_zip}` : '')].filter((s) => s && s.trim()).join(', ')}
        </Text>
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

/** One board-up job photo for the PDF: display URL + taken-at time. */
export interface BoardUpPhotoItem {
  url: string;
  /** Formatted taken-at time ('' when unknown). */
  takenAt: string;
  /** Raw EXIF "YYYY:MM:DD HH:MM:SS" (null when unknown) — for duration math. */
  takenAtRaw: string | null;
}

/**
 * The job timeline printed above the photo pages:
 * - First input: when the job came in (invoice created_at).
 * - Start job: first photo's taken-at time.
 * - End job: last photo's taken-at time.
 * - Time to job site: first photo time minus job input time.
 * Each is '' when unknown.
 */
export function boardUpTimeline(
  snap: InvoiceSnapshot,
  photos: BoardUpPhotoItem[],
): { firstInput: string; startJob: string; endJob: string; timeToSite: string } {
  const withTime = photos.filter((p) => p.takenAt !== '');
  const firstInputIso = snap.job_created_at ?? snap.issued_at ?? null;
  let timeToSite = '';
  if (firstInputIso && withTime.length > 0 && withTime[0].takenAtRaw) {
    const inputDate = new Date(firstInputIso);
    const startDate = exifRawToDate(withTime[0].takenAtRaw);
    if (!Number.isNaN(inputDate.getTime()) && startDate) {
      timeToSite = formatDuration(startDate.getTime() - inputDate.getTime());
    }
  }
  return {
    firstInput: formatIsoDateTime(firstInputIso),
    startJob: withTime.length > 0 ? withTime[0].takenAt : '',
    endJob: withTime.length > 0 ? withTime[withTime.length - 1].takenAt : '',
    timeToSite,
  };
}

/** Photos-only pages for the separate pictures PDF (matches the original's split PDFs). */
function BoardUpPhotosBody({ snap, photos }: { snap: InvoiceSnapshot; photos: BoardUpPhotoItem[] }) {
  const d = asBoardUpDetails(snap.boardup_details);
  /** Property address printed under every photo, matching the source app. */
  const caption = boardUpPhotoCaption(d);
  // Dan, Oct 26: every picture page header prints the job date (+ time, when recorded).
  const jobDate = snap.invoice_date
    ? (() => {
        const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(snap.invoice_date);
        const date = m ? `${parseInt(m[2], 10)}/${parseInt(m[3], 10)}/${m[1]}` : snap.invoice_date;
        return d.jobTime.trim() ? `${date} ${d.jobTime.trim()}` : date;
      })()
    : '';
  return (
    <BoardUpPhotoPages caption={caption} photos={photos} dateLabel={jobDate} />
  );
}

/**
 * Photo pages in the customer's screenshot style: "{BUSINESS} — JOB PHOTOS"
 * header, "{N} PICTURES • PAGE X OF Y" count line, property address, then a
 * 2×2 grid with the address captioned under every photo.
 */
function BoardUpPhotoPages({
  caption,
  photos,
  dateLabel,
}: {
  caption: string;
  photos: BoardUpPhotoItem[];
  dateLabel?: string;
}) {
  const totalPages = Math.max(1, Math.ceil(photos.length / PHOTOS_PER_PDF_PAGE));
  return (
    <View>
      {chunkArray(photos, PHOTOS_PER_PDF_PAGE).map((page, pi) => (
        <View key={pi} wrap={false} break={pi > 0}>
          <Text style={styles.buPhotosTitle}>A QUICK BOARD UP SERVICE — JOB PHOTOS</Text>
          <Text style={styles.buPhotosCount}>
            {photos.length} PICTURES • PAGE {pi + 1} OF {totalPages}
            {dateLabel ? ` • ${dateLabel}` : ''}
          </Text>
          {caption !== '' && <Text style={styles.buPhotosAddr}>{caption}</Text>}
          <View style={styles.buPhotoPage}>
            {page.map((p, i) => (
              <View key={i} style={styles.buPhotoCell}>
                <Image src={p.url} style={styles.buPhotoImg} />
                {caption !== '' && <Text style={styles.buPhotoCaption}>{caption}</Text>}
                {p.takenAt !== '' && <Text style={styles.buPhotoTakenAt}>{p.takenAt}</Text>}
              </View>
            ))}
          </View>
        </View>
      ))}
    </View>
  );
}

/** Board-up job sheet body: all intake fields, live material estimate, and job photos. */
function BoardUpBody({
  snap,
  photos,
  includePhotos,
}: {
  snap: InvoiceSnapshot;
  photos: BoardUpPhotoItem[];
  includePhotos: boolean;
}) {
  const d = asBoardUpDetails(snap.boardup_details);
  const est = estimateBoardUp(d.windows, d.doors, d.sliders, d.garageDoors, d.acUnits);
  /** Property address printed under every photo, matching the source app. */
  const caption = boardUpPhotoCaption(d);
  /** Robert's 12-line output layout; "Date and time" is when the job came in.
   * Values only, no field labels — the same layout as the SMS text he asked for. */
  const values: string[] = boardUpOutputRows(d, {
    jobDateTime: snap.job_created_at ?? snap.issued_at ?? null,
  })
    .filter(([, v]) => v !== '')
    .flatMap(([, v]) => v.split('\n'))
    .filter((v) => v !== '');
  const timeline = boardUpTimeline(snap, photos);
  const showTimeline =
    timeline.firstInput !== '' ||
    timeline.startJob !== '' ||
    timeline.endJob !== '' ||
    timeline.timeToSite !== '';
  return (
    <View>
      {showTimeline && (
        <View style={styles.buTimeline}>
          <Text style={styles.buTimelineTitle}>JOB TIMELINE</Text>
          {timeline.firstInput !== '' && (
            <View style={styles.buTimelineRow}>
              <Text style={styles.buTimelineLabel}>First input</Text>
              <Text style={styles.buTimelineValue}>{timeline.firstInput}</Text>
            </View>
          )}
          {timeline.startJob !== '' && (
            <View style={styles.buTimelineRow}>
              <Text style={styles.buTimelineLabel}>Start job</Text>
              <Text style={styles.buTimelineValue}>{timeline.startJob}</Text>
            </View>
          )}
          {timeline.endJob !== '' && (
            <View style={styles.buTimelineRow}>
              <Text style={styles.buTimelineLabel}>End job</Text>
              <Text style={styles.buTimelineValue}>{timeline.endJob}</Text>
            </View>
          )}
          {timeline.timeToSite !== '' && (
            <View style={[styles.buTimelineRow, styles.buTimelineTotal]}>
              <Text style={styles.buTimelineLabel}>Time to job site</Text>
              <Text style={styles.buTimelineTotalValue}>{timeline.timeToSite}</Text>
            </View>
          )}
        </View>
      )}
      {values.map((v, i) => (
        <Text key={i} style={styles.buRow}>
          {v}
        </Text>
      ))}
      <View style={styles.buEstBox}>
        <Text style={styles.buEstTitle}>{est.sheets} PLYWOOD SHEETS EST.</Text>
        <Text style={styles.buEstMeta}>
          SQ FT COVER: {est.sqftCover} · 4×8 SHEETS: {est.sheets}
        </Text>
        <Text style={styles.buEstMeta}>
          Windows: {d.windows} · Doors: {d.doors} · Sliders / patios: {d.sliders} · Garage doors: {d.garageDoors}
        </Text>
      </View>
      <Text style={styles.buFormula}>{BOARDUP_FORMULA_NOTE}</Text>
      {snap.boardup_crew_contact && (snap.boardup_crew_contact.phone || snap.boardup_crew_contact.email) && (
        <View style={styles.buContact}>
          <Text style={styles.buContactName}>{snap.boardup_crew_contact.name}</Text>
          {snap.boardup_crew_contact.phone && (
            <Text style={styles.buContactLine}>{snap.boardup_crew_contact.phone}</Text>
          )}
          {snap.boardup_crew_contact.email && (
            <Text style={styles.buContactLine}>{snap.boardup_crew_contact.email}</Text>
          )}
        </View>
      )}
      {includePhotos && photos.length > 0 && (
        <BoardUpPhotoPages caption={caption} photos={photos} />
      )}
    </View>
  );
}

export function InvoicePdf({
  snapshot,
  style = 'classic',
  pageSize = 'LETTER',
  logoUrl,
  photos = [],
  includePhotos = true,
  photosOnly = false,
}: {
  snapshot: InvoiceSnapshot;
  style?: InvoiceStyle;
  pageSize?: PdfPageSize;
  logoUrl?: string;
  /** Resolved board-up job photos with taken-at times (template 'boardup' only). */
  photos?: BoardUpPhotoItem[];
  /** When false, photo pages are omitted (the timeline still uses taken-at times). */
  includePhotos?: boolean;
  /** Photos-only board-up document (the separate pictures PDF). */
  photosOnly?: boolean;
}) {
  const { label, linesPerPage } = PAGE[pageSize];
  const isCommission = snapshot.template === 'commission';
  const isBoardUp = snapshot.template === 'boardup';
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

  const title = isCommission ? 'COMMISSION' : isBoardUp ? 'BOARD-UP JOB' : 'INVOICE';
  const subtitle = isCommission ? 'Wire instructions' : undefined;
  const pageStyle = [styles.page, style === 'compact' ? styles.compactPage : undefined];

  if (isBoardUp && photosOnly) {
    return (
      <Document title={`Aquick Job Photos ${snapshot.invoice_number}`} author={snapshot.business.display_name}>
        <Page size={label} style={pageStyle}>
          <BoardUpPhotosBody snap={snapshot} photos={photos} />
        </Page>
      </Document>
    );
  }

  if (isBoardUp) {
    return (
      <Document title={`Aquick Job ${snapshot.invoice_number}`} author={snapshot.business.display_name}>
        <Page size={label} style={pageStyle}>
          <Header snap={snapshot} style={style} logoUrl={logoUrl} title={title} subtitle={subtitle} />
          <BoardUpBody snap={snapshot} photos={photos} includePhotos={includePhotos} />
          <Text style={styles.footer} render={({ pageNumber, totalPages }) => `Page ${pageNumber} of ${totalPages}`} fixed />
        </Page>
      </Document>
    );
  }

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
