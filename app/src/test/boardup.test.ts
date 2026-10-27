import { describe, expect, it } from 'vitest';
import {
  BOARDUP_FORMULA_NOTE,
  EMPTY_BOARDUP,
  asBoardUpDetails,
  boardUpPhotoCaption,
  boardUpFilenameBase,
  boardUpFileDate,
  boardUpPdfFilename,
  boardUpOutputRows,
  buildBoardUpCsv,
  buildBoardUpSmsText,
  buildBoardUpSummary,
  crewContactFor,
  measurementSummaryLines,
  syncMeasurementCount,
  chunkArray,
  estimateBoardUp,
  measuredTotals,
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
      'Estimate uses 12 sq ft/window, 21/door, 32/slider, 64/garage, 12/AC + 15% waste. Planning only — measure on site.',
    );
  });

  it('counts AC units at 12 sq ft each', () => {
    // 1 AC = 12 sqft; sheets ceil(12*1.15/32) = 1
    expect(estimateBoardUp(0, 0, 0, 0, 2)).toEqual({ rawSqft: 24, sqftCover: 24, sheets: 1 });
    // AC stacks with the other types: 1 window (12) + 1 AC (12) = 24
    expect(estimateBoardUp(1, 0, 0, 0, 1).rawSqft).toBe(24);
  });
});

describe('asBoardUpDetails', () => {
  it('returns defaults for null/undefined', () => {
    expect(asBoardUpDetails(null)).toEqual(EMPTY_BOARDUP);
    expect(asBoardUpDetails(undefined)).toEqual(EMPTY_BOARDUP);
  });

  it('keeps source-app defaults (Single-family, Emergency board-up, Today, Unassigned crew, Dan email)', () => {
    expect(EMPTY_BOARDUP.propertyType).toBe('Single-family');
    expect(EMPTY_BOARDUP.serviceNeeded).toBe('Emergency board-up');
    expect(EMPTY_BOARDUP.urgency).toBe('Today');
    expect(EMPTY_BOARDUP.crew).toBe('Unassigned');
    expect(EMPTY_BOARDUP.emailTo).toBe('4831104x@gmail.com');
  });

  it('coerces photo paths to a string array and drops junk', () => {
    const d = asBoardUpDetails({ photos: ['a/b.jpg', 42, null, 'c/d.png'] });
    expect(d.photos).toEqual(['a/b.jpg', 'c/d.png']);
  });

  it('rejects invalid dropdown values, keeping defaults (crew names come from the crew table)', () => {
    const d = asBoardUpDetails({ propertyType: 'Castle', crew: 'Nobody', urgency: 'Whenever' });
    expect(d.propertyType).toBe('Single-family');
    // Crew is no longer whitelisted here: names are managed in boardup_crew,
    // so any stored string survives the round trip.
    expect(d.crew).toBe('Nobody');
    expect(d.urgency).toBe('Today');
  });

  it('finds crew contacts case-insensitively', () => {
    const contacts = [
      { id: '1', name: 'Dan', phone: '(954) 483-1104', email: '4831104x@gmail.com' },
      { id: '2', name: 'Rob', phone: '', email: '' },
    ];
    expect(crewContactFor('dan', contacts)?.email).toBe('4831104x@gmail.com');
    expect(crewContactFor('DAN', contacts)?.phone).toBe('(954) 483-1104');
    expect(crewContactFor('Nobody', contacts)).toBeNull();
    expect(crewContactFor('', contacts)).toBeNull();
  });

  it('keeps EXIF capture times keyed by photo path, dropping junk', () => {
    expect(EMPTY_BOARDUP.photoTakenAt).toEqual({});
    const d = asBoardUpDetails({
      photos: ['a.jpg', 'b.jpg'],
      photoTakenAt: { 'a.jpg': '2026:10:21 14:30:05', 'b.jpg': 'not a date', 'c.jpg': 42 },
    });
    expect(d.photoTakenAt).toEqual({ 'a.jpg': '2026:10:21 14:30:05' });
    expect(asBoardUpDetails({ photoTakenAt: null }).photoTakenAt).toEqual({});
    expect(asBoardUpDetails({ photoTakenAt: ['x'] }).photoTakenAt).toEqual({});
  });
});

describe('boardUpOutputRows', () => {
  it('returns the 12 labeled rows in Robert\'s order', () => {
    const rows = boardUpOutputRows({ ...EMPTY_BOARDUP });
    expect(rows.map(([label]) => label)).toEqual([
      'Date and time',
      'City name',
      'Address',
      'City and state',
      'Phone number',
      'Case',
      'Requesting officer and badge',
      'Structure type',
      'Type of board up',
      'When needed',
      'Crew',
      'Job details',
    ]);
  });

  it('uses the job-came-in time for "Date and time"', () => {
    const rows = boardUpOutputRows({ ...EMPTY_BOARDUP }, { jobDateTime: '2026-10-14T14:30:00' });
    expect(rows[0][1]).toContain('2026');
    expect(rows[0][1]).toContain('10/14');
  });

  it('splits street address from city/state', () => {
    const rows = boardUpOutputRows({
      ...EMPTY_BOARDUP,
      streetAddress: '344tt',
      city: 'Miramar Florida',
    });
    const byLabel = Object.fromEntries(rows);
    expect(byLabel['Address']).toBe('344tt');
    expect(byLabel['City and state']).toBe('Miramar, Florida');
  });

  it('packs openings, measurements, and notes into Job details', () => {
    const rows = boardUpOutputRows({
      ...EMPTY_BOARDUP,
      windows: 1,
      doors: 1,
      windowMeasurements: ['36x45'],
      accessNotes: 'Gate code 1234',
    });
    const byLabel = Object.fromEntries(rows);
    expect(byLabel['Job details']).toContain('2 openings (1W 1D 0S 0G)');
    expect(byLabel['Job details']).toContain('2 sheets est.');
    expect(byLabel['Job details']).toContain('Window measurements: 36x45');
    expect(byLabel['Job details']).toContain('Notes: Gate code 1234');
  });
});

describe('buildBoardUpSummary', () => {
  it('includes the job number, estimate, and photo count', () => {
    const body = buildBoardUpSummary(
      { ...EMPTY_BOARDUP, streetAddress: '123 Main St', windows: 4, photos: ['a.jpg', 'b.jpg'] },
      'QB-7',
    );
    expect(body).toContain('BOARD-UP JOB #QB-7');
    expect(body).toContain('Address: 123 Main St');
    expect(body).toContain('sheets est.');
    expect(body).toContain('Photos: 2 attached');
    expect(body).toContain('Ref: https://aquick.kalekycomputer.com');
  });

  it('lists the 12 labels in order', () => {
    const body = buildBoardUpSummary(
      {
        ...EMPTY_BOARDUP,
        cityName: 'City of Miramar',
        streetAddress: '344tt',
        city: 'Miramar Florida',
        phone: '9544414540',
        caseNumber: '13344',
        requestingOfficer: 'Dija',
      },
      null,
    );
    const labels = [
      'Date and time:',
      'City name:',
      'Address:',
      'City and state:',
      'Phone number:',
      'Case:',
      'Requesting officer and badge:',
      'Structure type:',
      'Type of board up:',
      'When needed:',
      'Crew:',
      'Job details:',
    ];
    let last = -1;
    for (const label of labels) {
      const i = body.indexOf(label);
      expect(i).toBeGreaterThan(last);
      last = i;
    }
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
  it('sends values only, in Robert\'s 12-field order, no labels', () => {
    const body = buildBoardUpSmsText(
      {
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
      },
      { jobDateTime: '2026-10-14T18:30:00' },
    );
    const lines = body.split('\n');
    expect(lines[0]).toBe('AQUICK BOARD-UP');
    expect(lines[1]).toMatch(/10\/14\/2026/);
    // values in order, no labels
    const values = [
      'City of Miramar',
      '344tt',
      'Miramar, Florida',
      '(954) 441-4540',
      '13344',
      'Dija',
      'Commercial',
      'Emergency board-up',
      'Today',
      'Dan',
      '2 openings (1W 1D 0S 0G) \u2014 2 sheets est.',
    ];
    let last = 1;
    for (const v of values) {
      const i = lines.indexOf(v, last + 1);
      expect(i).toBeGreaterThan(last);
      last = i;
    }
    expect(body).toContain('Ref: https://aquick.kalekycomputer.com');
    expect(body).not.toContain('City name:');
    expect(body).not.toContain('Phone number:');
    expect(body).not.toContain('Job details:');
  });

  it('uses a custom reference link in the SMS when set', () => {
    const body = buildBoardUpSmsText({
      ...EMPTY_BOARDUP,
      referenceLink: 'https://example.com/job-42',
    });
    expect(body).toContain('Ref: https://example.com/job-42');
    expect(body).not.toContain('Ref: https://aquick.kalekycomputer.com');
  });

  it('omits blank values', () => {
    const body = buildBoardUpSmsText({ ...EMPTY_BOARDUP });
    expect(body).not.toContain('Dija');
    expect(body).not.toContain('13344');
    expect(body).toContain('AQUICK BOARD-UP');
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

describe('buildBoardUpCsv', () => {
  it('exports one row per job with the 12 fields, sheets, and done flag', () => {
    const csv = buildBoardUpCsv([
      {
        jobNumber: 'QB-12',
        completed: true,
        createdAt: '2026-10-14T18:30:00',
        details: {
          ...EMPTY_BOARDUP,
          cityName: 'City of Miramar',
          streetAddress: '344tt',
          city: 'Miramar Florida',
          phone: '(954) 441-4540',
          caseNumber: '13344',
          requestingOfficer: 'Dija',
          propertyType: 'Commercial',
          serviceNeeded: 'Emergency board-up',
          urgency: 'Today',
          crew: 'Dan',
          windows: 1,
          doors: 1,
          windowMeasurements: ['36x45'],
          accessNotes: 'Gate code 1234',
        },
      },
    ]);
    const lines = csv.split('\n');
    expect(lines[0]).toBe(
      'Job,Done,Date and time,City name,Address,City and state,Phone number,Case,Requesting officer and badge,Structure type,Type of board up,When needed,Crew,Caller,Openings,Measurements,Locks,Sheets est.,Notes',
    );
    expect(lines).toHaveLength(2);
    expect(lines[1]).toContain('QB-12,Yes,');
    expect(lines[1]).toContain('City of Miramar');
    expect(lines[1]).toContain('Miramar, Florida');
    expect(lines[1]).toContain('2 (1W 1D 0S 0G)');
    expect(lines[1]).toContain('Window measurements: 36x45');
    expect(lines[1]).toContain(',2,');
    expect(lines[1]).toContain('Gate code 1234');
  });

  it('quotes cells containing commas or quotes', () => {
    const csv = buildBoardUpCsv([
      {
        jobNumber: 'QB-13',
        completed: false,
        createdAt: '2026-10-14T18:30:00',
        details: { ...EMPTY_BOARDUP, streetAddress: '123 "Main", Apt 4' },
      },
    ]);
    expect(csv.split('\n')[1]).toContain('"123 ""Main"", Apt 4"');
  });

  it('returns just the header when there are no jobs', () => {
    expect(buildBoardUpCsv([]).split('\n')).toHaveLength(1);
  });
});

describe('crew-entry parity fields', () => {
  it('exposes the exact window/door preset lists from the crew-entry app', async () => {
    const { WINDOW_MEASUREMENT_PRESETS, DOOR_MEASUREMENT_PRESETS, CUSTOM_SIZE_OPTION } =
      await import('../lib/boardup');
    expect(CUSTOM_SIZE_OPTION).toBe('Custom size');
    expect(WINDOW_MEASUREMENT_PRESETS).toEqual([
      '36x50', '36.25x50', '36.5x50', '36.75x50',
      '37x48', '37.25x48', '37.5x48', '37.75x48',
    ]);
    expect(DOOR_MEASUREMENT_PRESETS).toEqual([
      '36x80', '36.25x80', '36.5x80', '36.75x80',
      '37x80', '37.25x80', '37.5x80',
      '36x81', '36.25x81', '36.5x81', '36.75x81',
    ]);
  });

  it('summarizes lock combinations per type', async () => {
    const { lockSummaryLines } = await import('../lib/boardup');
    const d = { ...EMPTY_BOARDUP, haspLockCombos: ['4419', ''], chainLockCombos: ['8820'] };
    expect(lockSummaryLines(d)).toEqual([
      'Hasp & lock combos: 4419',
      'Lock & chain combos: 8820',
    ]);
    expect(lockSummaryLines(EMPTY_BOARDUP)).toEqual([]);
  });

  it('migrates retired urgency labels when reading old jobs', () => {
    expect(asBoardUpDetails({ urgency: 'Emergency — now' }).urgency).toBe('Emergency — dispatch now');
    expect(asBoardUpDetails({ urgency: 'Within 24 hrs' }).urgency).toBe('Scheduled');
    expect(asBoardUpDetails({ urgency: 'Today' }).urgency).toBe('Today');
  });

  it('includes caller, AC, and locks in the job details output', () => {
    const d = {
      ...EMPTY_BOARDUP,
      callerName: 'Maria',
      windows: 1,
      acUnits: 1,
      windowMeasurements: ['37x48'],
      acMeasurements: ['30x24'],
      haspLocks: 1,
      haspLockCombos: ['4419'],
    };
    const rows = boardUpOutputRows(d, { jobDateTime: '2026-10-15T18:00:00' });
    const details = rows.find(([label]) => label === 'Job details')?.[1] ?? '';
    expect(details).toContain('Caller: Maria');
    expect(details).toContain('2 openings (1W 0D 0S 0G 1A)');
    expect(details).toContain('AC measurements: 30x24');
    expect(details).toContain('Hasp & lock combos: 4419');
  });

  it('guards the new fields when reading stored jobs', () => {
    const d = asBoardUpDetails({ acUnits: 'x', haspLocks: -2, haspLockCombos: 'nope', callerName: 42 });
    expect(d.acUnits).toBe(0);
    expect(d.haspLocks).toBe(0);
    expect(d.haspLockCombos).toEqual([]);
    expect(d.callerName).toBe('');
    expect(d.acMeasurements).toEqual([]);
    expect(d.chainLocks).toBe(0);
    expect(d.chainLockCombos).toEqual([]);
  });
});

describe('crew-entry parity round 2 (Oct 26, 2026 comparison)', () => {
  it('adds the crew-entry property-type and service options without removing Aquick ones', async () => {
    const { PROPERTY_TYPE_OPTIONS, SERVICE_NEEDED_OPTIONS } = await import('../lib/boardup');
    expect(PROPERTY_TYPE_OPTIONS).toContain('Vacant lot / structure');
    expect(PROPERTY_TYPE_OPTIONS).toContain('Other');
    expect(PROPERTY_TYPE_OPTIONS).toContain('Storefront');
    expect(SERVICE_NEEDED_OPTIONS).toContain('Board up');
    expect(SERVICE_NEEDED_OPTIONS).toContain('Re-board / repair');
    expect(SERVICE_NEEDED_OPTIONS).toContain('Secure property');
    expect(SERVICE_NEEDED_OPTIONS).toContain('Inspection / estimate');
    expect(SERVICE_NEEDED_OPTIONS).toContain('Other');
    expect(SERVICE_NEEDED_OPTIONS).toContain('Hurricane / storm prep');
  });

  it('keeps state (default Florida) and job time when reading stored jobs', () => {
    const d = asBoardUpDetails({ state: 'Florida', jobTime: '14:30' });
    expect(d.state).toBe('Florida');
    expect(d.jobTime).toBe('14:30');
    expect(asBoardUpDetails({}).state).toBe('Florida');
    expect(EMPTY_BOARDUP.state).toBe('Florida');
  });

  it('pairs an entered job time with the job date in the output rows', () => {
    const d = { ...EMPTY_BOARDUP, jobTime: '14:30' };
    const rows = boardUpOutputRows(d, { jobDateTime: '2026-10-15T18:00:00' });
    expect(rows.find(([label]) => label === 'Date and time')?.[1]).toContain('2:30 PM');
    const noTime = boardUpOutputRows(EMPTY_BOARDUP, { jobDateTime: '2026-10-15T18:00:00' });
    expect(noTime.find(([label]) => label === 'Date and time')?.[1]).toContain('6:00 PM');
  });

  it('uses the state field in the City and state output row', () => {
    const d = { ...EMPTY_BOARDUP, city: 'Hollywood Florida', state: 'Florida' };
    const rows = boardUpOutputRows(d, { jobDateTime: '2026-10-15T18:00:00' });
    expect(rows.find(([label]) => label === 'City and state')?.[1]).toBe('Hollywood, Florida');
  });

  it('measuredTotals rounds each WxH pair up to a whole square inch, then adds', () => {
    // 36x50 = 1800; 36.25x50 = 1812.5 -> 1813; total 3613 sq in = 25.09 sq ft
    expect(measuredTotals([['36x50', '36.25x50'], ['not a size']])).toEqual({
      sqIn: 3613,
      sqFt: 3613 / 144,
      pairs: 2,
    });
    expect(measuredTotals([[], []])).toEqual({ sqIn: 0, sqFt: 0, pairs: 0 });
  });
});
