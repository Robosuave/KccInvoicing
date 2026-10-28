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
  /** Who called the job in (Dan's crew-entry "Caller name"). */
  callerName: string;
  streetAddress: string;
  city: string;
  /** State for the property address (Dan's crew-entry "State", prefilled Florida). */
  state: string;
  /** Job time of day (Dan's crew-entry "Time"); the job date itself is the
   * invoice/job date shown in the editor above this form. */
  jobTime: string;
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
  /** AC units to board (Dan's crew-entry "AC" opening type). */
  acUnits: number;
  otherOpenings: string;
  crew: string;
  additionalCrew: string;
  /** Hasp & lock count + per-lock combination (Dan's crew-entry locks section). */
  haspLocks: number;
  haspLockCombos: string[];
  /** Lock & chain count + per-lock combination. */
  chainLocks: number;
  chainLockCombos: string[];
  /**
   * Two-by-four lines (Dan's crew-entry "Two by Fours" block, section 04):
   * size, quantity, and lineal feet per line. Separate from openings and
   * NOT included in the opening total or the plywood-sheet estimate.
   */
  twoByFours: TwoByFourLine[];
  accessNotes: string;
  emailTo: string;
  textTo: string;
  /** Storage paths (invoice-attachments bucket) of job photos. */
  photos: string[];
  /**
   * EXIF capture time per photo, read at upload: storage path ->
   * raw "YYYY:MM:DD HH:MM:SS". Powers the per-photo timestamps and the
   * Start job / End job timeline on the PDFs.
   */
  photoTakenAt: Record<string, string>;
  /** Per-opening measurements, e.g. ["36x45"] — one entry per counted opening. */
  windowMeasurements: string[];
  doorMeasurements: string[];
  sliderMeasurements: string[];
  garageMeasurements: string[];
  acMeasurements: string[];
  /** Dan's Oct 26 "Mark invoiced" flag: green Invoiced badge on the job card. */
  invoiced: boolean;
}

/** One two-by-four line: standard size or Custom with its own lineal feet. */
export interface TwoByFourLine {
  size: string;
  customLinealFeet: string;
  quantity: number;
}

export const TWO_BY_FOUR_SIZES = ['2 x 4 x 8', 'Custom'];

/** Lineal feet in one standard 2 x 4 x 8 board. */
export const TWO_BY_FOUR_STANDARD_FEET = 8;

/**
 * Two-by-four totals: total quantity, and total lineal feet — null when any
 * line is Custom, since Dan's app records no lineal feet for a custom line.
 */
export function twoByFourTotals(lines: readonly TwoByFourLine[]): {
  quantity: number;
  linealFeet: number | null;
} {
  let quantity = 0;
  let linealFeet = 0;
  let hasCustom = false;
  for (const line of lines) {
    const q = Math.max(1, Math.min(30, Math.floor(line.quantity) || 1));
    quantity += q;
    if (line.size === 'Custom') hasCustom = true;
    else linealFeet += q * TWO_BY_FOUR_STANDARD_FEET;
  }
  return { quantity, linealFeet: hasCustom ? null : linealFeet };
}

/** One summary line per two-by-four entry, plus a totals line, for the
 * job-details output (SMS, email, PDF). Empty when no lines are entered. */
export function twoByFourSummaryLines(d: BoardUpDetails): string[] {
  if (d.twoByFours.length === 0) return [];
  const lines = d.twoByFours.map((line) => {
    const q = Math.max(1, Math.min(30, Math.floor(line.quantity) || 1));
    if (line.size === 'Custom') {
      const feet = line.customLinealFeet.trim();
      return `Two by Fours: Custom x${q}${feet ? ` (${feet} lineal feet each)` : ''}`;
    }
    return `Two by Fours: ${line.size} x${q}`;
  });
  const totals = twoByFourTotals(d.twoByFours);
  lines.push(
    totals.linealFeet === null
      ? `Two by Fours total: ${totals.quantity} · Lineal feet not recorded for a custom line`
      : `Two by Fours total: ${totals.quantity} · Total lineal feet: ${totals.linealFeet}`,
  );
  return lines;
}

/** Default "Email to" on new board-up jobs (Dan's address). */
export const DEFAULT_CREW_EMAIL = '4831104x@gmail.com';

/** One crew member's saved contact, from the boardup_crew table. */
export interface BoardUpCrewContact {
  id: string;
  name: string;
  phone: string;
  email: string;
}

/** Find a crew contact by name (case-insensitive). */
export function crewContactFor(name: string, contacts: BoardUpCrewContact[]): BoardUpCrewContact | null {
  const n = name.trim().toLowerCase();
  if (!n) return null;
  return contacts.find((c) => c.name.trim().toLowerCase() === n) ?? null;
}

export const EMPTY_BOARDUP: BoardUpDetails = {
  cityName: '',
  otherCustomerName: '',
  callerName: '',
  streetAddress: '',
  city: '',
  state: 'Florida',
  jobTime: '',
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
  acUnits: 0,
  otherOpenings: '',
  crew: 'Unassigned',
  additionalCrew: '',
  haspLocks: 0,
  haspLockCombos: [],
  chainLocks: 0,
  chainLockCombos: [],
  twoByFours: [],
  accessNotes: '',
  emailTo: DEFAULT_CREW_EMAIL,
  textTo: '',
  photos: [],
  photoTakenAt: {},
  windowMeasurements: [],
  doorMeasurements: [],
  sliderMeasurements: [],
  garageMeasurements: [],
  acMeasurements: [],
  invoiced: false,
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
  // Added for parity with Dan's crew-entry app (existing options kept).
  'Vacant lot / structure',
  'Other',
];

export const SERVICE_NEEDED_OPTIONS = [
  'Emergency board-up',
  'Hurricane / storm prep',
  'Post-storm secure',
  'Break-in secure',
  'Fire damage board-up',
  'Board removal',
  // Added for parity with Dan's crew-entry app (existing options kept).
  'Board up',
  'Re-board / repair',
  'Secure property',
  'Inspection / estimate',
  // Dan, Oct 27: "Open for inspection" as a service option.
  'Open for inspection',
  'Other',
];

export const URGENCY_OPTIONS = ['Emergency — dispatch now', 'Today', 'Scheduled', 'Not urgent'];

/** Retired urgency labels mapped to their replacements when reading old jobs. */
export const URGENCY_MIGRATIONS: Record<string, string> = {
  'Emergency — now': 'Emergency — dispatch now',
  'Within 24 hrs': 'Scheduled',
};

export const CREW_OPTIONS = ['Unassigned', 'Dan', 'Dale', 'Rob'];

/**
 * Preset W×H measurement dropdown options from Dan's crew-entry app.
 * Windows and doors get one combined W×H dropdown per opening; "Custom size"
 * (the default) leaves the adjacent text box free for typing any size.
 */
export const CUSTOM_SIZE_OPTION = 'Custom size';
export const WINDOW_MEASUREMENT_PRESETS = [
  '36x50',
  '36.25x50',
  '36.5x50',
  '36.75x50',
  '37x48',
  '37.25x48',
  '37.5x48',
  '37.75x48',
];
export const DOOR_MEASUREMENT_PRESETS = [
  '36x80',
  '36.25x80',
  '36.5x80',
  '36.75x80',
  '37x80',
  '37.25x80',
  '37.5x80',
  '36x81',
  '36.25x81',
  '36.5x81',
  '36.75x81',
];

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
  'Estimate uses 12 sq ft/window, 21/door, 32/slider, 64/garage, 12/AC + 15% waste. Planning only — measure on site.';

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
    ['AC', d.acMeasurements],
  ];
  return groups
    .map(([label, arr]) => {
      const vals = arr.map((s) => s.trim()).filter(Boolean);
      return vals.length > 0 ? `${label} measurements: ${vals.join(', ')}` : null;
    })
    .filter((l): l is string => l !== null);
}

/** One summary line per lock type that has any combinations, e.g. "Hasp & lock combos: 4419, 8820". */
export function lockSummaryLines(d: Pick<BoardUpDetails, 'haspLockCombos' | 'chainLockCombos'>): string[] {
  const groups: [string, string[]][] = [
    ['Hasp & lock', d.haspLockCombos],
    ['Lock & chain', d.chainLockCombos],
  ];
  return groups
    .map(([label, arr]) => {
      const vals = arr.map((s) => s.trim()).filter(Boolean);
      return vals.length > 0 ? `${label} combos: ${vals.join(', ')}` : null;
    })
    .filter((l): l is string => l !== null);
}
/** Sq ft per opening type, matching the source app. */
const SQFT = { windows: 12, doors: 21, sliders: 32, garageDoors: 64, acUnits: 12 } as const;
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

export function estimateBoardUp(
  windows: number,
  doors: number,
  sliders: number,
  garageDoors: number,
  acUnits = 0,
): BoardUpEstimate {
  const w = Math.max(0, Math.floor(windows) || 0);
  const d = Math.max(0, Math.floor(doors) || 0);
  const s = Math.max(0, Math.floor(sliders) || 0);
  const g = Math.max(0, Math.floor(garageDoors) || 0);
  const a = Math.max(0, Math.floor(acUnits) || 0);
  const rawSqft = w * SQFT.windows + d * SQFT.doors + s * SQFT.sliders + g * SQFT.garageDoors + a * SQFT.acUnits;
  const sheets = Math.ceil((rawSqft * WASTE_FACTOR) / SHEET_SQFT);
  return { rawSqft, sqftCover: rawSqft, sheets };
}

/** Totals measured from the actual W×H sizes entered, mirroring Dan's
 * crew-entry "Measurement grand total": every W×H pair is rounded UP to a
 * whole square inch, then added. Non-W×H entries are ignored. This is
 * separate from the flat-rate SQ FT COVER estimate above and does not
 * replace it. */
export interface MeasuredTotals {
  /** Sum of per-pair rounded-up square inches. */
  sqIn: number;
  /** sqIn / 144. */
  sqFt: number;
  /** Number of W×H pairs that contributed. */
  pairs: number;
}

export function measuredTotals(
  measurements: readonly (readonly string[])[],
): MeasuredTotals {
  let sqIn = 0;
  let pairs = 0;
  for (const list of measurements) {
    for (const m of list) {
      const match = /^\s*(\d+(?:\.\d+)?)\s*x\s*(\d+(?:\.\d+)?)\s*$/i.exec(m ?? '');
      if (!match) continue;
      sqIn += Math.ceil(parseFloat(match[1]) * parseFloat(match[2]));
      pairs += 1;
    }
  }
  return { sqIn, sqFt: sqIn / 144, pairs };
}

/** Dan, Oct 28: number-picker ranges per opening type, [width, height] in inches. */
export const MEASUREMENT_RANGES: Record<
  'windows' | 'doors' | 'sliders' | 'garageDoors' | 'acUnits',
  { w: [number, number]; h: [number, number] }
> = {
  windows: { w: [24, 75], h: [25, 80] },
  doors: { w: [24, 48], h: [60, 96] },
  sliders: { w: [30, 96], h: [80, 96] },
  garageDoors: { w: [48, 250], h: [80, 96] },
  acUnits: { w: [20, 48], h: [12, 48] },
};

/**
 * Dan, Oct 26: a size typed in "Other opening information" counts toward the
 * measured grand total, same rounding rule as every other opening. Extracts
 * every W×H pair found in the free text (e.g. "18 x 16 display board").
 */
export function otherOpeningSizes(text: string): string[] {
  const out: string[] = [];
  const re = /(\d+(?:\.\d+)?)\s*x\s*(\d+(?:\.\d+)?)/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text ?? '')) !== null) out.push(`${m[1]}x${m[2]}`);
  return out;
}

/** One plywood piece, from a measurement, before any oversize split. */
export interface CutPiece {
  label: string;
  w: number;
  h: number;
}

export interface CutPlacement extends CutPiece {
  part: number;
  partCount: number;
  x: number;
  y: number;
}

export interface CutList {
  sheets: CutPlacement[][];
  /** Openings that had to be split, with their part count. */
  oversized: { label: string; size: string; partCount: number }[];
  pieces: number;
}

/**
 * Dan, Oct 26/28: real nesting cut list for 4×8 (48×96 in) sheets.
 * Pieces may be turned either way. A piece too big for one sheet is split
 * into numbered parts, each no bigger than a sheet (e.g. a 162×96 garage
 * door becomes four 40.5×96 parts), and every part is laid out.
 * This is planning only and does NOT replace the flat-rate SQ FT COVER /
 * sheets estimate above, which stays as-is.
 */
export function buildCutList(pieces: readonly CutPiece[]): CutList {
  const SHEET_W = 48;
  const SHEET_H = 96;
  const parts: CutPiece[] = [];
  const oversized: CutList['oversized'] = [];
  for (const p of pieces) {
    if (!(p.w > 0 && p.h > 0)) continue;
    const wChunks = Math.ceil(p.w / SHEET_W);
    const hChunks = Math.ceil(p.h / SHEET_H);
    const partCount = wChunks * hChunks;
    if (partCount > 1) oversized.push({ label: p.label, size: `${p.w}x${p.h}`, partCount });
    for (let wi = 0; wi < wChunks; wi++) {
      for (let hi = 0; hi < hChunks; hi++) {
        parts.push({
          label: p.label,
          w: p.w / wChunks,
          h: p.h / hChunks,
        });
      }
    }
  }
  // Assign part numbers per original opening, in order.
  const counts = new Map<string, number>();
  const numbered: (CutPiece & { part: number; partCount: number })[] = parts.map((p) => {
    const key = `${p.label}|${p.w}x${p.h}`;
    const n = (counts.get(key) ?? 0) + 1;
    counts.set(key, n);
    return { ...p, part: n, partCount: 1 };
  });
  // Fix partCount: recompute from oversized splits by label+size.
  const byLabel = new Map<string, number>();
  for (const p of pieces) {
    const wChunks = Math.ceil(p.w / SHEET_W);
    const hChunks = Math.ceil(p.h / SHEET_H);
    byLabel.set(p.label, (byLabel.get(p.label) ?? 0) + wChunks * hChunks);
  }
  for (const p of numbered) p.partCount = byLabel.get(p.label) ?? 1;
  // Guillotine packing: biggest pieces first, best short-side fit in free rects.
  const sorted = [...numbered].sort((a, b) => Math.max(b.w, b.h) - Math.max(a.w, a.h));
  const sheets: CutPlacement[][] = [];
  for (const piece of sorted) {
    let placed = false;
    for (const sheet of sheets) {
      const free: { x: number; y: number; w: number; h: number }[] = [{ x: 0, y: 0, w: SHEET_W, h: SHEET_H }];
      for (const pl of sheet) {
        const next: typeof free = [];
        for (const r of free) {
          if (pl.x >= r.x + r.w || pl.x + pl.w <= r.x || pl.y >= r.y + r.h || pl.y + pl.h <= r.y) {
            next.push(r);
            continue;
          }
          if (pl.x > r.x) next.push({ x: r.x, y: r.y, w: pl.x - r.x, h: r.h });
          if (pl.x + pl.w < r.x + r.w) next.push({ x: pl.x + pl.w, y: r.y, w: r.x + r.w - (pl.x + pl.w), h: r.h });
          if (pl.y > r.y) next.push({ x: r.x, y: r.y, w: r.w, h: pl.y - r.y });
          if (pl.y + pl.h < r.y + r.h) next.push({ x: r.x, y: pl.y + pl.h, w: r.w, h: r.y + r.h - (pl.y + pl.h) });
        }
        free.splice(0, free.length, ...next);
      }
      let best: { r: (typeof free)[number]; w: number; h: number; score: number } | null = null;
      for (const r of free) {
        for (const [w, h] of [[piece.w, piece.h], [piece.h, piece.w]] as const) {
          if (w > r.w + 1e-9 || h > r.h + 1e-9) continue;
          const score = Math.min(r.w - w, r.h - h);
          if (!best || score < best.score) best = { r, w, h, score };
        }
      }
      if (best) {
        sheet.push({ ...piece, x: best.r.x, y: best.r.y, w: best.w, h: best.h });
        placed = true;
        break;
      }
    }
    if (!placed) {
      // Every split part fits one way or the other; orient it to fit.
      const fits = piece.w <= SHEET_W && piece.h <= SHEET_H;
      sheets.push([{ ...piece, x: 0, y: 0, w: fits ? piece.w : piece.h, h: fits ? piece.h : piece.w }]);
    }
  }
  return { sheets, oversized, pieces: pieces.length };
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
  const est = estimateBoardUp(d.windows, d.doors, d.sliders, d.garageDoors, d.acUnits);
  const total = d.windows + d.doors + d.sliders + d.garageDoors + d.acUnits;
  const cityState = d.city
    ? `${d.city.replace(/ Florida$/, '')}, ${d.state.trim() || 'Florida'}`
    : '';
  // "Date and time": when a job time was entered, pair it with the job's
  // date (from the caller-supplied timestamp); otherwise keep the old
  // created-at behaviour.
  const dateTimeValue = (() => {
    const base = opts.jobDateTime ?? new Date().toISOString();
    if (!d.jobTime.trim()) return base;
    const datePart = base.slice(0, 10);
    return /^\d{4}-\d{2}-\d{2}$/.test(datePart) ? `${datePart}T${d.jobTime.trim()}` : base;
  })();
  const detailParts = [
    d.callerName.trim() ? `Caller: ${d.callerName.trim()}` : null,
    `${total} openings (${d.windows}W ${d.doors}D ${d.sliders}S ${d.garageDoors}G${
      d.acUnits > 0 ? ` ${d.acUnits}A` : ''
    }) — ${est.sheets} sheets est.`,
    ...measurementSummaryLines(d),
    ...lockSummaryLines(d),
    ...twoByFourSummaryLines(d),
    d.otherOpenings.trim() ? `Other openings: ${d.otherOpenings.trim()}` : null,
    d.accessNotes.trim() ? `Notes: ${d.accessNotes.trim()}` : null,
  ].filter((p): p is string => p !== null);
  return [
    ['Date and time', fmtDateTime(dateTimeValue)],
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
    'Type of board up', 'When needed', 'Crew', 'Caller', 'Openings', 'Measurements',
    'Locks', 'Sheets est.', 'Notes', 'Two by Fours', 'Invoiced',
  ];
  const lines = [header.join(',')];
  for (const r of rows) {
    const d = r.details;
    const est = estimateBoardUp(d.windows, d.doors, d.sliders, d.garageDoors, d.acUnits);
    const total = d.windows + d.doors + d.sliders + d.garageDoors + d.acUnits;
    const cityState = d.city
      ? `${d.city.replace(/ Florida$/, '')}, ${d.state.trim() || 'Florida'}`
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
        d.callerName.trim(),
        `${total} (${d.windows}W ${d.doors}D ${d.sliders}S ${d.garageDoors}G${
          d.acUnits > 0 ? ` ${d.acUnits}A` : ''
        })`,
        measurementSummaryLines(d).join('; '),
        lockSummaryLines(d).join('; '),
        String(est.sheets),
        d.accessNotes.trim(),
        twoByFourSummaryLines(d).join('; '),
        d.invoiced ? 'Yes' : '',
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
  /** EXIF capture times keyed by photo storage path; drops anything malformed. */
  const takenAtMap = (v: unknown): Record<string, string> => {
    if (!v || typeof v !== 'object' || Array.isArray(v)) return {};
    const out: Record<string, string> = {};
    for (const [k, val] of Object.entries(v as Record<string, unknown>)) {
      if (typeof val === 'string' && /^\d{4}:\d{2}:\d{2} \d{2}:\d{2}(:\d{2})?$/.test(val)) out[k] = val;
    }
    return out;
  };
  /** Dropdown field: keep '' (unselected) or a known option, else the default. */
  const opt = (v: unknown, options: readonly string[], fallback: string) => {
    if (typeof v !== 'string' || v === '') return v === '' ? '' : fallback;
    return (options as readonly string[]).includes(v) ? v : fallback;
  };
  /** Map retired urgency labels to their replacements before validating. */
  const urgencyVal = typeof r.urgency === 'string' ? URGENCY_MIGRATIONS[r.urgency] ?? r.urgency : r.urgency;
  return {
    cityName: opt(r.cityName, withCustomCities(CITY_NAME_OPTIONS, loadCustomCities(BOARDUP_CUSTOM_CITY_NAMES_KEY)), ''),
    otherCustomerName: str(r.otherCustomerName),
    callerName: str(r.callerName),
    streetAddress: str(r.streetAddress),
    city: opt(r.city, withCustomCities(CITY_OPTIONS, loadCustomCities(BOARDUP_CUSTOM_CITIES_KEY)), ''),
    state: str(r.state, 'Florida'),
    jobTime: str(r.jobTime),
    phone: str(r.phone),
    caseNumber: str(r.caseNumber),
    requestingOfficer: str(r.requestingOfficer),
    propertyType: opt(r.propertyType, PROPERTY_TYPE_OPTIONS, 'Single-family'),
    serviceNeeded: opt(r.serviceNeeded, SERVICE_NEEDED_OPTIONS, 'Emergency board-up'),
    urgency: opt(urgencyVal, URGENCY_OPTIONS, 'Today'),
    neededBy: str(r.neededBy),
    referenceLink: str(r.referenceLink, 'https://aquick.kalekycomputer.com'),
    windows: num(r.windows),
    doors: num(r.doors),
    sliders: num(r.sliders),
    garageDoors: num(r.garageDoors),
    acUnits: num(r.acUnits),
    otherOpenings: str(r.otherOpenings),
    crew: str(r.crew) || 'Unassigned',
    additionalCrew: str(r.additionalCrew),
    haspLocks: num(r.haspLocks),
    haspLockCombos: strArr(r.haspLockCombos),
    chainLocks: num(r.chainLocks),
    chainLockCombos: strArr(r.chainLockCombos),
    twoByFours: Array.isArray(r.twoByFours)
      ? (r.twoByFours as unknown[]).map((line) => {
          const l = (line ?? {}) as Partial<TwoByFourLine>;
          return {
            size: TWO_BY_FOUR_SIZES.includes(typeof l.size === 'string' ? l.size : '')
              ? (l.size as string)
              : '2 x 4 x 8',
            customLinealFeet: typeof l.customLinealFeet === 'string' ? l.customLinealFeet : '',
            quantity:
              typeof l.quantity === 'number' && Number.isFinite(l.quantity)
                ? Math.max(1, Math.min(30, Math.floor(l.quantity)))
                : 1,
          };
        })
      : [],
    accessNotes: str(r.accessNotes),
    emailTo: str(r.emailTo),
    textTo: str(r.textTo),
    photos: strArr(r.photos),
    photoTakenAt: takenAtMap(r.photoTakenAt),
    windowMeasurements: strArr(r.windowMeasurements),
    doorMeasurements: strArr(r.doorMeasurements),
    sliderMeasurements: strArr(r.sliderMeasurements),
    garageMeasurements: strArr(r.garageMeasurements),
    acMeasurements: strArr(r.acMeasurements),
    invoiced: r.invoiced === true,
  };
}
