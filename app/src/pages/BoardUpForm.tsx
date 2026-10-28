import { forwardRef, useEffect, useImperativeHandle, useMemo, useRef, useState } from 'react';
import { Alert, Button, Field, Modal, SelectField, TextArea, TextField } from '../components/ui';
import { useAuth } from '../auth/AuthContext';
import { digitsOnly, formatPhone, isValidPhone, PHONE_HINT } from '../lib/phone';
import {
  BOARDUP_CUSTOM_CITIES_KEY,
  BOARDUP_CUSTOM_CITY_NAMES_KEY,
  BOARDUP_FORMULA_NOTE,
  CREW_OPTIONS,
  CITY_NAME_OPTIONS,
  CITY_OPTIONS,
  CUSTOM_SIZE_OPTION,
  DEFAULT_CREW_EMAIL,
  MEASUREMENT_RANGES,
  PROPERTY_TYPE_OPTIONS,
  SERVICE_NEEDED_OPTIONS,
  TWO_BY_FOUR_SIZES,
  URGENCY_OPTIONS,
  asBoardUpDetails,
  boardUpPdfFilename,
  buildBoardUpSmsText,
  buildBoardUpSummary,
  buildCutList,
  crewContactFor,
  syncMeasurementCount,
  estimateBoardUp,
  measuredTotals,
  otherOpeningSizes,
  twoByFourTotals,
  loadCustomCities,
  rememberCustomCity,
  withCustomCities,
  type BoardUpCrewContact,
  type BoardUpDetails,
  type TwoByFourLine,
} from '../lib/boardup';
import { boardUpPhotoUrl, removeBoardUpPhoto, uploadBoardUpPhoto } from '../data/attachments';
import { deleteInvoiceDeep } from '../data/invoices';
import { listCrewContacts, saveCrewContacts } from '../data/crew';
import {
  exifRawToInput,
  fileModifiedToExifRaw,
  formatPhotoDateTime,
  inputToExifRaw,
  parseExifDateTime,
} from '../lib/exif';
import { buildBoardUpShareSnapshot } from '../lib/snapshot';
import { blobToBase64, sendBoardUpEmail } from '../data/email';
import { downscalePhotoForPdf, renderInvoicePdfBlob } from '../pdf/service';
import type { Business } from '../db/types';

export interface BoardUpFormHandle {
  validate: () => { errors: string[]; invalid: string[] };
}

interface PhotoItem {
  path: string;
  url: string;
  /** Downscaled version used for thumbnails (and browser printing). */
  thumbUrl?: string;
}

export interface BoardUpPhoto {
  path: string;
  url: string;
}

interface Props {
  initial: BoardUpDetails;
  workspaceId: string;
  businessId: string;
  jobNumber: string | null;
  disabled?: boolean;
  /** Returns the current draft id, or null when the draft hasn't been saved yet. */
  getDraftId: () => string | null;
  /** Saves the draft now and returns its id (needed before photos can upload). */
  ensureDraft: () => Promise<string | null>;
  /** Called with the full details whenever anything changes (parent autosaves). */
  onChange: (details: BoardUpDetails) => void;
  /** Called with the full details after an add/remove (parent persists them immediately). */
  onPhotosCommitted?: (details: BoardUpDetails) => void;
  /** Called whenever the photo list changes (parent needs URLs for the print preview). */
  onPhotosChange?: (photos: BoardUpPhoto[]) => void;
  /** Full business row — needed to render the share PDF from live form state. */
  business: Business;
  /** Invoice date for the share PDF snapshot. */
  invoiceDate: string;
  /** When the job came in (invoice created_at) — the "Date and time" output line. */
  jobCreatedAt?: string | null;
  /** Owner-only actions (Delete job) are hidden from agents. */
  isOwner: boolean;
  /** Called after the job is deleted so the parent can navigate away. */
  onDeleted: () => void;
}

/** Tab/enter order, top to bottom, matching the source app. */
const FLOW = [
  'bu-cityname',
  'bu-cityname-other',
  'bu-othercustomer',
  'bu-caller',
  'bu-street',
  'bu-city',
  'bu-city-other',
  'bu-phone',
  'bu-case',
  'bu-officer',
  'bu-type',
  'bu-service',
  'bu-neededby',
  'bu-win-minus',
  'bu-win-plus',
  'bu-door-minus',
  'bu-door-plus',
  'bu-slider-minus',
  'bu-slider-plus',
  'bu-gar-minus',
  'bu-gar-plus',
  'bu-otheropen',
  'bu-crew',
  'bu-addcrew',
  'bu-access',
  'bu-emailto',
  'bu-textto',
  'bu-addphotos',
  'bu-emailjob',
  'bu-textjob',
];

function Stepper({
  id,
  label,
  value,
  onChange,
  disabled,
}: {
  id: string;
  label: string;
  value: number;
  onChange: (v: number) => void;
  disabled?: boolean;
}) {
  return (
    <div className="field">
      <span id={`${id}-label`} style={{ fontWeight: 600, fontSize: 14 }}>
        {label}
      </span>
      <div className="bu-stepper" style={{ marginTop: 4 }}>
        <Button
          id={`${id}-minus`}
          variant="secondary"
          disabled={disabled}
          aria-label={`Fewer ${label}`}
          onClick={() => onChange(Math.max(0, value - 1))}
        >
          −
        </Button>
        <span role="status" aria-live="polite" aria-labelledby={`${id}-label`} className="bu-stepper-count">
          {value}
        </span>
        <Button
          id={`${id}-plus`}
          variant="secondary"
          disabled={disabled}
          aria-label={`More ${label}`}
          onClick={() => onChange(value + 1)}
        >
          +
        </Button>
      </div>
    </div>
  );
}

type MeasurementKey =
  | 'windowMeasurements'
  | 'doorMeasurements'
  | 'sliderMeasurements'
  | 'garageMeasurements'
  | 'acMeasurements'
  | 'haspLockCombos'
  | 'chainLockCombos';

/** Dan, Oct 28: one measurement as whole-number + fraction pickers per dimension. */
function MeasurementPicker({
  id,
  label,
  value,
  ranges,
  disabled,
  onChange,
}: {
  id: string;
  label: string;
  value: string;
  ranges: { w: [number, number]; h: [number, number] };
  disabled?: boolean;
  onChange: (v: string) => void;
}) {
  const FRACTIONS = [
    { label: 'none', v: 0 },
    { label: '1/4', v: 0.25 },
    { label: '1/2', v: 0.5 },
    { label: '3/4', v: 0.75 },
  ];
  const fmt = (n: number) => {
    const r = Math.round(n * 100) / 100;
    return Number.isInteger(r) ? String(r) : String(r).replace(/0$/, '');
  };
  const parsed = /^\s*(\d+(?:\.\d+)?)\s*x\s*(\d+(?:\.\d+)?)\s*$/i.exec(value ?? '');
  // Pending half-entered dimensions live in local state until both sides are set.
  const split = (n: number | null) => {
    if (n === null) return { whole: '', frac: 0, custom: '' };
    const whole = Math.floor(n);
    const frac = n - whole;
    const hit = FRACTIONS.find((f) => Math.abs(f.v - frac) < 0.011);
    if (!hit) return { whole: '', frac: 0, custom: String(n) };
    return { whole: String(whole), frac: hit.v, custom: '' };
  };
  const initW = split(parsed ? parseFloat(parsed[1]) : null);
  const initH = split(parsed ? parseFloat(parsed[2]) : null);
  const [wWhole, setWWhole] = useState(initW.whole);
  const [wFrac, setWFrac] = useState(initW.frac);
  const [wCustom, setWCustom] = useState(initW.custom);
  const [wCustomMode, setWCustomMode] = useState(initW.custom !== '');
  const [hWhole, setHWhole] = useState(initH.whole);
  const [hFrac, setHFrac] = useState(initH.frac);
  const [hCustom, setHCustom] = useState(initH.custom);
  const [hCustomMode, setHCustomMode] = useState(initH.custom !== '');
  // Resync when the saved value changes from outside (e.g. count change).
  useEffect(() => {
    const pw = split(parsed ? parseFloat(parsed[1]) : null);
    const ph = split(parsed ? parseFloat(parsed[2]) : null);
    setWWhole(pw.whole); setWFrac(pw.frac); setWCustom(pw.custom); setWCustomMode(pw.custom !== '');
    setHWhole(ph.whole); setHFrac(ph.frac); setHCustom(ph.custom); setHCustomMode(ph.custom !== '');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);
  // Unparseable saved value (e.g. free text): keep it exactly, in a text box.
  if (value.trim() !== '' && !parsed) {
    return (
      <Field label={label} htmlFor={id}>
        <TextField id={id} value={value} disabled={disabled} onChange={(e) => onChange(e.target.value)} style={{ maxWidth: 200 }} />
      </Field>
    );
  }
  const dimVal = (whole: string, frac: number, custom: string): number | null => {
    if (custom !== '') return parseFloat(custom);
    if (whole === '') return null;
    return parseFloat(whole) + frac;
  };
  const commit = (nw: { whole: string; frac: number; custom: string }, nh: { whole: string; frac: number; custom: string }) => {
    const wv = dimVal(nw.whole, nw.frac, nw.custom);
    const hv = dimVal(nh.whole, nh.frac, nh.custom);
    if (wv !== null && hv !== null && !Number.isNaN(wv) && !Number.isNaN(hv)) onChange(`${fmt(wv)}x${fmt(hv)}`);
  };
  const dim = (
    key: 'w' | 'h',
    whole: string, frac: number, custom: string, customMode: boolean,
    setWhole: (v: string) => void, setFrac: (v: number) => void, setCustom: (v: string) => void, setCustomMode: (v: boolean) => void,
    other: { whole: string; frac: number; custom: string },
  ) => {
    const [min, max] = ranges[key];
    const opts: string[] = [];
    for (let n = min; n <= max; n++) opts.push(String(n));
    const wholeVal = customMode ? '__custom' : whole;
    return (
      <span style={{ display: 'inline-flex', gap: 4, alignItems: 'center' }}>
        <SelectField
          id={`${id}-${key}`}
          style={{ maxWidth: 92 }}
          value={wholeVal}
          disabled={disabled}
          onChange={(e) => {
            const v = e.target.value;
            if (v === '__custom') {
              setWhole(''); setCustom(''); setCustomMode(true);
              return;
            }
            setWhole(v); setCustom(''); setCustomMode(false);
            const next = { whole: v, frac, custom: '' };
            const oth = other;
            if (key === 'w') commit(next, oth); else commit(oth, next);
          }}
          aria-label={`${label} ${key === 'w' ? 'width' : 'height'}`}
        >
          <option value="">—</option>
          {opts.map((o) => (
            <option key={o} value={o}>{o}</option>
          ))}
          <option value="__custom">Type a number…</option>
        </SelectField>
        {customMode && (
          <TextField
            id={`${id}-${key}-custom`}
            style={{ maxWidth: 80 }}
            type="number"
            inputMode="decimal"
            value={custom}
            disabled={disabled}
            onChange={(e) => {
              setCustom(e.target.value);
              const next = { whole: '', frac, custom: e.target.value };
              const oth = other;
              if (key === 'w') commit(next, oth); else commit(oth, next);
            }}
            aria-label={`${label} ${key === 'w' ? 'width' : 'height'} number`}
          />
        )}
        <SelectField
          id={`${id}-${key}f`}
          style={{ maxWidth: 76 }}
          value={String(frac)}
          disabled={disabled}
          onChange={(e) => {
            const v = parseFloat(e.target.value);
            setFrac(v);
            const next = { whole, frac: v, custom };
            const oth = other;
            if (key === 'w') commit(next, oth); else commit(oth, next);
          }}
          aria-label={`${label} ${key === 'w' ? 'width' : 'height'} fraction`}
        >
          {FRACTIONS.map((f) => (
            <option key={f.label} value={String(f.v)}>{f.label}</option>
          ))}
        </SelectField>
      </span>
    );
  };
  return (
    <Field label={label} htmlFor={`${id}-w`}>
      <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
        {dim('w', wWhole, wFrac, wCustom, wCustomMode, setWWhole, setWFrac, setWCustom, setWCustomMode, { whole: hWhole, frac: hFrac, custom: hCustom })}
        <span aria-hidden="true">×</span>
        {dim('h', hWhole, hFrac, hCustom, hCustomMode, setHWhole, setHFrac, setHCustom, setHCustomMode, { whole: wWhole, frac: wFrac, custom: wCustom })}
      </div>
    </Field>
  );
}

/**
 * Stepper plus one measurement/combination box per counted unit.
 * Openings use Dan's Oct 28 number pickers; locks keep free-text combos.
 */
function OpeningCounter({
  id,
  label,
  singular,
  count,
  measurements,
  placeholder,
  disabled,
  onCount,
  onMeasurement,
  presets,
  pickerRanges,
  itemCaption,
}: {
  id: string;
  label: string;
  singular: string;
  count: number;
  measurements: string[];
  placeholder: string;
  disabled?: boolean;
  onCount: (v: number) => void;
  onMeasurement: (i: number, v: string) => void;
  /** Preset W×H dropdown options; omit for free-text only. */
  presets?: string[];
  /** Dan Oct 28 number-picker ranges; when set, replaces presets + text box. */
  pickerRanges?: { w: [number, number]; h: [number, number] };
  /** Caption above the per-unit boxes; defaults to "Measurements — one per …". */
  itemCaption?: string;
}) {
  return (
    <div>
      <Stepper id={id} label={label} value={count} disabled={disabled} onChange={onCount} />
      {count > 0 && (
        <div style={{ marginTop: 8 }}>
          <div style={{ fontSize: 12, color: 'var(--muted)', marginBottom: 4 }}>
            {itemCaption ?? `Measurements — one per ${label.toLowerCase()}`}
          </div>
          {measurements.map((m, i) => (
            <div key={i} style={{ display: 'flex', gap: 8, alignItems: 'flex-end', flexWrap: 'wrap' }}>
              {pickerRanges ? (
                <MeasurementPicker
                  id={`${id}-m${i}`}
                  label={`${singular} ${i + 1}`}
                  value={m}
                  ranges={pickerRanges}
                  disabled={disabled}
                  onChange={(v) => onMeasurement(i, v)}
                />
              ) : presets && (
                <Field label={`${singular} ${i + 1} size`} htmlFor={`${id}-p${i}`}>
                  <SelectField
                    id={`${id}-p${i}`}
                    style={{ maxWidth: 150 }}
                    value={presets.includes(m) ? m : CUSTOM_SIZE_OPTION}
                    disabled={disabled}
                    onChange={(e) => {
                      const v = e.target.value;
                      if (v !== CUSTOM_SIZE_OPTION) onMeasurement(i, v);
                    }}
                  >
                    <option value={CUSTOM_SIZE_OPTION}>{CUSTOM_SIZE_OPTION}</option>
                    {presets.map((p) => (
                      <option key={p} value={p}>
                        {p}
                      </option>
                    ))}
                  </SelectField>
                </Field>
              )}
              {!pickerRanges && (
                <Field label={presets ? `${singular} ${i + 1} custom size` : `${singular} ${i + 1}`} htmlFor={`${id}-m${i}`}>
                  <TextField
                    id={`${id}-m${i}`}
                    value={m}
                    disabled={disabled}
                    onChange={(e) => onMeasurement(i, e.target.value)}
                    placeholder={placeholder}
                    style={{ maxWidth: 200 }}
                    enterKeyHint="next"
                  />
                </Field>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/**
 * Board-up job sheet form. Mirrors the standalone Aquick Board-up intake app:
 * same fields in the same order, live material estimates, photo capture,
 * and Email-this-job / Text-this-job actions.
 */
const BoardUpForm = forwardRef<BoardUpFormHandle, Props>(function BoardUpForm(
  { initial, workspaceId, businessId, jobNumber, disabled, getDraftId, ensureDraft, onChange, onPhotosCommitted, onPhotosChange, business, invoiceDate, jobCreatedAt, isOwner, onDeleted },
  ref,
) {
  const [f, setF] = useState<BoardUpDetails>(() => asBoardUpDetails(initial));
  const [invalidFields, setInvalidFields] = useState<Set<string>>(new Set());
  const [photos, setPhotos] = useState<PhotoItem[]>([]);
  const [photoBusy, setPhotoBusy] = useState(false);
  const [photoError, setPhotoError] = useState<string | null>(null);
  const [shareError, setShareError] = useState<string | null>(null);
  const [shareDone, setShareDone] = useState<string | null>(null);
  /** Which file-share action is currently preparing its files. */
  const [shareBusy, setShareBusy] = useState<'condensed' | 'pictures' | 'emailpdf' | 'delete' | null>(null);
  /** Cities added via "Other", remembered per device. */
  const [customCityNames, setCustomCityNames] = useState<string[]>(() =>
    loadCustomCities(BOARDUP_CUSTOM_CITY_NAMES_KEY),
  );
  const [customCities, setCustomCities] = useState<string[]>(() =>
    loadCustomCities(BOARDUP_CUSTOM_CITIES_KEY),
  );
  /** Text typed into an "Other" box (committed on blur / save). */
  const [otherCityNameText, setOtherCityNameText] = useState('');
  const [otherCityText, setOtherCityText] = useState('');
  /** "+ Add city" button opens the new-city box directly (no need to pick "Other"). */
  const [addingCityName, setAddingCityName] = useState(false);
  const [addingCity, setAddingCity] = useState(false);
  const otherCityNameTextRef = useRef('');
  const otherCityTextRef = useRef('');
  const fileRef = useRef<HTMLInputElement | null>(null);
  const photosRef = useRef<PhotoItem[]>([]);
  photosRef.current = photos;
  /** Latest full details, kept in sync so async photo handlers never use stale fields. */
  const detailsRef = useRef<BoardUpDetails>(asBoardUpDetails(initial));

  const { user } = useAuth();
  /** Crew contacts are editable by the owner and by Dan (master on Aquick). */
  const canManageCrew =
    isOwner || (user?.email ?? '').toLowerCase() === DEFAULT_CREW_EMAIL.toLowerCase();
  const [crewContacts, setCrewContacts] = useState<BoardUpCrewContact[]>([]);
  const [crewLoaded, setCrewLoaded] = useState(false);
  const [crewEditorOpen, setCrewEditorOpen] = useState(false);
  const [crewDraft, setCrewDraft] = useState<Array<{ id?: string; name: string; phone: string; email: string }>>([]);
  const [crewSaveError, setCrewSaveError] = useState<string | null>(null);
  const [crewSaving, setCrewSaving] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const contacts = await listCrewContacts(businessId);
      if (!cancelled) {
        setCrewContacts(contacts);
        setCrewLoaded(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [businessId]);

  /** Crew picker options: DB contacts when loaded, hardcoded fallback otherwise. */
  const crewOptions = useMemo(() => {
    const names =
      crewLoaded && crewContacts.length > 0 ? crewContacts.map((c) => c.name) : CREW_OPTIONS.slice(1);
    const opts = ['Unassigned', ...names];
    if (f.crew && f.crew !== 'Unassigned' && !opts.includes(f.crew)) opts.push(f.crew);
    return opts;
  }, [crewContacts, crewLoaded, f.crew]);

  /** Picking a crew member auto-fills their saved phone + email. */
  const pickCrew = (name: string) => {
    const contact = crewContactFor(name, crewContacts);
    applyDetails({
      ...detailsRef.current,
      crew: name,
      textTo: contact ? contact.phone : '',
      emailTo: contact ? contact.email : DEFAULT_CREW_EMAIL,
    });
    setInvalidFields((prev) => {
      if (!prev.has('crew')) return prev;
      const next = new Set(prev);
      next.delete('crew');
      return next;
    });
  };

  /** "Email to" choices: saved crew emails, defaulting to Dan's address. */
  const crewEmails = useMemo(() => {
    const list = crewContacts
      .filter((c) => c.email.trim())
      .map((c) => ({ name: c.name, email: c.email.trim() }));
    if (!list.some((e) => e.email.toLowerCase() === DEFAULT_CREW_EMAIL.toLowerCase())) {
      list.unshift({ name: 'Dan', email: DEFAULT_CREW_EMAIL });
    }
    return list;
  }, [crewContacts]);
  const emailIsCustom =
    f.emailTo.trim() !== '' &&
    !crewEmails.some((e) => e.email.toLowerCase() === f.emailTo.trim().toLowerCase());

  const openCrewEditor = () => {
    setCrewDraft(crewContacts.map((c) => ({ id: c.id, name: c.name, phone: c.phone, email: c.email })));
    setCrewSaveError(null);
    setCrewEditorOpen(true);
  };
  const updateCrewDraftRow = (i: number, patch: Partial<{ name: string; phone: string; email: string }>) => {
    setCrewDraft((prev) => prev.map((r, j) => (j === i ? { ...r, ...patch } : r)));
  };
  const blurCrewDraftPhone = (i: number) => {
    setCrewDraft((prev) =>
      prev.map((r, j) => (j === i ? { ...r, phone: formatPhone(r.phone) } : r)),
    );
  };
  const saveCrewDraft = async () => {
    const emailRe = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    for (const r of crewDraft) {
      if (!r.name.trim()) {
        setCrewSaveError('Every crew member needs a name.');
        return;
      }
      if (r.phone.trim() && !isValidPhone(r.phone)) {
        setCrewSaveError(`"${r.name.trim()}" phone number is not valid — ${PHONE_HINT}.`);
        return;
      }
      if (r.email.trim() && !emailRe.test(r.email.trim())) {
        setCrewSaveError(`"${r.name.trim()}" email address is not valid.`);
        return;
      }
    }
    const names = crewDraft.map((r) => r.name.trim().toLowerCase());
    if (new Set(names).size !== names.length) {
      setCrewSaveError('Crew member names must be unique.');
      return;
    }
    setCrewSaving(true);
    setCrewSaveError(null);
    try {
      await saveCrewContacts(businessId, crewDraft);
      setCrewContacts(await listCrewContacts(businessId));
      setCrewEditorOpen(false);
    } catch (e) {
      setCrewSaveError(e instanceof Error ? e.message : 'Could not save crew contacts.');
    } finally {
      setCrewSaving(false);
    }
  };

  const setPhotosAndNotify = (next: PhotoItem[]) => {
    setPhotos(next);
    setShareDone(null);
    onPhotosChange?.(next.map((p) => ({ path: p.path, url: p.url })));
  };

  const set = <K extends keyof BoardUpDetails>(key: K, value: BoardUpDetails[K]) => {
    setF((prev) => {
      const next = { ...prev, [key]: value, photos: photosRef.current.map((p) => p.path) };
      detailsRef.current = next;
      onChange(next);
      return next;
    });    setInvalidFields((prev) => {
      if (!prev.has(key as string)) return prev;
      const next = new Set(prev);
      next.delete(key as string);
      return next;
    });
  };

  /** Updates details + ref + parent in one step (same pattern as `set`). */
  const applyDetails = (next: BoardUpDetails) => {
    const withPhotos = { ...next, photos: photosRef.current.map((p) => p.path) };
    detailsRef.current = withPhotos;
    setF(withPhotos);
    onChange(withPhotos);
  };

  /** Opening count change: also grows/shrinks the measurement boxes to match. */
  const setOpeningCount = (
    countKey: 'windows' | 'doors' | 'sliders' | 'garageDoors' | 'acUnits' | 'haspLocks' | 'chainLocks',
    mKey: MeasurementKey,
    v: number,
  ) => {
    applyDetails({
      ...detailsRef.current,
      [countKey]: v,
      [mKey]: syncMeasurementCount(v, detailsRef.current[mKey]),
    });
  };

  /** Edits one measurement box. */
  const setMeasurement = (mKey: MeasurementKey, i: number, v: string) => {
    const arr = [...detailsRef.current[mKey]];
    arr[i] = v;
    applyDetails({ ...detailsRef.current, [mKey]: arr });
  };

  /** Two by Fours lines (Dan's crew-entry section 04 block). */
  const setTwoByFours = (next: TwoByFourLine[]) => {
    applyDetails({ ...detailsRef.current, twoByFours: next });
  };
  const addTwoByFour = () => {
    setTwoByFours([
      ...detailsRef.current.twoByFours,
      { size: '2 x 4 x 8', customLinealFeet: '', quantity: 1 },
    ]);
  };
  const updateTwoByFour = (i: number, patch: Partial<TwoByFourLine>) => {
    setTwoByFours(detailsRef.current.twoByFours.map((line, j) => (j === i ? { ...line, ...patch } : line)));
  };
  const removeTwoByFour = (i: number) => {
    setTwoByFours(detailsRef.current.twoByFours.filter((_, j) => j !== i));
  };
  const twoByFourTotalsValue = twoByFourTotals(f.twoByFours);

  /**
   * Commit a city typed into an "Other" box: remember it for future jobs and
   * select it as the field value. Runs on blur and again at validate/save
   * time so the value is never lost when jumping straight to Save.
   */
  const commitOtherCityTexts = () => {
    if (disabled) return;
    const withPhotos = (d: BoardUpDetails): BoardUpDetails => ({
      ...d,
      photos: photosRef.current.map((p) => p.path),
    });
    const nameText = otherCityNameTextRef.current.trim();
    if ((detailsRef.current.cityName === 'Other' || addingCityName) && nameText !== '') {
      setCustomCityNames(rememberCustomCity(BOARDUP_CUSTOM_CITY_NAMES_KEY, nameText, CITY_NAME_OPTIONS));
      const next = withPhotos({ ...detailsRef.current, cityName: nameText });
      detailsRef.current = next;
      setF(next);
      onChange(next);
      otherCityNameTextRef.current = '';
      setOtherCityNameText('');
    }
    setAddingCityName(false);
    const cityText = otherCityTextRef.current.trim();
    if ((detailsRef.current.city === 'Other' || addingCity) && cityText !== '') {
      setCustomCities(rememberCustomCity(BOARDUP_CUSTOM_CITIES_KEY, cityText, CITY_OPTIONS));
      const next = withPhotos({ ...detailsRef.current, city: cityText });
      detailsRef.current = next;
      setF(next);
      onChange(next);
      otherCityTextRef.current = '';
      setOtherCityText('');
    }
    setAddingCity(false);
  };

  // Browser tab / print-to-PDF name: "Aquick Job", not the generic app title.
  useEffect(() => {
    const prev = document.title;
    document.title = 'Aquick Job';
    return () => {
      document.title = prev;
    };
  }, []);

  // Resolve view URLs for photos already stored on the job.
  useEffect(() => {    let cancelled = false;
    (async () => {
      const items: PhotoItem[] = [];
      for (const path of asBoardUpDetails(initial).photos) {
        try {
          const url = await boardUpPhotoUrl(path);
          items.push({ path, url, thumbUrl: await downscalePhotoForPdf(url) });
        } catch {
          /* unreadable photo — leave it out of the thumbnails */
        }
      }
      if (!cancelled) {
        setPhotosAndNotify(items);
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const est = useMemo(
    () => estimateBoardUp(f.windows, f.doors, f.sliders, f.garageDoors, f.acUnits),
    [f.windows, f.doors, f.sliders, f.garageDoors, f.acUnits],
  );

  /** Measured totals from the actual sizes entered (Dan's crew-entry grand
   * total); separate from the flat-rate SQ FT COVER estimate above.
   * Dan, Oct 26: sizes in "Other opening information" count too. */
  const measured = useMemo(
    () =>
      measuredTotals([
        f.windowMeasurements,
        f.doorMeasurements,
        f.sliderMeasurements,
        f.garageMeasurements,
        f.acMeasurements,
        otherOpeningSizes(f.otherOpenings),
      ]),
    [f.windowMeasurements, f.doorMeasurements, f.sliderMeasurements, f.garageMeasurements, f.acMeasurements, f.otherOpenings],
  );

  /** Dan, Oct 26/28: nested cut list, with oversize openings split into parts. */
  const cutList = useMemo(() => {
    const pieces: { label: string; w: number; h: number }[] = [];
    const groups: [string, string[]][] = [
      ['Window', f.windowMeasurements],
      ['Door', f.doorMeasurements],
      ['Slider', f.sliderMeasurements],
      ['Garage door', f.garageMeasurements],
      ['AC', f.acMeasurements],
    ];
    for (const [label, arr] of groups) {
      arr.forEach((m, i) => {
        const match = /^\s*(\d+(?:\.\d+)?)\s*x\s*(\d+(?:\.\d+)?)\s*$/i.exec(m ?? '');
        if (match) pieces.push({ label: `${label} ${i + 1}`, w: parseFloat(match[1]), h: parseFloat(match[2]) });
      });
    }
    otherOpeningSizes(f.otherOpenings).forEach((m, i) => {
      const match = /^(\d+(?:\.\d+)?)x(\d+(?:\.\d+)?)$/.exec(m);
      if (match) pieces.push({ label: `Other ${i + 1}`, w: parseFloat(match[1]), h: parseFloat(match[2]) });
    });
    return buildCutList(pieces);
  }, [f.windowMeasurements, f.doorMeasurements, f.sliderMeasurements, f.garageMeasurements, f.acMeasurements, f.otherOpenings]);

  const cityNameOptions = useMemo(
    () => withCustomCities(CITY_NAME_OPTIONS, customCityNames),
    [customCityNames],
  );
  const cityOptions = useMemo(() => withCustomCities(CITY_OPTIONS, customCities), [customCities]);

  const fieldError = (key: string) => (invalidFields.has(key) ? 'This field is required.' : undefined);

  const validate = (): { errors: string[]; invalid: string[] } => {
    commitOtherCityTexts();
    const cur = detailsRef.current;
    const errs: string[] = [];
    const invalid: string[] = [];
    if (!cur.cityName) {
      errs.push('Choose a city name.');
      invalid.push('cityName');
    } else if (cur.cityName === 'Other') {
      errs.push('Type the new city name.');
      invalid.push('cityName');
    }
    if (!cur.streetAddress.trim()) {
      errs.push('Street address is required.');
      invalid.push('streetAddress');
    }
    if (!cur.crew || cur.crew === 'Unassigned') {
      errs.push('Choose the crew member.');
      invalid.push('crew');
    }
    if (cur.phone.trim() && !isValidPhone(cur.phone)) {
      errs.push(`Phone number format is not valid — ${PHONE_HINT}.`);
      invalid.push('phone');
    }
    if (cur.textTo.trim() && !isValidPhone(cur.textTo)) {
      errs.push(`Text-to phone number format is not valid — ${PHONE_HINT}.`);
      invalid.push('textTo');
    }
    if (cur.emailTo.trim() && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(cur.emailTo.trim())) {
      errs.push('Email-to address is not valid.');
      invalid.push('emailTo');
    }
    setInvalidFields(new Set(invalid));
    return { errors: errs, invalid };
  };

  useImperativeHandle(ref, () => ({ validate }), [f]);

  const enterToNext = (e: React.KeyboardEvent<HTMLElement>) => {
    if (e.key !== 'Enter') return;
    const target = e.target as HTMLElement;
    if (target.tagName !== 'INPUT') return;
    const type = (target as HTMLInputElement).type;
    if (type === 'button' || type === 'submit' || type === 'radio' || type === 'checkbox' || type === 'file') return;
    const idx = FLOW.indexOf((target as HTMLInputElement).id);
    if (idx === -1) return;
    e.preventDefault();
    for (let i = idx + 1; i < FLOW.length; i++) {
      const el = document.getElementById(FLOW[i]) as HTMLElement | null;
      if (el && !(el as HTMLInputElement).disabled && el.offsetParent !== null) {
        el.focus({ preventScroll: true });
        el.scrollIntoView({ behavior: 'smooth', block: 'center' });
        try {
          if (el instanceof HTMLInputElement && el.type === 'text') el.select();
        } catch {
          /* select() unsupported — focus is enough */
        }
        return;
      }
    }
  };

  const details = (): BoardUpDetails => detailsRef.current;

  const onFiles = async (files: FileList | null) => {
    if (!files || files.length === 0 || disabled) return;
    setPhotoError(null);
    const valid = Array.from(files).filter((file) => {
      if (!file.type.startsWith('image/')) {
        setPhotoError(`"${file.name}" is not an image — skipped.`);
        return false;
      }
      if (file.size > 10 * 1024 * 1024) {
        setPhotoError(`"${file.name}" is over 10 MB — skipped.`);
        return false;
      }
      return true;
    });
    if (valid.length === 0) return;
    setPhotoBusy(true);
    try {
      let id = getDraftId();
      if (!id) id = await ensureDraft();
      if (!id) {
        setPhotoError('Could not save the job — photos need a saved job first. Try again.');
        return;
      }
      const next = [...photosRef.current];
      const takenAt: Record<string, string> = { ...detailsRef.current.photoTakenAt };
      for (const file of valid) {
        const path = await uploadBoardUpPhoto(workspaceId, businessId, id, file);
        const url = await boardUpPhotoUrl(path);
        // Capture the photo's date/time now, from the original file — the PDF
        // downscale strips EXIF, so this is the reliable moment. Texted photos
        // arrive with EXIF stripped, so fall back to the file's saved date.
        try {
          const raw =
            parseExifDateTime(await file.arrayBuffer()) ?? fileModifiedToExifRaw(file.lastModified);
          if (raw) takenAt[path] = raw;
        } catch {
          /* a missing date must never block the upload */
        }
        next.push({ path, url, thumbUrl: await downscalePhotoForPdf(url) });
      }
      setPhotosAndNotify(next);
      const paths = next.map((p) => p.path);
      const d = { ...detailsRef.current, photos: paths, photoTakenAt: takenAt };
      detailsRef.current = d;
      setF(d);
      onChange(d);
      onPhotosCommitted?.(d);
    } catch (e) {
      setPhotoError(e instanceof Error ? e.message : 'Photo upload failed.');
    } finally {
      setPhotoBusy(false);
      if (fileRef.current) fileRef.current.value = '';
    }
  };

  const removePhoto = async (path: string) => {
    setPhotoError(null);
    try {
      await removeBoardUpPhoto(path);
    } catch (e) {
      setPhotoError(e instanceof Error ? e.message : 'Could not remove the photo from storage.');
    }
    const next = photosRef.current.filter((p) => p.path !== path);
    setPhotosAndNotify(next);
    const paths = next.map((p) => p.path);
    const takenAt = { ...detailsRef.current.photoTakenAt };
    delete takenAt[path];
    const d = { ...detailsRef.current, photos: paths, photoTakenAt: takenAt };
    detailsRef.current = d;
    setF(d);
    onChange(d);
    onPhotosCommitted?.(d);
  };

  /** Set (or clear) one photo's taken time — manual correction for photos
   * whose EXIF was stripped before upload (e.g. texted photos). */
  const setPhotoTakenAt = (path: string, raw: string | null) => {
    const takenAt = { ...(detailsRef.current.photoTakenAt ?? {}) };
    if (raw) takenAt[path] = raw;
    else delete takenAt[path];
    const d = { ...detailsRef.current, photoTakenAt: takenAt };
    detailsRef.current = d;
    setF(d);
    onChange(d);
  };

  const [bulkPhotoTime, setBulkPhotoTime] = useState('');
  /** Apply one taken time to every photo — the crew's texted batches come
   * from a single job visit, so one timestamp usually covers them all. */
  const applyBulkPhotoTime = () => {
    const raw = inputToExifRaw(bulkPhotoTime);
    if (!raw) return;
    const takenAt = { ...(detailsRef.current.photoTakenAt ?? {}) };
    for (const p of photosRef.current) takenAt[p.path] = raw;
    const d = { ...detailsRef.current, photoTakenAt: takenAt };
    detailsRef.current = d;
    setF(d);
    onChange(d);
    setBulkPhotoTime('');
  };

  const emailJob = () => {
    setShareError(null);
    const d = details();
    const subject = `Board-up job${jobNumber ? ` #${jobNumber}` : ''} — ${d.streetAddress || 'new job'}`;
    const body = buildBoardUpSummary(d, jobNumber, { jobDateTime: jobCreatedAt ?? null });
    window.location.href = `mailto:${encodeURIComponent(d.emailTo.trim())}?subject=${encodeURIComponent(
      subject,
    )}&body=${encodeURIComponent(body)}`;
  };

  const textJob = () => {
    setShareError(null);
    const d = details();
    const num = digitsOnly(d.textTo);
    if (!num) {
      setShareError('Enter a "Text to" phone number first.');
      return;
    }
    const body = buildBoardUpSmsText(d, { jobDateTime: jobCreatedAt ?? null });
    const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent);
    window.location.href = `sms:${num}${isIOS ? '&body=' : '?body='}${encodeURIComponent(body)}`;
  };

  /** Renders the job sheet PDF from live form state (draft or issued). */
  const renderSharePdf = async (photosOnly = false, includePhotos = true): Promise<Blob> => {
    const contacts = crewLoaded ? crewContacts : await listCrewContacts(businessId);
    const rob = crewContactFor('Rob', contacts);
    const snap = buildBoardUpShareSnapshot({
      business,
      details: detailsRef.current as unknown as Record<string, unknown>,
      jobNumber,
      invoiceDate,
      jobCreatedAt: jobCreatedAt ?? null,
      crewContact:
        rob && (rob.phone.trim() || rob.email.trim())
          ? { name: 'Rob Kaleky', phone: formatPhone(rob.phone), email: rob.email.trim() }
          : null,
    });
    return renderInvoicePdfBlob(snap, 'classic', 'LETTER', photosOnly, includePhotos);
  };

  /** Save condensed PDF: job summary only (photos live in the separate pictures PDF). */
  const saveCondensedPdf = async () => {
    if (shareBusy) return;
    setShareError(null);
    setShareDone(null);
    setShareBusy('condensed');
    try {
      const blob = await renderSharePdf(false, false);
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = boardUpPdfFilename(details(), invoiceDate, 'condensed');
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 5000);
    } catch (e) {
      setShareError(e instanceof Error ? e.message : 'Could not build the condensed PDF.');
    } finally {
      setShareBusy(null);
    }
  };

  /** Save pictures PDF: photos only, 4 per page with the "A QUICK BOARD UP SERVICE —
   * JOB PHOTOS" header, picture count, and address banner under every photo. */
  const savePicturesPdf = async () => {
    if (shareBusy) return;
    setShareError(null);
    setShareDone(null);
    setShareBusy('pictures');
    try {
      const blob = await renderSharePdf(true, true);
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = boardUpPdfFilename(details(), invoiceDate, 'photos');
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 5000);
    } catch (e) {
      setShareError(e instanceof Error ? e.message : 'Could not build the pictures PDF.');
    } finally {
      setShareBusy(null);
    }
  };

  /** Email job PDF: sends the email directly out of the app via the backend —
   * two condensed PDFs attached (job-information PDF + pictures PDF, 4 per page
   * with the photo header), one-line message. The recipient comes from the
   * "Email to" field. */
  const emailPdf = async () => {
    if (shareBusy) return;
    const d = details();
    const to = d.emailTo.trim();
    if (!to || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(to)) {
      setShareError('Enter the recipient’s email in “Email to” first.');
      return;
    }
    const subject = `Board-up job${jobNumber ? ` #${jobNumber}` : ''} — ${d.streetAddress || 'new job'}`;
    const addr = [d.streetAddress, d.city].filter(Boolean).join(', ');
    const message = `Aquick board-up job${jobNumber ? ` ${jobNumber}` : ''}${addr ? ` — ${addr}` : ''}. Job details and photos are attached.`;
    setShareError(null);
    setShareDone(null);
    setShareBusy('emailpdf');
    try {
      // Both PDFs are condensed: photos are downscaled before embedding, so the
      // emailed files are always the small versions, never full size.
      const [infoBlob, picsBlob] = await Promise.all([renderSharePdf(false, false), renderSharePdf(true, true)]);
      const [infoB64, picsB64] = await Promise.all([blobToBase64(infoBlob), blobToBase64(picsBlob)]);
      await sendBoardUpEmail({
        business_id: businessId,
        to,
        subject,
        message,
        attachments: [
          { filename: boardUpPdfFilename(d, invoiceDate, 'condensed'), content: infoB64 },
          { filename: boardUpPdfFilename(d, invoiceDate, 'photos'), content: picsB64 },
        ],
      });
      setShareDone(`Email sent to ${to}.`);
    } catch (e) {
      setShareError(e instanceof Error ? e.message : 'Could not send the email.');
    } finally {
      setShareBusy(null);
    }
  };

  /** Delete job: owner-only, permanent, confirmed first. */
  const deleteJob = async () => {
    if (shareBusy) return;
    const id = getDraftId();
    if (!id) {
      setShareError('Nothing to delete — the job hasn’t been saved yet.');
      return;
    }
    if (!window.confirm('Delete this job permanently? Photos and the PDF go with it. This cannot be undone.')) return;
    setShareError(null);
    setShareBusy('delete');
    try {
      await deleteInvoiceDeep(id);
      onDeleted();
    } catch (e) {
      setShareError(e instanceof Error ? e.message : 'Delete failed.');
    } finally {
      setShareBusy(null);
    }
  };

  const blurPhone = (key: 'phone' | 'textTo') => {
    const v = f[key].trim();
    if (v && isValidPhone(v)) set(key, formatPhone(v));
  };

  /** Dan, Oct 28, scoped to new jobs only: a local backstop draft, so work
   * typed before the required fields are filled (when the server autosave
   * can't validate yet) survives closing the app. Saved jobs use the server
   * draft, so this never overwrites a saved job. */
  const [draftRestored, setDraftRestored] = useState(false);
  const draftLoadedRef = useRef(false);
  useEffect(() => {
    if (disabled) return;
    const key = `aquick-unsaved-draft-${businessId}-new`;
    if (getDraftId()) {
      try { localStorage.removeItem(key); } catch { /* ignore */ }
      return;
    }
    if (draftLoadedRef.current) return;
    draftLoadedRef.current = true;
    try {
      const raw = localStorage.getItem(key);
      if (!raw) return;
      const parsed = asBoardUpDetails(JSON.parse(raw));
      if (JSON.stringify(parsed) === JSON.stringify(asBoardUpDetails(initial))) return;
      applyDetails(parsed);
      setDraftRestored(true);
    } catch { /* corrupt draft — ignore */ }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useEffect(() => {
    if (disabled || getDraftId()) return;
    if (!draftLoadedRef.current) return;
    try {
      localStorage.setItem(`aquick-unsaved-draft-${businessId}-new`, JSON.stringify(detailsRef.current));
    } catch { /* storage full/unavailable — server autosave still applies */ }
  }, [f, businessId, disabled]);

  return (
    <div onKeyDown={enterToNext} className="bu-dark">
      <div className="bu-head">
        <h1>Enter the completed job</h1>
        <p>Fill in the job, add measurements and photos, then send the job from your phone.</p>
        {draftRestored && (
          <div style={{ marginTop: 10, display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
            <span style={{ fontSize: 13, fontWeight: 600 }}>Draft restored — your unsaved changes are back.</span>
            <Button
              variant="secondary"
              size="sm"
              onClick={() => {
                try { localStorage.removeItem(`aquick-unsaved-draft-${businessId}-new`); } catch { /* ignore */ }
                applyDetails(asBoardUpDetails(initial));
                setDraftRestored(false);
              }}
            >
              Discard draft
            </Button>
          </div>
        )}
        <div className="bu-head-meta">5 sections · one file</div>
        <div className="bu-note">Email job PDF sends the job details plus photos.</div>
      </div>
      <section className="bu-section">
        <div className="bu-section-head">
          <div>
            <h2>Job &amp; property</h2>
            <p>Job date is set above · customer and property details.</p>
          </div>
          <span className="bu-section-num">01</span>
        </div>
      {/* Job time (Dan's crew-entry "Time"); the job date is the Job date
          field in the editor above this form. */}
      <Field label="Job time" htmlFor="bu-jobtime">
        <TextField
          id="bu-jobtime"
          style={{ maxWidth: 180 }}
          type="time"
          enterKeyHint="next"
          value={f.jobTime}
          disabled={disabled}
          onChange={(e) => set('jobTime', e.target.value)}
        />
      </Field>

      <Field label="City name *" htmlFor="bu-cityname" error={fieldError('cityName')}>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <SelectField
            id="bu-cityname"
          style={{ maxWidth: 260 }}
            value={f.cityName}
            disabled={disabled}
            onChange={(e) => {
              const v = e.target.value;
              if (v !== 'Other') {
                otherCityNameTextRef.current = '';
                setOtherCityNameText('');
                setAddingCityName(false);
              }
              set('cityName', v);
            }}
          >
            <option value="">Select a city…</option>
            {cityNameOptions.map((o) => (
              <option key={o} value={o}>
                {o}
              </option>
            ))}
          </SelectField>
          {!disabled && (
            <Button variant="ghost" size="sm" onClick={() => setAddingCityName(true)}>
              + Add city
            </Button>
          )}
        </div>
      </Field>
      {!disabled && (f.cityName === 'Other' || addingCityName) && (
        <Field label="New city name" htmlFor="bu-cityname-other" error={fieldError('cityName')}>
          <TextField
            id="bu-cityname-other"
            style={{ maxWidth: 280 }}
            enterKeyHint="next"
            value={otherCityNameText}
            disabled={disabled}
            onChange={(e) => {
              otherCityNameTextRef.current = e.target.value;
              setOtherCityNameText(e.target.value);
            }}
            onBlur={() => commitOtherCityTexts()}
            placeholder="Type the new city name"
          />
        </Field>
      )}

      <Field label="Other – customer name" htmlFor="bu-othercustomer">
        <TextField
          id="bu-othercustomer"
          style={{ maxWidth: 300 }}
          enterKeyHint="next"
          value={f.otherCustomerName}
          disabled={disabled}
          onChange={(e) => set('otherCustomerName', e.target.value)}
          placeholder="Customer name"
        />
      </Field>

      <Field label="Caller name" htmlFor="bu-caller">
        <TextField
          id="bu-caller"
          style={{ maxWidth: 300 }}
          enterKeyHint="next"
          value={f.callerName}
          disabled={disabled}
          onChange={(e) => set('callerName', e.target.value)}
          placeholder="Who called the job in"
        />
      </Field>

      <Field label="Street address *" htmlFor="bu-street" error={fieldError('streetAddress')}>
        <TextField
          id="bu-street"
          style={{ maxWidth: 440 }}
          enterKeyHint="next"
          value={f.streetAddress}
          disabled={disabled}
          onChange={(e) => set('streetAddress', e.target.value)}
          placeholder="123 Main St"
        />
      </Field>

      <Field label="City" htmlFor="bu-city">
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <SelectField
            id="bu-city"
          style={{ maxWidth: 260 }}
            value={f.city}
            disabled={disabled}
            onChange={(e) => {
              const v = e.target.value;
              if (v !== 'Other') {
                otherCityTextRef.current = '';
                setOtherCityText('');
                setAddingCity(false);
              }
              set('city', v);
            }}
          >
            <option value="">Select a city…</option>
            {cityOptions.map((o) => (
              <option key={o} value={o}>
                {o}
              </option>
            ))}
          </SelectField>
          {!disabled && (
            <Button variant="ghost" size="sm" onClick={() => setAddingCity(true)}>
              + Add city
            </Button>
          )}
        </div>
      </Field>
      {!disabled && (f.city === 'Other' || addingCity) && (
        <Field label="New city name" htmlFor="bu-city-other">
          <TextField
            id="bu-city-other"
            style={{ maxWidth: 280 }}
            enterKeyHint="next"
            value={otherCityText}
            disabled={disabled}
            onChange={(e) => {
              otherCityTextRef.current = e.target.value;
              setOtherCityText(e.target.value);
            }}
            onBlur={() => commitOtherCityTexts()}
            placeholder="Type the new city name"
          />
        </Field>
      )}

      <Field label="State" htmlFor="bu-state">
        <TextField
          id="bu-state"
          style={{ maxWidth: 200 }}
          enterKeyHint="next"
          value={f.state}
          disabled={disabled}
          onChange={(e) => set('state', e.target.value)}
          placeholder="Florida"
        />
      </Field>

      <Field label="Phone number" htmlFor="bu-phone" error={fieldError('phone')} hint={PHONE_HINT}>
        <TextField
          id="bu-phone"
          style={{ maxWidth: 200 }}
          enterKeyHint="next"
          inputMode="tel"
          value={f.phone}
          disabled={disabled}
          onChange={(e) => set('phone', e.target.value)}
          onBlur={() => blurPhone('phone')}
          placeholder="(954) 555-0123"
        />
      </Field>

      <Field label="Case number" htmlFor="bu-case">
        <TextField
          id="bu-case"
          style={{ maxWidth: 190 }}
          enterKeyHint="next"
          value={f.caseNumber}
          disabled={disabled}
          onChange={(e) => set('caseNumber', e.target.value)}
          placeholder="Case number"
        />
      </Field>

      <Field label="Requesting officer and badge number" htmlFor="bu-officer">
        <TextField
          id="bu-officer"
          style={{ maxWidth: 320 }}
          enterKeyHint="next"
          value={f.requestingOfficer}
          disabled={disabled}
          onChange={(e) => set('requestingOfficer', e.target.value)}
          placeholder="Officer name, badge #"
        />
      </Field>

      <Field label="Type" htmlFor="bu-type">
        <SelectField
          id="bu-type"
          style={{ maxWidth: 240 }}
          value={f.propertyType}
          disabled={disabled}
          onChange={(e) => set('propertyType', e.target.value)}
        >
          {PROPERTY_TYPE_OPTIONS.map((o) => (
            <option key={o} value={o}>
              {o}
            </option>
          ))}
        </SelectField>
      </Field>

      </section>
      <section className="bu-section">
        <div className="bu-section-head">
          <div>
            <h2>Board Up Details</h2>
            <p>Service and crew assignment.</p>
          </div>
          <span className="bu-section-num">02</span>
        </div>
      <Field label="Service needed" htmlFor="bu-service">
        <SelectField
          id="bu-service"
          style={{ maxWidth: 300 }}
          value={f.serviceNeeded}
          disabled={disabled}
          onChange={(e) => set('serviceNeeded', e.target.value)}
        >
          {SERVICE_NEEDED_OPTIONS.map((o) => (
            <option key={o} value={o}>
              {o}
            </option>
          ))}
        </SelectField>
      </Field>

      <Field label="Urgency" htmlFor="bu-urgency">
        <SelectField
          id="bu-urgency"
          value={f.urgency}
          disabled={disabled}
          onChange={(e) => set('urgency', e.target.value)}
        >
          {URGENCY_OPTIONS.map((o) => (
            <option key={o} value={o}>
              {o}
            </option>
          ))}
        </SelectField>
      </Field>

      <Field label="Needed by" htmlFor="bu-neededby">
        <TextField
          id="bu-neededby"
          style={{ maxWidth: 230 }}
          type="datetime-local"
          value={f.neededBy}
          disabled={disabled}
          onChange={(e) => set('neededBy', e.target.value)}
        />
      </Field>

      <Field label="Reference link" htmlFor="bu-reflink">
        <TextField
          id="bu-reflink"
          style={{ maxWidth: 420 }}
          type="url"
          inputMode="url"
          placeholder="https://aquick.kalekycomputer.com"
          value={f.referenceLink}
          disabled={disabled}
          onChange={(e) => set('referenceLink', e.target.value)}
        />
      </Field>

      <Field
        label="Crew"
        htmlFor="bu-crew"
        error={!f.crew || f.crew === 'Unassigned' ? 'Choose the crew member.' : fieldError('crew')}
      >
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
          <SelectField
            id="bu-crew"
            style={{ maxWidth: 190 }}
            value={f.crew}
            disabled={disabled}
            onChange={(e) => pickCrew(e.target.value)}
          >
            {crewOptions.map((o) => (
              <option key={o} value={o}>
                {o}
              </option>
            ))}
          </SelectField>
          {canManageCrew && !disabled && (
            <Button variant="secondary" size="sm" onClick={openCrewEditor}>
              Edit crew
            </Button>
          )}
        </div>
      </Field>

      {crewEditorOpen && (
        <Modal title="Crew contacts" onClose={() => setCrewEditorOpen(false)}>
          <p className="hint" style={{ marginTop: 0 }}>
            Phone and email save per crew member. Picking a crew member on the job fills in
            &ldquo;Text to&rdquo; and &ldquo;Email to&rdquo; automatically.
          </p>
          {crewDraft.map((row, i) => (
            <div
              key={row.id ?? `new-${i}`}
              style={{ display: 'flex', gap: 8, marginBottom: 8, flexWrap: 'wrap', alignItems: 'center' }}
            >
              <TextField
                placeholder="Name"
                value={row.name}
                onChange={(e) => updateCrewDraftRow(i, { name: e.target.value })}
                style={{ maxWidth: 110 }}
                aria-label="Crew member name"
              />
              <TextField
                placeholder="(954) 555-0123"
                value={row.phone}
                onChange={(e) => updateCrewDraftRow(i, { phone: e.target.value })}
                onBlur={() => blurCrewDraftPhone(i)}
                style={{ maxWidth: 150 }}
                inputMode="tel"
                aria-label="Crew member phone"
              />
              <TextField
                placeholder="email@example.com"
                value={row.email}
                onChange={(e) => updateCrewDraftRow(i, { email: e.target.value })}
                style={{ maxWidth: 210 }}
                inputMode="email"
                aria-label="Crew member email"
              />
              <Button variant="danger" size="sm" onClick={() => setCrewDraft((prev) => prev.filter((_, j) => j !== i))}>
                Remove
              </Button>
            </div>
          ))}
          <div style={{ display: 'flex', gap: 8, marginTop: 8, flexWrap: 'wrap' }}>
            <Button
              variant="secondary"
              onClick={() => setCrewDraft((prev) => [...prev, { name: '', phone: '', email: '' }])}
            >
              Add crew member
            </Button>
            <Button onClick={saveCrewDraft} disabled={crewSaving}>
              {crewSaving ? 'Saving…' : 'Save'}
            </Button>
            <Button variant="secondary" onClick={() => setCrewEditorOpen(false)}>
              Cancel
            </Button>
          </div>
          {crewSaveError && (
            <div style={{ marginTop: 8 }}>
              <Alert kind="error">{crewSaveError}</Alert>
            </div>
          )}
        </Modal>
      )}

      <Field label="Additional crew name (optional)" htmlFor="bu-addcrew">
        <TextField
          id="bu-addcrew"
          style={{ maxWidth: 300 }}
          enterKeyHint="next"
          value={f.additionalCrew}
          disabled={disabled}
          onChange={(e) => set('additionalCrew', e.target.value)}
          placeholder="Crew member name"
        />
      </Field>

      <Field label="Access, hazards, gate codes, dogs, etc." htmlFor="bu-access">
        <TextArea
          id="bu-access"
          style={{ maxWidth: 520 }}
          value={f.accessNotes}
          disabled={disabled}
          onChange={(e) => set('accessNotes', e.target.value)}
          placeholder="e.g. Side gate code 4419. Broken glass in master. Ladder needed for 2nd floor."
          rows={3}
        />
      </Field>

      </section>
      <section className="bu-section">
        <div className="bu-section-head">
          <div>
            <h2>Openings &amp; measurements</h2>
            <p>Set the count. One measurement field appears for each opening.</p>
          </div>
          <span className="bu-section-num">03</span>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          <OpeningCounter
            id="bu-win" label="Windows" singular="Window" count={f.windows}
            measurements={f.windowMeasurements} placeholder="e.g. 36x45" disabled={disabled}
            pickerRanges={MEASUREMENT_RANGES.windows}
            onCount={(v) => setOpeningCount('windows', 'windowMeasurements', v)}
            onMeasurement={(i, v) => setMeasurement('windowMeasurements', i, v)}
          />
          <OpeningCounter
            id="bu-door" label="Doors" singular="Door" count={f.doors}
            measurements={f.doorMeasurements} placeholder="e.g. 38x81" disabled={disabled}
            pickerRanges={MEASUREMENT_RANGES.doors}
            onCount={(v) => setOpeningCount('doors', 'doorMeasurements', v)}
            onMeasurement={(i, v) => setMeasurement('doorMeasurements', i, v)}
          />
          <OpeningCounter
            id="bu-slider" label="Sliders / patios" singular="Slider" count={f.sliders}
            measurements={f.sliderMeasurements} placeholder="e.g. 72x80" disabled={disabled}
            pickerRanges={MEASUREMENT_RANGES.sliders}
            onCount={(v) => setOpeningCount('sliders', 'sliderMeasurements', v)}
            onMeasurement={(i, v) => setMeasurement('sliderMeasurements', i, v)}
          />
          <OpeningCounter
            id="bu-gar" label="Garage doors" singular="Garage door" count={f.garageDoors}
            measurements={f.garageMeasurements} placeholder="e.g. 96x84" disabled={disabled}
            pickerRanges={MEASUREMENT_RANGES.garageDoors}
            onCount={(v) => setOpeningCount('garageDoors', 'garageMeasurements', v)}
            onMeasurement={(i, v) => setMeasurement('garageMeasurements', i, v)}
          />
          <OpeningCounter
            id="bu-ac" label="AC units" singular="AC" count={f.acUnits}
            measurements={f.acMeasurements} placeholder="e.g. 30x24" disabled={disabled}
            pickerRanges={MEASUREMENT_RANGES.acUnits}
            onCount={(v) => setOpeningCount('acUnits', 'acMeasurements', v)}
            onMeasurement={(i, v) => setMeasurement('acMeasurements', i, v)}
          />
        </div>
        <div style={{ fontSize: 13, color: 'var(--muted)', marginTop: 8 }}>{BOARDUP_FORMULA_NOTE}</div>
      <Field label="Other opening information" htmlFor="bu-otheropen">
        <TextField
          id="bu-otheropen"
          style={{ maxWidth: 320 }}
          enterKeyHint="next"
          value={f.otherOpenings}
          disabled={disabled}
          onChange={(e) => set('otherOpenings', e.target.value)}
          placeholder="e.g. 2nd-floor dormers"
        />
      </Field>
      {/* Estimate header — flat-rate cover, kept separate from the measured total below */}
      <div className="bu-estimate">
        <div className="bu-estimate-label">PLYWOOD SHEETS EST.</div>
        <div className="bu-estimate-big" aria-live="polite">
          {est.sheets}
        </div>
        <div className="bu-estimate-sub">
          SQ FT COVER: <strong>{est.sqftCover}</strong> · 4×8 SHEETS: <strong>{est.sheets}</strong>
        </div>
      </div>
        <div className="bu-grandtotal" aria-live="polite">
          <div className="bu-grandtotal-title">Measurement grand total</div>
          <div className="bu-grandtotal-note">
            Every W × H pair is rounded up to a whole square inch, then added.
          </div>
          <div className="bu-grandtotal-line">
            <strong>{measured.sqIn} sq in</strong>
          </div>
          <div className="bu-grandtotal-line">
            <strong>{measured.sqFt.toFixed(2)} sq ft</strong>
          </div>
        </div>
        {cutList.sheets.length > 0 && (
          <div className="bu-grandtotal" aria-live="polite" style={{ marginTop: 12 }}>
            <div className="bu-grandtotal-title">Cut list — {cutList.sheets.length} sheet{cutList.sheets.length === 1 ? '' : 's'} (nested)</div>
            <div className="bu-grandtotal-note">
              Pieces are nested into leftover sheet space and may be turned either way. Flat-rate sheets estimate above is unchanged.
            </div>
            {cutList.oversized.length > 0 && (
              <div style={{ marginTop: 6, fontSize: 13 }}>
                Oversized: {cutList.oversized.map((o) => `${o.label} ${o.size} → ${o.partCount} parts`).join('; ')}
              </div>
            )}
            {cutList.sheets.map((sheet, si) => (
              <div key={si} style={{ marginTop: 6, fontSize: 13 }}>
                <strong>Sheet {si + 1}:</strong>{' '}
                {sheet.map((p) => `${p.label}${p.partCount > 1 ? ` (part ${p.part})` : ''} ${p.w}x${p.h}`).join(', ')}
              </div>
            ))}
          </div>
        )}
      </section>
      <section className="bu-section">
        <div className="bu-section-head">
          <div>
            <h2>Locks &amp; hardware</h2>
            <p>Each item gets its own combination field.</p>
          </div>
          <span className="bu-section-num">04</span>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          <OpeningCounter
            id="bu-hasp" label="Hasp & Lock" singular="Hasp & Lock" count={f.haspLocks}
            measurements={f.haspLockCombos} placeholder="e.g. 32 35 76" disabled={disabled}
            itemCaption="Combination — one per lock"
            onCount={(v) => setOpeningCount('haspLocks', 'haspLockCombos', v)}
            onMeasurement={(i, v) => setMeasurement('haspLockCombos', i, v)}
          />
          <OpeningCounter
            id="bu-chain" label="Lock and Chain" singular="Lock and Chain" count={f.chainLocks}
            measurements={f.chainLockCombos} placeholder="e.g. 32 35 76" disabled={disabled}
            itemCaption="Combination — one per lock"
            onCount={(v) => setOpeningCount('chainLocks', 'chainLockCombos', v)}
            onMeasurement={(i, v) => setMeasurement('chainLockCombos', i, v)}
          />
        </div>
        <div className="bu-two-by-fours">
          <h3>Two by Fours</h3>
          <p className="hint" style={{ marginTop: 0 }}>
            Size, quantity, and lineal feet for each line.
          </p>
          {f.twoByFours.map((line, i) => (
            <div key={i} className="bu-two-by-four-line">
              <div className="bu-two-by-four-head">
                <span>Two by Fours {i + 1}</span>
                {!disabled && (
                  <button type="button" aria-label={`Remove two by fours line ${i + 1}`} onClick={() => removeTwoByFour(i)}>
                    ×
                  </button>
                )}
              </div>
              <Field label={`Two by Fours ${i + 1} size`} htmlFor={`bu-tbf-size-${i}`}>
                <SelectField
                  id={`bu-tbf-size-${i}`}
                  value={line.size}
                  disabled={disabled}
                  onChange={(e) => updateTwoByFour(i, { size: e.target.value })}
                >
                  {TWO_BY_FOUR_SIZES.map((s) => (
                    <option key={s} value={s}>
                      {s}
                    </option>
                  ))}
                </SelectField>
              </Field>
              {line.size === 'Custom' && (
                <Field label={`Two by Fours ${i + 1} custom lineal feet each`} htmlFor={`bu-tbf-feet-${i}`}>
                  <TextField
                    id={`bu-tbf-feet-${i}`}
                    value={line.customLinealFeet}
                    disabled={disabled}
                    onChange={(e) => updateTwoByFour(i, { customLinealFeet: e.target.value })}
                    placeholder="Lineal feet each – e.g. 12"
                    inputMode="decimal"
                  />
                </Field>
              )}
              <Field label={`Two by Fours ${i + 1} quantity`} htmlFor={`bu-tbf-qty-${i}`}>
                <SelectField
                  id={`bu-tbf-qty-${i}`}
                  value={String(line.quantity)}
                  disabled={disabled}
                  onChange={(e) => updateTwoByFour(i, { quantity: parseInt(e.target.value, 10) || 1 })}
                >
                  {Array.from({ length: 30 }, (_, n) => n + 1).map((n) => (
                    <option key={n} value={String(n)}>
                      {n}
                    </option>
                  ))}
                </SelectField>
              </Field>
            </div>
          ))}
          {!disabled && (
            <Button variant="secondary" onClick={addTwoByFour}>
              Add two by fours
            </Button>
          )}
          {f.twoByFours.length > 0 && (
            <div className="bu-two-by-four-totals" aria-live="polite">
              {twoByFourTotalsValue.linealFeet === null
                ? `Total quantity: ${twoByFourTotalsValue.quantity} · Lineal feet not recorded for a custom line`
                : `Total quantity: ${twoByFourTotalsValue.quantity} · Total lineal feet: ${twoByFourTotalsValue.linealFeet}`}
            </div>
          )}
          <p className="hint">Separate from openings and not included in the opening total.</p>
        </div>
      </section>
      {/* Photos — plain mobile file input (image accept), NOT the timesheet attach pattern */}
      <section className="bu-section">
        <div className="bu-section-head">
          <div>
            <h2>Photos{photos.length > 0 && ` (${photos.length})`}</h2>
            <p>Add the job photos Dan needs for the record.</p>
          </div>
          <span className="bu-section-num">05</span>
        </div>
        {photos.length > 0 && (
          <>
            {!disabled && (
              <div
                style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 10, flexWrap: 'wrap' }}
              >
                <span className="hint" style={{ margin: 0 }}>
                  Set all photo times:
                </span>
                <input
                  type="datetime-local"
                  aria-label="Set all photo times"
                  value={bulkPhotoTime}
                  onChange={(e) => setBulkPhotoTime(e.target.value)}
                  style={{ fontSize: 13 }}
                />
                <Button variant="secondary" size="sm" onClick={applyBulkPhotoTime} disabled={!bulkPhotoTime}>
                  Apply to all
                </Button>
              </div>
            )}
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 10 }}>
              {photos.map((p) => (
                <div key={p.path} style={{ width: 112 }}>
                  <div style={{ position: 'relative', width: 96, height: 96 }}>
                    <img
                      src={p.thumbUrl || p.url}
                      alt="Job photo"
                      style={{ width: 96, height: 96, objectFit: 'cover', borderRadius: 8, border: '1px solid #ddd' }}
                    />
                    {!disabled && (
                      <button
                        type="button"
                        aria-label="Remove photo"
                        onClick={() => void removePhoto(p.path)}
                        style={{
                          position: 'absolute',
                          top: -8,
                          right: -8,
                          width: 26,
                          height: 26,
                          borderRadius: '50%',
                          border: '1px solid #ccc',
                          background: '#fff',
                          fontSize: 15,
                          lineHeight: 1,
                          cursor: 'pointer',
                        }}
                      >
                        ×
                      </button>
                    )}
                  </div>
                  {!disabled ? (
                    <input
                      type="datetime-local"
                      aria-label="Photo taken time"
                      title="When this photo was taken — tap to correct it"
                      value={exifRawToInput(f.photoTakenAt?.[p.path])}
                      onChange={(e) => setPhotoTakenAt(p.path, inputToExifRaw(e.target.value))}
                      style={{ width: 112, fontSize: 11, marginTop: 4, padding: '2px 1px' }}
                    />
                  ) : (
                    <div style={{ fontSize: 11, marginTop: 4, color: '#555' }}>
                      {formatPhotoDateTime(f.photoTakenAt?.[p.path])}
                    </div>
                  )}
                </div>
              ))}
            </div>
          </>
        )}
        <div className="bu-photo-note">
          <div>Photo Options</div>
          <p>Take a new picture or choose one or more from your camera roll.</p>
          <p>Photos are compressed before the job file is made.</p>
          {photos.length === 0 && <p>No photos added.</p>}
        </div>
        {!disabled && (
          <>
            <input
              ref={fileRef}
              id="bu-photos-input"
              type="file"
              accept="image/*"
              multiple
              style={{ display: 'none' }}
              onChange={(e) => void onFiles(e.target.files)}
            />
            <Button id="bu-addphotos" variant="secondary" disabled={photoBusy} onClick={() => fileRef.current?.click()}>
              {photoBusy ? 'Uploading…' : 'Add photos'}
            </Button>
          </>
        )}
        {photoError && (
          <div style={{ marginTop: 8 }}>
            <Alert kind="error">{photoError}</Alert>
          </div>
        )}
      </section>
      <section className="bu-section">
        <div className="bu-section-head">
          <div>
            <h2>Send to</h2>
            <p>Who this job goes to when you send it.</p>
          </div>
        </div>
      <Field label="Email to" htmlFor="bu-emailto" error={fieldError('emailTo')}>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
          <SelectField
            id="bu-emailto"
            style={{ maxWidth: 320 }}
            value={emailIsCustom || !f.emailTo.trim() ? '__custom' : f.emailTo.trim()}
            disabled={disabled}
            onChange={(e) => {
              const v = e.target.value;
              // Picking "type a different address" clears the field so the
              // custom input stays open instead of snapping back to Dan.
              set('emailTo', v === '__custom' ? '' : v);
            }}
          >
            {crewEmails.map((e) => (
              <option key={e.email} value={e.email}>
                {e.name} — {e.email}
              </option>
            ))}
            <option value="__custom">Type a different address…</option>
          </SelectField>
          {canManageCrew && !disabled && (
            <Button variant="secondary" size="sm" onClick={openCrewEditor}>
              Edit crew
            </Button>
          )}
        </div>
        {(emailIsCustom || !f.emailTo.trim()) && (
          <TextField
            id="bu-emailto-custom"
            style={{ maxWidth: 320, marginTop: 6 }}
            enterKeyHint="next"
            inputMode="email"
            value={f.emailTo}
            disabled={disabled}
            onChange={(e) => set('emailTo', e.target.value)}
            placeholder="dispatch@example.com"
            aria-label="Custom email address"
          />
        )}
      </Field>

      <Field label="Text to — phone (optional)" htmlFor="bu-textto" error={fieldError('textTo')} hint={PHONE_HINT}>
        <TextField
          id="bu-textto"
          style={{ maxWidth: 200 }}
          enterKeyHint="done"
          inputMode="tel"
          value={f.textTo}
          disabled={disabled}
          onChange={(e) => set('textTo', e.target.value)}
          onBlur={() => blurPhone('textTo')}
          placeholder="(954) 555-0123"
        />
      </Field>

      </section>

      {shareError && (
        <div style={{ marginBottom: 12 }}>
          <Alert kind="error">{shareError}</Alert>
        </div>
      )}

      <div className="bu-sticky">
        <div className="bu-sticky-head">
          <div>Ready when the job is complete</div>
          <p>Send the job by email or text, or save it as a PDF.</p>
        </div>
        <Button id="bu-emailjob" variant="secondary" onClick={emailJob} disabled={shareBusy !== null}>
          Email job text
        </Button>
        <Button id="bu-textjob" variant="secondary" onClick={textJob} disabled={shareBusy !== null}>
          Text this job
        </Button>
        <Button id="bu-condensed" variant="secondary" onClick={saveCondensedPdf} disabled={shareBusy !== null}>
          {shareBusy === 'condensed' ? 'Building…' : 'Save PDF'}
        </Button>
        <Button id="bu-pictures" variant="secondary" onClick={savePicturesPdf} disabled={shareBusy !== null}>
          {shareBusy === 'pictures' ? 'Building…' : 'Pictures PDF'}
        </Button>
        <Button id="bu-emailpdf" variant="secondary" onClick={emailPdf} disabled={shareBusy !== null}>
          {shareBusy === 'emailpdf' ? 'Sending…' : 'Email job PDF'}
        </Button>
        {isOwner && (
          <Button id="bu-deletejob" variant="danger" onClick={deleteJob} disabled={shareBusy !== null}>
            {shareBusy === 'delete' ? 'Deleting…' : 'Delete job'}
          </Button>
        )}
      </div>
      {shareDone && (
        <div style={{ marginBottom: 12, color: '#15803d', fontSize: 14, fontWeight: 600 }}>
          {shareDone}
        </div>
      )}
    </div>
  );
});

export default BoardUpForm;
