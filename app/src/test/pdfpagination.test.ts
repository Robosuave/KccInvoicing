import { describe, expect, it } from 'vitest';
import { pdf } from '@react-pdf/renderer';
import { InvoicePdf } from '../pdf/InvoicePdf';
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

function countPages(buf: Buffer): number {
  const matches = buf.toString('latin1').match(/\/Type\s*\/Page[^s]/g);
  return matches ? matches.length : 0;
}

describe('board-up photos PDF pagination', () => {
  it('puts 6 photos on exactly 2 pages (4 + 2), not one', async () => {
    const snapshot = boardUpSnapshot();
    const element = InvoicePdf({
      snapshot,
      style: 'classic',
      pageSize: 'LETTER',
      photoUrls: [PIXEL, PIXEL, PIXEL, PIXEL, PIXEL, PIXEL],
      photosOnly: true,
    });
    const blob = await pdf(element).toBlob();
    const buf = Buffer.from(await blob.arrayBuffer());
    expect(countPages(buf)).toBe(2);
  }, 30000);

  it('keeps 4 photos on a single page', async () => {
    const snapshot = boardUpSnapshot();
    const element = InvoicePdf({
      snapshot,
      style: 'classic',
      pageSize: 'LETTER',
      photoUrls: [PIXEL, PIXEL, PIXEL, PIXEL],
      photosOnly: true,
    });
    const blob = await pdf(element).toBlob();
    const buf = Buffer.from(await blob.arrayBuffer());
    expect(countPages(buf)).toBe(1);
  }, 30000);
});
