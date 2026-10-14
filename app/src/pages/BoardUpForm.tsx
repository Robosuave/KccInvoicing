import { forwardRef, useEffect, useImperativeHandle, useMemo, useRef, useState } from 'react';
import { Alert, Button, Field, SelectField, TextArea, TextField } from '../components/ui';
import { digitsOnly, formatPhone, isValidPhone, PHONE_HINT } from '../lib/phone';
import {
  BOARDUP_CUSTOM_CITIES_KEY,
  BOARDUP_CUSTOM_CITY_NAMES_KEY,
  BOARDUP_FORMULA_NOTE,
  CREW_OPTIONS,
  CITY_NAME_OPTIONS,
  CITY_OPTIONS,
  PROPERTY_TYPE_OPTIONS,
  SERVICE_NEEDED_OPTIONS,
  URGENCY_OPTIONS,
  asBoardUpDetails,
  boardUpPdfFilename,
  boardUpPhotoCaption,
  buildBoardUpSmsText,
  buildBoardUpSummary,
  syncMeasurementCount,
  estimateBoardUp,
  loadCustomCities,
  rememberCustomCity,
  withCustomCities,
  type BoardUpDetails,
} from '../lib/boardup';
import { boardUpPhotoUrl, removeBoardUpPhoto, uploadBoardUpPhoto } from '../data/attachments';
import { deleteInvoiceDeep } from '../data/invoices';
import { buildBoardUpShareSnapshot } from '../lib/snapshot';
import { canShareFiles, shareFiles, urlToFile } from '../lib/share';
import { renderInvoicePdfBlob } from '../pdf/service';
import type { Business } from '../db/types';

export interface BoardUpFormHandle {
  validate: () => { errors: string[]; invalid: string[] };
}

interface PhotoItem {
  path: string;
  url: string;
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
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginTop: 4 }}>
        <Button
          id={`${id}-minus`}
          variant="secondary"
          disabled={disabled}
          aria-label={`Fewer ${label}`}
          onClick={() => onChange(Math.max(0, value - 1))}
        >
          −
        </Button>
        <span
          role="status"
          aria-live="polite"
          aria-labelledby={`${id}-label`}
          style={{ minWidth: 44, textAlign: 'center', fontSize: 20, fontWeight: 800 }}
        >
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

type MeasurementKey = 'windowMeasurements' | 'doorMeasurements' | 'sliderMeasurements' | 'garageMeasurements';

/** Stepper plus one measurement box per counted opening, matching the source app. */
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
}) {
  return (
    <div>
      <Stepper id={id} label={label} value={count} disabled={disabled} onChange={onCount} />
      {count > 0 && (
        <div style={{ marginTop: 8 }}>
          <div style={{ fontSize: 12, color: 'var(--muted)', marginBottom: 4 }}>
            Measurements — one per {label.toLowerCase()}
          </div>
          {measurements.map((m, i) => (
            <Field key={i} label={`${singular} ${i + 1}`} htmlFor={`${id}-m${i}`}>
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
  { initial, workspaceId, businessId, jobNumber, disabled, getDraftId, ensureDraft, onChange, onPhotosCommitted, onPhotosChange, business, invoiceDate, isOwner, onDeleted },
  ref,
) {
  const [f, setF] = useState<BoardUpDetails>(() => asBoardUpDetails(initial));
  const [invalidFields, setInvalidFields] = useState<Set<string>>(new Set());
  const [photos, setPhotos] = useState<PhotoItem[]>([]);
  const [photoBusy, setPhotoBusy] = useState(false);
  const [photoError, setPhotoError] = useState<string | null>(null);
  const [shareError, setShareError] = useState<string | null>(null);
  const [smsCopied, setSmsCopied] = useState(false);
  /** Which file-share action is currently preparing its files. */
  const [shareBusy, setShareBusy] = useState<'pdf' | 'photos' | 'condensed' | 'delete' | null>(null);
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

  const setPhotosAndNotify = (next: PhotoItem[]) => {
    setPhotos(next);
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
    countKey: 'windows' | 'doors' | 'sliders' | 'garageDoors',
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
          items.push({ path, url: await boardUpPhotoUrl(path) });
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
    () => estimateBoardUp(f.windows, f.doors, f.sliders, f.garageDoors),
    [f.windows, f.doors, f.sliders, f.garageDoors],
  );

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
      for (const file of valid) {
        const path = await uploadBoardUpPhoto(workspaceId, businessId, id, file);
        const url = await boardUpPhotoUrl(path);
        next.push({ path, url });
      }
      setPhotosAndNotify(next);
      const paths = next.map((p) => p.path);
      const d = { ...detailsRef.current, photos: paths };
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
    const d = { ...detailsRef.current, photos: paths };
    detailsRef.current = d;
    setF(d);
    onChange(d);
    onPhotosCommitted?.(d);
  };

  const emailJob = () => {
    setShareError(null);
    const d = details();
    const subject = `Board-up job${jobNumber ? ` #${jobNumber}` : ''} — ${d.streetAddress || 'new job'}`;
    const body = buildBoardUpSummary(d, jobNumber);
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
    const body = buildBoardUpSmsText(d);
    const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent);
    window.location.href = `sms:${num}${isIOS ? '&body=' : '?body='}${encodeURIComponent(body)}`;
  };

  const copySmsText = async () => {
    setShareError(null);
    setSmsCopied(false);
    const body = buildBoardUpSmsText(details());
    try {
      await navigator.clipboard.writeText(body);
      setSmsCopied(true);
    } catch {
      setShareError('Could not copy — the browser blocked clipboard access.');
    }
  };

  /** Renders the job sheet PDF from live form state (draft or issued). */
  const renderSharePdf = async (photosOnly = false, includePhotos = true): Promise<Blob> => {
    const snap = buildBoardUpShareSnapshot({
      business,
      details: detailsRef.current as unknown as Record<string, unknown>,
      jobNumber,
      invoiceDate,
    });
    return renderInvoicePdfBlob(snap, 'classic', 'LETTER', photosOnly, includePhotos);
  };

  /** Text + PDFs: shares the job-information PDF and the pictures PDF separately, like the original. */
  const textJobWithPdf = async () => {
    if (shareBusy) return;
    setShareError(null);
    setShareBusy('pdf');
    try {
      const d = details();
      const infoBlob = await renderSharePdf(false, false);
      const files = [new File([infoBlob], boardUpPdfFilename(d, invoiceDate, 'job information'), { type: 'application/pdf' })];
      if (d.photos.length > 0) {
        const photosBlob = await renderSharePdf(true, true);
        files.push(new File([photosBlob], boardUpPdfFilename(d, invoiceDate, 'photos'), { type: 'application/pdf' }));
      }
      if (!canShareFiles(files)) {
        setShareError('This browser can’t share files — use Print / Save PDF instead.');
        return;
      }
      await shareFiles({
        files,
        title: `Board-up job${jobNumber ? ` ${jobNumber}` : ''}`,
        text: buildBoardUpSmsText(d),
      });
    } catch (e) {
      setShareError(e instanceof Error ? e.message : 'Could not prepare the PDFs.');
    } finally {
      setShareBusy(null);
    }
  };

  /** Share photos: opens the native share sheet with the job photos attached. */
  const shareJobPhotos = async () => {
    if (shareBusy) return;
    setShareError(null);
    const items = photosRef.current;
    if (items.length === 0) {
      setShareError('No photos to share yet — add photos first.');
      return;
    }
    setShareBusy('photos');
    try {
      const files: File[] = [];
      for (let i = 0; i < items.length; i++) {
        files.push(await urlToFile(items[i].url, `job-photo-${i + 1}.jpg`, 'image/jpeg'));
      }
      if (!canShareFiles(files)) {
        setShareError('This browser can’t share files.');
        return;
      }
      await shareFiles({ files, title: 'Job photos', text: boardUpPhotoCaption(details()) });
    } catch (e) {
      setShareError(e instanceof Error ? e.message : 'Could not share the photos.');
    } finally {
      setShareBusy(null);
    }
  };

  /** Save condensed PDF: job summary + photos (4 per page, address captions), downloaded as a file. */
  const saveCondensedPdf = async () => {
    if (shareBusy) return;
    setShareError(null);
    setShareBusy('condensed');
    try {
      const blob = await renderSharePdf(false, true);
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

  /** Email PDF: shares the combined job PDF (summary + photos, 4 per page with address
   * captions) with the full job summary as the message. Opens the native share sheet
   * so the PDF can be sent through Gmail; falls back to a download + email draft. */
  const emailPdf = async () => {
    if (shareBusy) return;
    setShareError(null);
    setShareBusy('condensed');
    try {
      const d = details();
      const blob = await renderSharePdf(false, true);
      const name = boardUpPdfFilename(d, invoiceDate, 'condensed');
      const file = new File([blob], name, { type: 'application/pdf' });
      const subject = `Board-up job${jobNumber ? ` #${jobNumber}` : ''} — ${d.streetAddress || 'new job'}`;
      const body = buildBoardUpSummary(d, jobNumber);
      if (canShareFiles([file])) {
        await shareFiles({ files: [file], title: subject, text: body });
        return;
      }
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = name;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 5000);
      setShareError('This browser can’t share files — the PDF downloaded. Attach it to the email draft.');
      window.location.href = `mailto:${encodeURIComponent(d.emailTo.trim())}?subject=${encodeURIComponent(
        subject,
      )}&body=${encodeURIComponent(body)}`;
    } catch (e) {
      setShareError(e instanceof Error ? e.message : 'Could not build the PDF.');
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

  return (
    <div onKeyDown={enterToNext}>
      {/* Estimate header */}
      <div
        style={{
          background: '#eff6ff',
          border: '1px solid #bfdbfe',
          borderRadius: 10,
          padding: '12px 14px',
          marginBottom: 16,
          textAlign: 'center',
        }}
      >
        <div style={{ fontSize: 13, fontWeight: 700, letterSpacing: 1, color: '#1d4ed8' }}>PLYWOOD SHEETS EST.</div>
        <div style={{ fontSize: 34, fontWeight: 800, color: '#1e3a8a' }} aria-live="polite">
          {est.sheets}
        </div>
        <div style={{ fontSize: 13, color: '#374151' }}>
          SQ FT COVER: <strong>{est.sqftCover}</strong> · 4×8 SHEETS: <strong>{est.sheets}</strong>
        </div>
      </div>

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

      <div className="field">
        <span style={{ fontWeight: 600, fontSize: 14 }} id="bu-urgency-label">
          Urgency
        </span>
        <div role="radiogroup" aria-labelledby="bu-urgency-label" style={{ display: 'flex', flexWrap: 'wrap', gap: 12, marginTop: 6 }}>
          {URGENCY_OPTIONS.map((o, i) => (
            <label key={o} style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 15 }}>
              <input
                type="radio"
                name="bu-urgency"
                id={`bu-urg-${i}`}
                checked={f.urgency === o}
                disabled={disabled}
                onChange={() => set('urgency', o)}
              />
              {o}
            </label>
          ))}
        </div>
      </div>

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

      <div className="card" style={{ marginBottom: 16 }}>
        <h3 style={{ marginTop: 0, marginBottom: 4 }}>Openings</h3>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '4px 16px' }}>
          <OpeningCounter
            id="bu-win" label="Windows" singular="Window" count={f.windows}
            measurements={f.windowMeasurements} placeholder="e.g. 36x45" disabled={disabled}
            onCount={(v) => setOpeningCount('windows', 'windowMeasurements', v)}
            onMeasurement={(i, v) => setMeasurement('windowMeasurements', i, v)}
          />
          <OpeningCounter
            id="bu-door" label="Doors" singular="Door" count={f.doors}
            measurements={f.doorMeasurements} placeholder="e.g. 38x81" disabled={disabled}
            onCount={(v) => setOpeningCount('doors', 'doorMeasurements', v)}
            onMeasurement={(i, v) => setMeasurement('doorMeasurements', i, v)}
          />
          <OpeningCounter
            id="bu-slider" label="Sliders / patios" singular="Slider" count={f.sliders}
            measurements={f.sliderMeasurements} placeholder="e.g. 72x80" disabled={disabled}
            onCount={(v) => setOpeningCount('sliders', 'sliderMeasurements', v)}
            onMeasurement={(i, v) => setMeasurement('sliderMeasurements', i, v)}
          />
          <OpeningCounter
            id="bu-gar" label="Garage doors" singular="Garage door" count={f.garageDoors}
            measurements={f.garageMeasurements} placeholder="e.g. 96x84" disabled={disabled}
            onCount={(v) => setOpeningCount('garageDoors', 'garageMeasurements', v)}
            onMeasurement={(i, v) => setMeasurement('garageMeasurements', i, v)}
          />
        </div>
        <div style={{ fontSize: 13, color: 'var(--muted)', marginTop: 8 }}>{BOARDUP_FORMULA_NOTE}</div>
      </div>

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

      <Field label="Crew" htmlFor="bu-crew">
        <SelectField id="bu-crew" style={{ maxWidth: 190 }} value={f.crew} disabled={disabled} onChange={(e) => set('crew', e.target.value)}>
          {CREW_OPTIONS.map((o) => (
            <option key={o} value={o}>
              {o}
            </option>
          ))}
        </SelectField>
      </Field>

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

      {/* Photos — plain mobile file input (image accept), NOT the timesheet attach pattern */}
      <div className="card" style={{ marginBottom: 16 }}>
        <h3 style={{ marginTop: 0, marginBottom: 8 }}>
          Photos{photos.length > 0 && ` (${photos.length})`}
        </h3>
        {photos.length > 0 && (
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 10 }}>
            {photos.map((p) => (
              <div key={p.path} style={{ position: 'relative', width: 96, height: 96 }}>
                <img
                  src={p.url}
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
            ))}
          </div>
        )}
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
      </div>

      <Field label="Email to (optional)" htmlFor="bu-emailto" error={fieldError('emailTo')}>
        <TextField
          id="bu-emailto"
          style={{ maxWidth: 320 }}
          enterKeyHint="next"
          inputMode="email"
          value={f.emailTo}
          disabled={disabled}
          onChange={(e) => set('emailTo', e.target.value)}
          placeholder="dispatch@example.com"
        />
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

      {shareError && (
        <div style={{ marginBottom: 12 }}>
          <Alert kind="error">{shareError}</Alert>
        </div>
      )}

      <div className="btn-row" style={{ marginBottom: 8 }}>
        <Button id="bu-emailjob" variant="secondary" onClick={emailJob} disabled={shareBusy !== null}>
          Email this job
        </Button>
        <Button id="bu-textjob" variant="secondary" onClick={textJob} disabled={shareBusy !== null}>
          Text this job
        </Button>
        <Button id="bu-textpdf" variant="secondary" onClick={textJobWithPdf} disabled={shareBusy !== null}>
          {shareBusy === 'pdf' ? 'Preparing…' : 'Text + PDFs'}
        </Button>
        <Button id="bu-sharephotos" variant="secondary" onClick={shareJobPhotos} disabled={shareBusy !== null}>
          {shareBusy === 'photos' ? 'Preparing…' : 'Share photos'}
        </Button>
        <Button id="bu-copysms" variant="secondary" onClick={copySmsText} disabled={shareBusy !== null}>
          Copy SMS text
        </Button>
        <Button id="bu-condensed" variant="secondary" onClick={saveCondensedPdf} disabled={shareBusy !== null}>
          {shareBusy === 'condensed' ? 'Building…' : 'Save condensed PDF'}
        </Button>
        <Button id="bu-emailpdf" variant="secondary" onClick={emailPdf} disabled={shareBusy !== null}>
          {shareBusy === 'condensed' ? 'Preparing…' : 'Email PDF'}
        </Button>
        {isOwner && (
          <Button id="bu-deletejob" variant="danger" onClick={deleteJob} disabled={shareBusy !== null}>
            {shareBusy === 'delete' ? 'Deleting…' : 'Delete job'}
          </Button>
        )}
      </div>
      {smsCopied && (
        <div style={{ marginBottom: 12, color: '#15803d', fontSize: 14, fontWeight: 600 }}>
          Copied — paste it into your text message.
        </div>
      )}
    </div>
  );
});

export default BoardUpForm;
