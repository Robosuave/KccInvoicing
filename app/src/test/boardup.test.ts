import { describe, expect, it } from 'vitest';
import {
  BOARDUP_FORMULA_NOTE,
  EMPTY_BOARDUP,
  asBoardUpDetails,
  boardUpPhotoCaption,
  boardUpFilenameBase,
  boardUpFileDate,
  boardUpPdfFilename,
  buildBoardUpSmsText,
  buildBoardUpSummary,
  measurementSummaryLines,
  syncMeasurementCount,
  chunkArray,
  estimateBoardUp,
  rememberCustomCity,
  withCustomCities,
} from '../lib/boardup';

describe('estimateBoardUp', () => {
  it('returns zeros when nothing is counted', () => {
    expect(estimateBoardUp(0, 0, 0, 0)).toEqual({ rawSqft: 0, sqftCover: 0, sheets: 0 });
  });

  it('computes sqft = 12/window + 21/door + 32/slider + 64/garage; cover shows raw, sheets = ceil(raw*1.15/32)', () => {
    // 2 windows (24) + 1 door (21) + 1 slider (32) + 1 garage (64) = 141 sqft
    // cover: raw sum, NO waste (matches the source app)
    // sheets: ceil(141 * 1.15 / 32) = ceil(5.067) = 6
    const est = estimateBoardUp(2, 1, 1, 1);
    expect(est.rawSqft).toBe(141);
    expect(est.sqftCover).toBe(141);
    expect(est.sheets).toBe(6);
  });

  it('matches the source app exactly: 1 slider -> 32 cover, 2 sheets; 1 window + 2 sliders -> 76 cover, 3 sheets', () => {
    expect(estimateBoardUp(0, 0, 1, 0)).toEqual({ rawSqft: 32, sqftCover: 32, sheets: 2 });
    expect(estimateBoardUp(1, 0, 2, 0)).toEqual({ rawSqft: 76, sqftCover: 76, sheets: 3 });
  });

  it('rounds sheets up, never down', () => {
    // 1 window = 12 sqft; waste 13.8 -> ceil(13.8/32) = 1
    expect(estimateBoardUp(1, 0, 0, 0).sheets).toBe(1);
  });

  it('floors negative or fractional counts to whole non-negative numbers', () => {
    expect(estimateBoardUp(-2, 1.9, 0, 0)).toEqual(estimateBoardUp(0, 1, 0, 0));
  });

  it('matches the source-app example: the formula note is shown verbatim', () => {
    expect(BOARDUP_FORMULA_NOTE).toBe(
      'Estimate uses 12 sq ft/window, 21/door, 32/slider, 64/garage + 15% waste. Planning only — measure on site.',
    );
  });
});

describe('asBoardUpDetails', () => {
  it('returns defaults for null/undefined', () => {
    expect(asBoardUpDetails(null)).toEqual(EMPTY_BOARDUP);
    expect(asBoardUpDetails(undefined)).toEqual(EMPTY_BOARDUP);
  });

  it('keeps source-app defaults (Single-family, Emergency board-up, Today, Dan)', () => {
    expect(EMPTY_BOARDUP.propertyType).toBe('Single-family');
    expect(EMPTY_BOARDUP.serviceNeeded).toBe('Emergency board-up');
    expect(EMPTY_BOARDUP.urgency).toBe('Today');
    expect(EMPTY_BOARDUP.crew).toBe('Dan');
  });

  it('coerces photo paths to a string array and drops junk', () => {
    const d = asBoardUpDetails({ photos: ['a/b.jpg', 42, null, 'c/d.png'] });
    expect(d.photos).toEqual(['a/b.jpg', 'c/d.png']);
  });

  it('rejects invalid dropdown values, keeping defaults', () => {
    const d = asBoardUpDetails({ propertyType: 'Castle', crew: 'Nobody', urgency: 'Whenever' });
    expect(d.propertyType).toBe('Single-family');
    expect(d.crew).toBe('Dan');
    expect(d.urgency).toBe('Today');
  });
});

describe('buildBoardUpSummary', () => {
  it('includes the job number, estimate, and photo count', () => {
    const body = buildBoardUpSummary(
      { ...EMPTY_BOARDUP, streetAddress: '123 Main St', windows: 4, photos: ['a.jpg', 'b.jpg'] },
      'QB-7',
    );
    expect(body).toContain('BOARD-UP JOB #QB-7');
    expect(body).toContain('123 Main St');
    expect(body).toContain('Openings: 4 windows, 0 doors, 0 sliders/patios, 0 garage doors');
    expect(body).toContain('Photos: 2 attached');
    expect(body).toContain('4x8 sheets');
    expect(body).toContain('Ref: https://aquick.kalekycomputer.com');
  });
});

describe('boardUpFilenameBase', () => {
  it('builds a filename-safe address base', () => {
    expect(boardUpFilenameBase({ streetAddress: '1333 S Ocean Blvd, Apt', city: 'Lauderhill Florida' })).toBe(
      '1333 S Ocean Blvd, Apt, Lauderhill Florida',
    );
  });

  it('strips characters illegal in filenames', () => {
    expect(boardUpFilenameBase({ streetAddress: '123 "Main" St / Unit: 4', city: '' })).toBe(
      '123 -Main- St - Unit- 4',
    );
  });

  it('falls back when there is no address', () => {
    expect(boardUpFilenameBase({ streetAddress: '', city: '' })).toBe('boardup-job');
  });
});

describe('boardUpPdfFilename', () => {
  const d = { streetAddress: '344tt', city: 'Miramar Florida' };

  it('names files "Aquick Job M-D-YYYY - address - kind.pdf"', () => {
    expect(boardUpPdfFilename(d, '2026-10-13', 'job information')).toBe(
      'Aquick Job 10-13-2026 - 344tt, Miramar Florida - job information.pdf',
    );
    expect(boardUpPdfFilename(d, '2026-10-13', 'photos')).toBe(
      'Aquick Job 10-13-2026 - 344tt, Miramar Florida - photos.pdf',
    );
    expect(boardUpPdfFilename(d, '2026-10-13', 'condensed')).toBe(
      'Aquick Job 10-13-2026 - 344tt, Miramar Florida - condensed.pdf',
    );
  });

  it('parses the day and month from the job date', () => {
    expect(boardUpFileDate('2026-01-05')).toBe('1-5-2026');
  });
});

describe('syncMeasurementCount', () => {
  it('grows the array with blanks when the count increases', () => {
    expect(syncMeasurementCount(3, ['36x45'])).toEqual(['36x45', '', '']);
  });

  it('trims the array when the count decreases', () => {
    expect(syncMeasurementCount(1, ['36x45', '40x60'])).toEqual(['36x45']);
  });

  it('keeps the array as-is when the count matches', () => {
    expect(syncMeasurementCount(2, ['a', 'b'])).toEqual(['a', 'b']);
  });
});

describe('measurementSummaryLines', () => {
  it('lists one line per type with measurements, skipping blanks', () => {
    const lines = measurementSummaryLines({
      ...EMPTY_BOARDUP,
      windowMeasurements: ['36x45', '', '40x60'],
      doorMeasurements: [''],
      sliderMeasurements: ['72x80'],
    });
    expect(lines).toEqual([
      'Window measurements: 36x45, 40x60',
      'Slider / patio measurements: 72x80',
    ]);
  });

  it('returns nothing when no measurements are entered', () => {
    expect(measurementSummaryLines({ ...EMPTY_BOARDUP })).toEqual([]);
  });
});

describe('asBoardUpDetails measurements', () => {
  it('parses measurement arrays, dropping non-strings', () => {
    const d = asBoardUpDetails({ windowMeasurements: ['36x45', 42, ''], doorMeasurements: 'nope' });
    expect(d.windowMeasurements).toEqual(['36x45', '']);
    expect(d.doorMeasurements).toEqual([]);
  });
});

describe('buildBoardUpSmsText', () => {
  it('matches the source app compact layout', () => {
    const body = buildBoardUpSmsText({
      ...EMPTY_BOARDUP,
      serviceNeeded: 'Emergency board-up',
      caseNumber: '13344',
      requestingOfficer: 'Dija',
      cityName: 'City of Miramar',
      streetAddress: '344tt',
      city: 'Miramar Florida',
      phone: '(954) 441-4540',
      propertyType: 'Commercial',
      urgency: 'Today',
      crew: 'Dan',
      windows: 1,
      doors: 1,
    });
    const lines = body.split('\n');
    expect(lines[0]).toBe('AQUICK BOARD-UP \u2014 Emergency board-up');
    expect(body).toContain('Case #: 13344');
    expect(body).toContain('Requesting officer: Dija');
    expect(body).toContain('City name: City of Miramar');
    expect(body).toContain('Address: 344tt, Miramar, Florida');
    expect(body).toContain('Phone number: (954) 441-4540');
    expect(body).toContain('Type: Commercial');
    expect(body).toContain('Urgency: Today | Crew: Dan');
    expect(body).toContain('Openings: 2 (1W 1D 0S 0G) \u2014 2 sheets est.');
    expect(body).toContain('Ref: https://aquick.kalekycomputer.com');
  });

  it('uses a custom reference link in the SMS when set', () => {
    const body = buildBoardUpSmsText({
      ...EMPTY_BOARDUP,
      referenceLink: 'https://example.com/job-42',
    });
    expect(body).toContain('Ref: https://example.com/job-42');
    expect(body).not.toContain('Ref: https://aquick.kalekycomputer.com');
  });

  it('omits blank case/officer/phone lines', () => {
    const body = buildBoardUpSmsText({ ...EMPTY_BOARDUP });
    expect(body).not.toContain('Case #');
    expect(body).not.toContain('Requesting officer');
    expect(body).not.toContain('Phone number');
  });
});

describe('chunkArray (photo PDF paging)', () => {
  it('splits 9 photos into 4/4/1 — matching 4-per-page', () => {
    const photos = Array.from({ length: 9 }, (_, i) => `p${i}.jpg`);
    const pages = chunkArray(photos, 4);
    expect(pages).toHaveLength(3);
    expect(pages[0]).toHaveLength(4);
    expect(pages[1]).toHaveLength(4);
    expect(pages[2]).toEqual(['p8.jpg']);
  });

  it('returns one chunk when items fit', () => {
    expect(chunkArray(['a', 'b'], 4)).toEqual([['a', 'b']]);
  });

  it('returns [] for empty input or non-positive size', () => {
    expect(chunkArray([], 4)).toEqual([]);
    expect(chunkArray(['a'], 0)).toEqual([]);
    expect(chunkArray(['a'], -2)).toEqual([]);
  });
});

describe('withCustomCities', () => {
  const builtIn = ['City of Hollywood', 'Other'];

  it('appends a new city after the built-ins', () => {
    expect(withCustomCities(builtIn, ['Coconut Creek'])).toEqual([
      'City of Hollywood',
      'Other',
      'Coconut Creek',
    ]);
  });

  it('dedupes case-insensitively against built-ins and trims whitespace', () => {
    expect(withCustomCities(builtIn, ['city of hollywood', '  Coconut Creek  ', 'COCONUT creek'])).toEqual([
      'City of Hollywood',
      'Other',
      'Coconut Creek',
    ]);
  });

  it('drops empty strings', () => {
    expect(withCustomCities(builtIn, ['', '   '])).toEqual(builtIn);
  });
});

describe('rememberCustomCity', () => {
  const builtIn = ['City of Hollywood', 'Other'];

  it('returns the updated list for a genuinely new city (in-memory when storage is unavailable)', () => {
    expect(rememberCustomCity('test-key', 'Coconut Creek', builtIn)).toEqual(['Coconut Creek']);
  });

  it('does not add a duplicate of a built-in option (case-insensitive)', () => {
    expect(rememberCustomCity('test-key', 'CITY OF HOLLYWOOD', builtIn)).toEqual([]);
  });

  it('ignores blank names', () => {
    expect(rememberCustomCity('test-key', '   ', builtIn)).toEqual([]);
  });
});

describe('boardUpPhotoCaption', () => {
  it('combines street and city', () => {
    expect(boardUpPhotoCaption({ streetAddress: '123 Main St', city: 'Hollywood Florida' })).toBe(
      '123 Main St, Hollywood Florida',
    );
  });

  it('falls back to street only when city is blank', () => {
    expect(boardUpPhotoCaption({ streetAddress: '123 Main St', city: '' })).toBe('123 Main St');
  });

  it('returns empty string when there is no address', () => {
    expect(boardUpPhotoCaption({ streetAddress: '', city: '' })).toBe('');
  });
});
