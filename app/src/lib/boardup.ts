/**
 * Board-Up job template (Quick Board-Up company): field definitions,
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

export const BOARDUP_FORMULA_NOTE =
  'Estimate uses 12 sq ft/window, 21/door, 32/slider, 64/garage + 15% waste. Planning only — measure on site.';

/** Sq ft per opening type, matching the source app. */
const SQFT = { windows: 12, doors: 21, sliders: 32, garageDoors: 64 } as const;
const WASTE_FACTOR = 1.15;
const SHEET_SQFT = 32; // a 4x8 plywood sheet

export interface BoardUpEstimate {
  /** Raw covered sq ft before waste. */
  rawSqft: number;
  /** Sq ft including 15% waste, rounded to a whole number. */
  sqftCover: number;
  /** 4x8 sheets needed, rounded up. */
  sheets: number;
}

export function estimateBoardUp(windows: number, doors: number, sliders: number, garageDoors: number): BoardUpEstimate {
  const w = Math.max(0, Math.floor(windows) || 0);
  const d = Math.max(0, Math.floor(doors) || 0);
  const s = Math.max(0, Math.floor(sliders) || 0);
  const g = Math.max(0, Math.floor(garageDoors) || 0);
  const rawSqft = w * SQFT.windows + d * SQFT.doors + s * SQFT.sliders + g * SQFT.garageDoors;
  const sqftCover = Math.round(rawSqft * WASTE_FACTOR);
  const sheets = Math.ceil((rawSqft * WASTE_FACTOR) / SHEET_SQFT);
  return { rawSqft, sqftCover, sheets };
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

/** Plain-text job summary for mailto:/sms: bodies and the printed sheet. */
export function buildBoardUpSummary(d: BoardUpDetails, jobNumber: string | null): string {
  const est = estimateBoardUp(d.windows, d.doors, d.sliders, d.garageDoors);
  const lines = [
    `BOARD-UP JOB${jobNumber ? ` #${jobNumber}` : ''}`,
    `City: ${d.cityName || '—'}`,
    d.otherCustomerName ? `Customer: ${d.otherCustomerName}` : null,
    `Address: ${d.streetAddress || '—'}${d.city ? `, ${d.city}` : ''}`,
    d.phone ? `Phone: ${d.phone}` : null,
    d.caseNumber ? `Case #: ${d.caseNumber}` : null,
    d.requestingOfficer ? `Requesting: ${d.requestingOfficer}` : null,
    `Type: ${d.propertyType} — ${d.serviceNeeded}`,
    `Urgency: ${d.urgency}${d.neededBy ? ` (needed by ${fmtDateTime(d.neededBy)})` : ''}`,
    `Openings: ${d.windows} windows, ${d.doors} doors, ${d.sliders} sliders/patios, ${d.garageDoors} garage doors`,
    d.otherOpenings ? `Other openings: ${d.otherOpenings}` : null,
    `Est: ${est.sqftCover} sq ft cover, ${est.sheets} 4x8 sheets`,
    `Crew: ${d.crew}${d.additionalCrew ? ` + ${d.additionalCrew}` : ''}`,
    d.accessNotes ? `Access/notes: ${d.accessNotes}` : null,
    d.photos.length > 0 ? `Photos: ${d.photos.length} attached` : null,
  ].filter((l): l is string => l !== null);
  return lines.join('\n');
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
    cityName: opt(r.cityName, CITY_NAME_OPTIONS, ''),
    otherCustomerName: str(r.otherCustomerName),
    streetAddress: str(r.streetAddress),
    city: opt(r.city, CITY_OPTIONS, ''),
    phone: str(r.phone),
    caseNumber: str(r.caseNumber),
    requestingOfficer: str(r.requestingOfficer),
    propertyType: opt(r.propertyType, PROPERTY_TYPE_OPTIONS, 'Single-family'),
    serviceNeeded: opt(r.serviceNeeded, SERVICE_NEEDED_OPTIONS, 'Emergency board-up'),
    urgency: opt(r.urgency, URGENCY_OPTIONS, 'Today'),
    neededBy: str(r.neededBy),
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
  };
}
