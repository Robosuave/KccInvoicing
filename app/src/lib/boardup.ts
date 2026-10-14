/**
 * Board-Up job template (Aquick Board-up company): field definitions,
 * material-estimate math, and the plain-text job summary used by
 * Email-this-job / Text-this-job.
 *
 * Estimates only — there are intentionally NO dollar prices, rates, or cost
 * totals. Formula shown verbatim in the UI:
 * "Estimate uses 12 sq ft/window, 21/door, 32/slider, 64/garage + 15% waste.
 *  Planning only — measure on site."
 */

export interface BoardUpDetails {
  cityName: string;
  otherCustomerName: string;
  streetAddress: string;
  city: string;
  phone: string;
  caseNumber: string;
  requestingOfficer: string;
  propertyType: string;
  serviceNeeded: string;
  urgency: string;
  neededBy: string;
  /** Reference link, prefilled with the Aquick login URL (editable per job). */
  referenceLink: string;
  windows: number;
  doors: number;
  sliders: number;
  garageDoors: number;
  otherOpenings: string;
  crew: string;
  additionalCrew: string;
  accessNotes: string;
  emailTo: string;
  textTo: string;
  /** Storage paths (invoice-attachments bucket) of job photos. */
  photos: string[];
  /** Per-opening measurements, e.g. ["36x45"] — one entry per counted opening. */
  windowMeasurements: string[];
  doorMeasurements: string[];
  sliderMeasurements: string[];
  garageMeasurements: string[];
}

export const EMPTY_BOARDUP: BoardUpDetails = {
  cityName: '',
  otherCustomerName: '',
  streetAddress: '',
  city: '',
  phone: '',
  caseNumber: '',
  requestingOfficer: '',
  propertyType: 'Single-family',
  serviceNeeded: 'Emergency board-up',
  urgency: 'Today',
  neededBy: '',
  referenceLink: 'https://aquick.kalekycomputer.com',
  windows: 0,
  doors: 0,
  sliders: 0,
  garageDoors: 0,
  otherOpenings: '',
  crew: 'Dan',
  additionalCrew: '',
  accessNotes: '',
  emailTo: '',
  textTo: '',
  photos: [],
  windowMeasurements: [],
  doorMeasurements: [],
  sliderMeasurements: [],
  garageMeasurements: [],
};

export const CITY_NAME_OPTIONS = [
  'City of Hollywood',
  'City of Lauderdale Lakes',
  'City of Lauderhill',
  'City of Miami Beach',
  'City of Miramar',
  'City of North Miami Beach',
  'City of Pompano Beach',
  'City of Tamarac',
  'Other',
];

export const CITY_OPTIONS = [
  'Hollywood Florida',
  'Lauderdale Lakes Florida',
  'Lauderhill Florida',
  'Miami Beach Florida',
  'Miramar Florida',
  'North Miami Beach Florida',
  'Pompano Beach Florida',
  'Tamarac Florida',
  'Other',
];

export const PROPERTY_TYPE_OPTIONS = [
  'Single-family',
  'Condo / townhome',
  'Multi-unit',
  'Commercial',
  'Storefront',
];

export const SERVICE_NEEDED_OPTIONS = [
  'Emergency board-up',
  'Hurricane / storm prep',
  'Post-storm secure',
  'Break-in secure',
  'Fire damage board-up',
  'Board removal',
];

export const URGENCY_OPTIONS = ['Emergency — now', 'Today', 'Within 24 hrs', 'Scheduled'];

export const CREW_OPTIONS = ['Unassigned', 'Dan', 'Dale', 'Rob'];

/** localStorage keys for cities added via the "Other" option (per device). */
export const BOARDUP_CUSTOM_CITY_NAMES_KEY = 'boardup_custom_city_names';
export const BOARDUP_CUSTOM_CITIES_KEY = 'boardup_custom_cities';

/** Photos per page in the board-up PDF photo section — matches the source app. */
export const PHOTOS_PER_PDF_PAGE = 4;

/** Split items into chunks of `size`; the last chunk may be smaller. */
export function chunkArray<T>(items: readonly T[], size: number): T[][] {
  if (!Number.isFinite(size) || size <= 0) return [];
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

/** Read remembered custom cities; safe outside the browser (tests/SSR). */
export function loadCustomCities(key: string): string[] {
  try {
    if (typeof localStorage === 'undefined') return [];
    const raw = localStorage.getItem(key);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((x): x is string => typeof x === 'string' && x.trim() !== '');
  } catch {
    return [];
  }
}

/** Built-in options plus remembered customs, deduped case-insensitively. */
export function withCustomCities(builtIn: readonly string[], custom: readonly string[]): string[] {
  const seen = new Set(builtIn.map((s) => s.toLowerCase()));
  const out = [...builtIn];
  for (const c of custom) {
    const t = c.trim();
    if (t !== '' && !seen.has(t.toLowerCase())) {
      seen.add(t.toLowerCase());
      out.push(t);
    }
  }
  return out;
}

/**
 * Remember a new city name typed via "Other". Returns the updated custom list.
 * Dedupes case-insensitively against the built-in options and existing customs.
 */
export function rememberCustomCity(key: string, name: string, builtIn: readonly string[]): string[] {
  const t = name.trim();
  const current = loadCustomCities(key);
  if (t === '') return current;
  const seen = new Set([...builtIn, ...current].map((s) => s.toLowerCase()));
  if (seen.has(t.toLowerCase())) return current;
  const next = [...current, t];
  try {
    if (typeof localStorage !== 'undefined') localStorage.setItem(key, JSON.stringify(next));
  } catch {
    /* storage unavailable — keep the in-memory list only */
  }
  return next;
}

/** Caption printed under every photo in the PDF: "123 Main St, Hollywood Florida". */
export function boardUpPhotoCaption(d: Pick<BoardUpDetails, 'streetAddress' | 'city'>): string {
  const street = d.streetAddress.trim();
  const city = d.city.trim();
  return city ? `${street}, ${city}` : street;
}

/** Filename-safe property address for the split PDFs, e.g. "1333 S Ocean Blvd, Apt, Lauderhill Florida". */
export function boardUpFilenameBase(d: Pick<BoardUpDetails, 'streetAddress' | 'city'>): string {
  const raw = boardUpPhotoCaption(d).trim() || 'boardup-job';
  return raw.replace(/[\\/:*?"<>|]/g, '-');
}

/** M-D-YYYY stamp for file names, from a YYYY-MM-DD job date (falls back to today). */
export function boardUpFileDate(invoiceDate: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec((invoiceDate || '').trim());
  if (m) return `${parseInt(m[2], 10)}-${parseInt(m[3], 10)}-${m[1]}`;
  const t = new Date();
  return `${t.getMonth() + 1}-${t.getDate()}-${t.getFullYear()}`;
}

/**
 * Full PDF file name, e.g.
 * "Aquick Job 10-13-2026 - 123 Main St, Miramar Florida - job information.pdf".
 */
export function boardUpPdfFilename(
  d: Pick<BoardUpDetails, 'streetAddress' | 'city'>,
  invoiceDate: string,
  kind: 'job information' | 'photos' | 'condensed',
): string {
  return `Aquick Job ${boardUpFileDate(invoiceDate)} - ${boardUpFilenameBase(d)} - ${kind}.pdf`;
}

export const BOARDUP_FORMULA_NOTE =
  'Estimate uses 12 sq ft/window, 21/door, 32/slider, 64/garage + 15% waste. Planning only — measure on site.';

/** Keeps a measurement array the same length as its opening count. */
export function syncMeasurementCount(count: number, arr: string[]): string[] {
  const next = arr.slice(0, count);
  while (next.length < count) next.push('');
  return next;
}

/** One summary line per opening type that has any measurements, e.g. "Window measurements: 36x45, 40x60". */
export function measurementSummaryLines(d: BoardUpDetails): string[] {
  const groups: [string, string[]][] = [
    ['Window', d.windowMeasurements],
    ['Door', d.doorMeasurements],
    ['Slider / patio', d.sliderMeasurements],
    ['Garage door', d.garageMeasurements],
  ];
  return groups
    .map(([label, arr]) => {
      const vals = arr.map((s) => s.trim()).filter(Boolean);
      return vals.length > 0 ? `${label} measurements: ${vals.join(', ')}` : null;
    })
    .filter((l): l is string => l !== null);
}
/** Sq ft per opening type, matching the source app. */
const SQFT = { windows: 12, doors: 21, sliders: 32, garageDoors: 64 } as const;
const WASTE_FACTOR = 1.15;
const SHEET_SQFT = 32; // a 4x8 plywood sheet

export interface BoardUpEstimate {
  /** Raw covered sq ft before waste. */
  rawSqft: number;
  /**
   * Displayed SQ FT COVER: the raw sum with NO waste applied, matching the
   * source app (waste only goes into the sheet count).
   */
  sqftCover: number;
  /** 4x8 sheets needed: raw sq ft + 15% waste, rounded up. */
  sheets: number;
}

export function estimateBoardUp(windows: number, doors: number, sliders: number, garageDoors: number): BoardUpEstimate {
  const w = Math.max(0, Math.floor(windows) || 0);
  const d = Math.max(0, Math.floor(doors) || 0);
  const s = Math.max(0, Math.floor(sliders) || 0);
  const g = Math.max(0, Math.floor(garageDoors) || 0);
  const rawSqft = w * SQFT.windows + d * SQFT.doors + s * SQFT.sliders + g * SQFT.garageDoors;
  const sheets = Math.ceil((rawSqft * WASTE_FACTOR) / SHEET_SQFT);
  return { rawSqft, sqftCover: rawSqft, sheets };
}

function fmtDateTime(v: string): string {
  if (!v) return '—';
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) return v;
  return d.toLocaleString(undefined, {
    month: 'numeric',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

export interface BoardUpOutputOptions {
  /** ISO timestamp of when the job came in (invoice created_at); defaults to now. */
  jobDateTime?: string | null;
}

/**
 * Robert's 12-line board-up output layout, in order: Date and time, City name,
 * Address, City and state, Phone number, Case, Requesting officer and badge,
 * Structure type, Type of board up, When needed, Crew, Job details.
 * Shared by the SMS text, the email summary, and the PDF job sheet so all
 * three read identically.
 */
export function boardUpOutputRows(d: BoardUpDetails, opts: BoardUpOutputOptions = {}): [string, string][] {
  const est = estimateBoardUp(d.windows, d.doors, d.sliders, d.garageDoors);
  const total = d.windows + d.doors + d.sliders + d.garageDoors;
  const cityState = d.city
    ? d.city.endsWith(' Florida')
      ? d.city.replace(/ Florida$/, ', Florida')
      : `${d.city}, Florida`
    : '';
  const detailParts = [
    `${total} openings (${d.windows}W ${d.doors}D ${d.sliders}S ${d.garageDoors}G) — ${est.sheets} sheets est.`,
    ...measurementSummaryLines(d),
    d.otherOpenings.trim() ? `Other openings: ${d.otherOpenings.trim()}` : null,
    d.accessNotes.trim() ? `Notes: ${d.accessNotes.trim()}` : null,
  ].filter((p): p is string => p !== null);
  return [
    ['Date and time', fmtDateTime(opts.jobDateTime ?? new Date().toISOString())],
    ['City name', d.cityName.trim()],
    ['Address', d.streetAddress.trim()],
    ['City and state', cityState],
    ['Phone number', d.phone.trim()],
    ['Case', d.caseNumber.trim()],
    ['Requesting officer and badge', d.requestingOfficer.trim()],
    ['Structure type', d.propertyType],
    ['Type of board up', d.serviceNeeded],
    ['When needed', `${d.urgency}${d.neededBy ? ` (needed by ${fmtDateTime(d.neededBy)})` : ''}`],
    ['Crew', `${d.crew}${d.additionalCrew.trim() ? ` + ${d.additionalCrew.trim()}` : ''}`],
    ['Job details', detailParts.join('\n')],
  ];
}

/** Renders the 12 labeled rows as plain text; Job details spans multiple lines. */
function renderBoardUpText(header: string, d: BoardUpDetails, opts: BoardUpOutputOptions, tail: string[]): string {
  const lines = [header];
  for (const [label, value] of boardUpOutputRows(d, opts)) {
    if (value === '') continue;
    if (label === 'Job details') {
      lines.push(`${label}:`);
      lines.push(...value.split('\n'));
    } else {
      lines.push(`${label}: ${value}`);
    }
  }
  lines.push(...tail);
  return lines.join('\n');
}

/**
 * Values-only job card for SMS: Robert's 12 fields in order, no labels —
 * just the field contents, one per line. Header and Ref link are kept.
 */
export function buildBoardUpSmsText(d: BoardUpDetails, opts: BoardUpOutputOptions = {}): string {
  const lines = ['AQUICK BOARD-UP'];
  for (const [, value] of boardUpOutputRows(d, opts)) {
    if (value === '') continue;
    lines.push(...value.split('\n'));
  }
  lines.push(`Ref: ${d.referenceLink || 'https://aquick.kalekycomputer.com'}`);
  return lines.join('\n');
}

/** One row of the board-up CSV export (Dan's "Download CSV"). */
export interface BoardUpCsvRow {
  /** Stored invoice_number, e.g. "QB-12" (prefix included). */
  jobNumber: string | null;
  completed: boolean;
  createdAt: string;
  details: BoardUpDetails;
}

function csvCell(v: string): string {
  return /[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v;
}

/**
 * CSV export of board-up jobs: one row per job with the 12 output fields plus
 * job number, sheet estimate, and done flag. Opens in Excel/Sheets.
 */
export function buildBoardUpCsv(rows: BoardUpCsvRow[]): string {
  const header = [
    'Job', 'Done', 'Date and time', 'City name', 'Address', 'City and state',
    'Phone number', 'Case', 'Requesting officer and badge', 'Structure type',
    'Type of board up', 'When needed', 'Crew', 'Openings', 'Measurements',
    'Sheets est.', 'Notes',
  ];
  const lines = [header.join(',')];
  for (const r of rows) {
    const d = r.details;
    const est = estimateBoardUp(d.windows, d.doors, d.sliders, d.garageDoors);
    const total = d.windows + d.doors + d.sliders + d.garageDoors;
    const cityState = d.city
      ? d.city.endsWith(' Florida')
        ? d.city.replace(/ Florida$/, ', Florida')
        : `${d.city}, Florida`
      : '';
    lines.push(
      [
        r.jobNumber ?? '',
        r.completed ? 'Yes' : '',
        fmtDateTime(r.createdAt),
        d.cityName.trim(),
        d.streetAddress.trim(),
        cityState,
        d.phone.trim(),
        d.caseNumber.trim(),
        d.requestingOfficer.trim(),
        d.propertyType,
        d.serviceNeeded,
        `${d.urgency}${d.neededBy ? ` (needed by ${fmtDateTime(d.neededBy)})` : ''}`,
        `${d.crew}${d.additionalCrew.trim() ? ` + ${d.additionalCrew.trim()}` : ''}`,
        `${total} (${d.windows}W ${d.doors}D ${d.sliders}S ${d.garageDoors}G)`,
        measurementSummaryLines(d).join('; '),
        String(est.sheets),
        d.accessNotes.trim(),
      ].map(csvCell).join(','),
    );
  }
  return lines.join('\n');
}

/** Plain-text job summary for mailto:/sms: bodies and the printed sheet. */
export function buildBoardUpSummary(
  d: BoardUpDetails,
  jobNumber: string | null,
  opts: BoardUpOutputOptions = {},
): string {
  const tail = [
    ...(d.photos.length > 0 ? [`Photos: ${d.photos.length} attached`] : []),
    `Ref: ${d.referenceLink || 'https://aquick.kalekycomputer.com'}`,
  ];
  return renderBoardUpText(`BOARD-UP JOB${jobNumber ? ` #${jobNumber}` : ''}`, d, opts, tail);
}

/** Type guard for boardup_details read back from the database. */
export function asBoardUpDetails(raw: unknown): BoardUpDetails {
  if (!raw || typeof raw !== 'object') return { ...EMPTY_BOARDUP };
  const r = raw as Partial<BoardUpDetails>;
  const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) && v >= 0 ? Math.floor(v) : 0);
  const str = (v: unknown, fallback = '') => (typeof v === 'string' ? v : fallback);
  const strArr = (v: unknown) => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []);
  /** Dropdown field: keep '' (unselected) or a known option, else the default. */
  const opt = (v: unknown, options: readonly string[], fallback: string) => {
    if (typeof v !== 'string' || v === '') return v === '' ? '' : fallback;
    return (options as readonly string[]).includes(v) ? v : fallback;
  };
  return {
    cityName: opt(r.cityName, withCustomCities(CITY_NAME_OPTIONS, loadCustomCities(BOARDUP_CUSTOM_CITY_NAMES_KEY)), ''),
    otherCustomerName: str(r.otherCustomerName),
    streetAddress: str(r.streetAddress),
    city: opt(r.city, withCustomCities(CITY_OPTIONS, loadCustomCities(BOARDUP_CUSTOM_CITIES_KEY)), ''),
    phone: str(r.phone),
    caseNumber: str(r.caseNumber),
    requestingOfficer: str(r.requestingOfficer),
    propertyType: opt(r.propertyType, PROPERTY_TYPE_OPTIONS, 'Single-family'),
    serviceNeeded: opt(r.serviceNeeded, SERVICE_NEEDED_OPTIONS, 'Emergency board-up'),
    urgency: opt(r.urgency, URGENCY_OPTIONS, 'Today'),
    neededBy: str(r.neededBy),
    referenceLink: str(r.referenceLink, 'https://aquick.kalekycomputer.com'),
    windows: num(r.windows),
    doors: num(r.doors),
    sliders: num(r.sliders),
    garageDoors: num(r.garageDoors),
    otherOpenings: str(r.otherOpenings),
    crew: opt(r.crew, CREW_OPTIONS, 'Dan'),
    additionalCrew: str(r.additionalCrew),
    accessNotes: str(r.accessNotes),
    emailTo: str(r.emailTo),
    textTo: str(r.textTo),
    photos: strArr(r.photos),
    windowMeasurements: strArr(r.windowMeasurements),
    doorMeasurements: strArr(r.doorMeasurements),
    sliderMeasurements: strArr(r.sliderMeasurements),
    garageMeasurements: strArr(r.garageMeasurements),
  };
}
