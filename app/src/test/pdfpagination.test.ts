import { describe, expect, it } from 'vitest';
import { pdf } from '@react-pdf/renderer';
import { InvoicePdf, boardUpTimeline } from '../pdf/InvoicePdf';
import { buildBoardUpShareSnapshot } from '../lib/snapshot';
import { EMPTY_BOARDUP } from '../lib/boardup';

/** 1x1 PNG data URL — stands in for a compressed job photo. */
const PIXEL =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';

function boardUpSnapshot() {
  return buildBoardUpShareSnapshot({
    business: {
      display_name: 'Aquick Board-up',
      legal_name: null,
      header_line: null,
      logo_path: null,
      address_line1: null,
      address_line2: null,
      city: null,
      state: null,
      zip: null,
      phone: null,
      email: null,
      website: null,
      tax_id: null,
    },
    details: { ...EMPTY_BOARDUP, streetAddress: '123 Main St', city: 'Miramar Florida' } as unknown as Record<
      string,
      unknown
    >,
    jobNumber: 'QB-1',
    invoiceDate: '2026-10-13',
  });
}

function countPages(bytes: Uint8Array): number {
  const matches = new TextDecoder('latin1').decode(bytes).match(/\/Type\s*\/Page[^s]/g);
  return matches ? matches.length : 0;
}

describe('boardUpTimeline', () => {
  it('labels first input, start job, and end job from photo taken-at times', () => {
    const snapshot = boardUpSnapshot();
    const t = boardUpTimeline(snapshot, [
      { url: 'a', takenAt: 'Oct 21, 2026, 10:02 AM' },
      { url: 'b', takenAt: '' },
      { url: 'c', takenAt: 'Oct 21, 2026, 11:45 AM' },
    ]);
    expect(t.startJob).toBe('Oct 21, 2026, 10:02 AM');
    expect(t.endJob).toBe('Oct 21, 2026, 11:45 AM');
    // First input comes from the job's created_at (may be '' for a fresh draft).
    expect(typeof t.firstInput).toBe('string');
  });

  it('returns empty start/end when no photo has a taken-at time', () => {
    const snapshot = boardUpSnapshot();
    const t = boardUpTimeline(snapshot, [
      { url: 'a', takenAt: '' },
      { url: 'b', takenAt: '' },
    ]);
    expect(t.startJob).toBe('');
    expect(t.endJob).toBe('');
  });
});

describe('board-up photos PDF pagination', () => {
  it('puts 6 photos on exactly 2 pages (4 + 2), not one', async () => {
    const snapshot = boardUpSnapshot();
    const element = InvoicePdf({
      snapshot,
      style: 'classic',
      pageSize: 'LETTER',
      photos: [PIXEL, PIXEL, PIXEL, PIXEL, PIXEL, PIXEL].map((url) => ({ url, takenAt: '' })),
      photosOnly: true,
    });
    const blob = await pdf(element).toBlob();
    const buf = new Uint8Array(await blob.arrayBuffer());
    expect(countPages(buf)).toBe(2);
  }, 30000);

  it('keeps 4 photos on a single page', async () => {
    const snapshot = boardUpSnapshot();
    const element = InvoicePdf({
      snapshot,
      style: 'classic',
      pageSize: 'LETTER',
      photos: [PIXEL, PIXEL, PIXEL, PIXEL].map((url) => ({ url, takenAt: '' })),
      photosOnly: true,
    });
    const blob = await pdf(element).toBlob();
    const buf = new Uint8Array(await blob.arrayBuffer());
    expect(countPages(buf)).toBe(1);
  }, 30000);
});
