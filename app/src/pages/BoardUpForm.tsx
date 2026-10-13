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
  buildBoardUpSummary,
  estimateBoardUp,
  loadCustomCities,
  rememberCustomCity,
  withCustomCities,
  type BoardUpDetails,
} from '../lib/boardup';
import { boardUpPhotoUrl, removeBoardUpPhoto, uploadBoardUpPhoto } from '../data/attachments';

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

/**
 * Board-up job sheet form. Mirrors the standalone Quick Board-Up intake app:
 * same fields in the same order, live material estimates, photo capture,
 * and Email-this-job / Text-this-job actions.
 */
const BoardUpForm = forwardRef<BoardUpFormHandle, Props>(function BoardUpForm(
  { initial, workspaceId, businessId, jobNumber, disabled, getDraftId, ensureDraft, onChange, onPhotosCommitted, onPhotosChange },
  ref,
) {
  const [f, setF] = useState<BoardUpDetails>(() => asBoardUpDetails(initial));
  const [invalidFields, setInvalidFields] = useState<Set<string>>(new Set());
  const [photos, setPhotos] = useState<PhotoItem[]>([]);
  const [photoBusy, setPhotoBusy] = useState(false);
  const [photoError, setPhotoError] = useState<string | null>(null);
  const [shareError, setShareError] = useState<string | null>(null);
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
    });
    setInvalidFields((prev) => {
      if (!prev.has(key as string)) return prev;
      const next = new Set(prev);
      next.delete(key as string);
      return next;
    });
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

  // Resolve view URLs for photos already stored on the job.
  useEffect(() => {
    let cancelled = false;
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
    const body = buildBoardUpSummary(d, jobNumber);
    const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent);
    window.location.href = `sms:${num}${isIOS ? '&body=' : '?body='}${encodeURIComponent(body)}`;
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
          type="datetime-local"
          value={f.neededBy}
          disabled={disabled}
          onChange={(e) => set('neededBy', e.target.value)}
        />
      </Field>

      <div className="card" style={{ marginBottom: 16 }}>
        <h3 style={{ marginTop: 0, marginBottom: 4 }}>Openings</h3>
        <Stepper id="bu-win" label="Windows" value={f.windows} disabled={disabled} onChange={(v) => set('windows', v)} />
        <Stepper id="bu-door" label="Doors" value={f.doors} disabled={disabled} onChange={(v) => set('doors', v)} />
        <Stepper id="bu-slider" label="Sliders / patios" value={f.sliders} disabled={disabled} onChange={(v) => set('sliders', v)} />
        <Stepper
          id="bu-gar"
          label="Garage doors"
          value={f.garageDoors}
          disabled={disabled}
          onChange={(v) => set('garageDoors', v)}
        />
        <div style={{ fontSize: 13, color: 'var(--muted)', marginTop: 8 }}>{BOARDUP_FORMULA_NOTE}</div>
      </div>

      <Field label="Other opening information" htmlFor="bu-otheropen">
        <TextField
          id="bu-otheropen"
          enterKeyHint="next"
          value={f.otherOpenings}
          disabled={disabled}
          onChange={(e) => set('otherOpenings', e.target.value)}
          placeholder="e.g. 2nd-floor dormers"
        />
      </Field>

      <Field label="Crew" htmlFor="bu-crew">
        <SelectField id="bu-crew" value={f.crew} disabled={disabled} onChange={(e) => set('crew', e.target.value)}>
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
        <Button id="bu-emailjob" variant="secondary" onClick={emailJob}>
          Email this job
        </Button>
        <Button id="bu-textjob" variant="secondary" onClick={textJob}>
          Text this job
        </Button>
      </div>
    </div>
  );
});

export default BoardUpForm;
