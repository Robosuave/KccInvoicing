import type { Business } from '../db/types';
import {
  BOARDUP_FORMULA_NOTE,
  asBoardUpDetails,
  estimateBoardUp,
  type BoardUpDetails,
} from '../lib/boardup';
import type { BoardUpPhoto } from './BoardUpForm';

function Row({ label, value }: { label: string; value: string }) {
  if (!value) return null;
  return (
    <div style={{ display: 'flex', gap: 8, marginBottom: 3, fontSize: 14 }}>
      <strong style={{ minWidth: 170 }}>{label}:</strong>
      <span style={{ whiteSpace: 'pre-wrap' }}>{value}</span>
    </div>
  );
}

/**
 * Board-up job sheet rendering for the editor preview and browser print
 * (window.print prints the .invoice-preview block). Photos render from the
 * signed URLs the form resolved.
 */
export default function BoardUpPreviewBody({
  business,
  details,
  photos,
  jobNumber,
  invoiceDate,
  invoiceStatus,
  logoUrl,
}: {
  business: Business;
  details: BoardUpDetails;
  photos: BoardUpPhoto[];
  jobNumber: string | null;
  invoiceDate: string;
  invoiceStatus: 'draft' | 'issued' | 'void';
  logoUrl: string | null;
}) {
  const d = asBoardUpDetails(details);
  const est = estimateBoardUp(d.windows, d.doors, d.sliders, d.garageDoors);
  return (
    <div className="invoice-preview" aria-label="Board-up job preview">
      <div className="inv-head">
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', textAlign: 'center', gap: 10 }}>
          {logoUrl && (
            <img
              src={logoUrl}
              alt={`${business.display_name} logo`}
              className="inv-logo"
              style={{ height: 72, width: 'auto', maxWidth: 260, objectFit: 'contain' }}
            />
          )}
          <div>
            <h2 style={{ margin: 0 }}>{business.display_name}</h2>
            <div style={{ color: 'var(--muted)', fontSize: 13 }}>
              {[business.address_line1, business.address_line2].filter(Boolean).join(', ')}
              <br />
              {[business.city, business.state, business.zip].filter(Boolean).join(', ')}
              {business.phone && (
                <>
                  <br />
                  {business.phone}
                </>
              )}
              {business.email && (
                <>
                  <br />
                  {business.email}
                </>
              )}
            </div>
          </div>
        </div>
        <div style={{ textAlign: 'right' }}>
          <div className="inv-title" style={{ fontSize: 26, fontWeight: 800, letterSpacing: 2 }}>
            BOARD-UP JOB
          </div>
          {jobNumber && <div style={{ fontSize: 15, fontWeight: 700 }}>#{jobNumber}</div>}
          {invoiceStatus === 'draft' && <span className="badge badge-draft">DRAFT</span>}
          <div className="inv-date-line" style={{ fontSize: 20, fontWeight: 700, marginTop: 8 }}>
            Date: {invoiceDate || '—'}
          </div>
        </div>
      </div>

      <Row label="City" value={d.cityName} />
      {d.otherCustomerName && <Row label="Customer" value={d.otherCustomerName} />}
      <Row label="Street address" value={d.streetAddress + (d.city ? `, ${d.city}` : '')} />
      {d.phone && <Row label="Phone" value={d.phone} />}
      {d.caseNumber && <Row label="Case number" value={d.caseNumber} />}
      {d.requestingOfficer && <Row label="Requesting officer" value={d.requestingOfficer} />}
      <Row label="Type" value={d.propertyType} />
      <Row label="Service needed" value={d.serviceNeeded} />
      <Row label="Urgency" value={d.urgency + (d.neededBy ? ` (needed by ${d.neededBy.replace('T', ' ')})` : '')} />

      <div style={{ marginTop: 10, marginBottom: 6 }}>
        <strong style={{ fontSize: 15 }}>Openings &amp; material estimate</strong>
      </div>
      <div style={{ display: 'flex', gap: 24, flexWrap: 'wrap', fontSize: 14, marginBottom: 6 }}>
        <span>
          Windows: <strong>{d.windows}</strong>
        </span>
        <span>
          Doors: <strong>{d.doors}</strong>
        </span>
        <span>
          Sliders / patios: <strong>{d.sliders}</strong>
        </span>
        <span>
          Garage doors: <strong>{d.garageDoors}</strong>
        </span>
      </div>
      <div
        style={{
          background: '#eff6ff',
          border: '1px solid #bfdbfe',
          borderRadius: 8,
          padding: '8px 12px',
          marginBottom: 8,
          fontSize: 15,
        }}
      >
        <strong>{est.sheets} PLYWOOD SHEETS EST.</strong>
        <span style={{ marginLeft: 12 }}>
          SQ FT COVER: <strong>{est.sqftCover}</strong> · 4×8 SHEETS: <strong>{est.sheets}</strong>
        </span>
      </div>
      <div style={{ fontSize: 12, color: 'var(--muted)', marginBottom: 8 }}>{BOARDUP_FORMULA_NOTE}</div>

      {d.otherOpenings && <Row label="Other openings" value={d.otherOpenings} />}
      <Row label="Crew" value={d.crew + (d.additionalCrew ? ` + ${d.additionalCrew}` : '')} />
      {d.accessNotes && <Row label="Access / hazards" value={d.accessNotes} />}

      {photos.length > 0 && (
        <div style={{ marginTop: 12 }}>
          <strong style={{ fontSize: 15 }}>Photos ({photos.length})</strong>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginTop: 6 }}>
            {photos.map((p) => (
              <img
                key={p.path}
                src={p.url}
                alt="Job photo"
                style={{ width: 220, height: 165, objectFit: 'cover', borderRadius: 6, border: '1px solid #ddd' }}
              />
            ))}
          </div>
        </div>
      )}

      <div className="inv-footer" style={{ marginTop: 24, textAlign: 'center', color: 'var(--muted)', fontSize: 13 }}>
        Board-Up Job Sheet | {business.display_name}
      </div>
    </div>
  );
}
