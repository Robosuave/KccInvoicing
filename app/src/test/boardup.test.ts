import { describe, expect, it } from 'vitest';
import {
  BOARDUP_FORMULA_NOTE,
  EMPTY_BOARDUP,
  asBoardUpDetails,
  buildBoardUpSummary,
  estimateBoardUp,
} from '../lib/boardup';

describe('estimateBoardUp', () => {
  it('returns zeros when nothing is counted', () => {
    expect(estimateBoardUp(0, 0, 0, 0)).toEqual({ rawSqft: 0, sqftCover: 0, sheets: 0 });
  });

  it('computes sqft = 12/window + 21/door + 32/slider + 64/garage, +15% waste, sheets = ceil(waste/32)', () => {
    // 2 windows (24) + 1 door (21) + 1 slider (32) + 1 garage (64) = 141 sqft
    // waste: 141 * 1.15 = 162.15 -> rounded to 162
    // sheets: ceil(162.15 / 32) = ceil(5.067) = 6
    const est = estimateBoardUp(2, 1, 1, 1);
    expect(est.rawSqft).toBe(141);
    expect(est.sqftCover).toBe(162);
    expect(est.sheets).toBe(6);
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
  });
});
