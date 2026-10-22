import { describe, expect, it } from 'vitest';
import {
  exifRawToDate,
  exifRawToInput,
  fileModifiedToExifRaw,
  formatDuration,
  formatIsoDateTime,
  formatPhotoDateTime,
  inputToExifRaw,
  isoToExifRaw,
  parseExifDateTime,
} from '../lib/exif';

/**
 * Build a minimal JPEG holding one EXIF ASCII tag, so the parser is tested
 * against real TIFF bytes rather than a mock.
 */
function jpegWithExif(opts: {
  littleEndian: boolean;
  tag: number;
  value: string;
  ifd0Tag?: number;
}): ArrayBuffer {
  const little = opts.littleEndian;
  const bytes: number[] = [];
  const pushU16 = (v: number) => {
    bytes.push(little ? v & 0xff : (v >> 8) & 0xff, little ? (v >> 8) & 0xff : v & 0xff);
  };
  const pushU32 = (v: number) => {
    if (little) bytes.push(v & 0xff, (v >> 8) & 0xff, (v >> 16) & 0xff, (v >> 24) & 0xff);
    else bytes.push((v >> 24) & 0xff, (v >> 16) & 0xff, (v >> 8) & 0xff, v & 0xff);
  };

  bytes.push(0xff, 0xd8); // SOI
  const segStart = bytes.length;
  bytes.push(0xff, 0xe1, 0x00, 0x00); // APP1 + length placeholder
  for (const c of 'Exif\0\0') bytes.push(c.charCodeAt(0));
  const tiffStart = bytes.length;
  bytes.push(...(little ? [0x49, 0x49] : [0x4d, 0x4d])); // byte order
  pushU16(42);
  pushU32(8); // IFD0 offset

  const ifd0At = bytes.length;
  const entries: Array<{ tag: number; type: number; count: number; value: number; str?: string }> = [];
  // Reserve: IFD0 gets the ExifIFD pointer (0x8769) unless the tag lives in IFD0.
  if (opts.ifd0Tag) entries.push({ tag: opts.ifd0Tag, type: 2, count: opts.value.length + 1, value: 0, str: opts.value });
  else entries.push({ tag: 0x8769, type: 4, count: 1, value: 0 });

  pushU16(entries.length);
  const entryPos: number[] = [];
  for (const e of entries) {
    entryPos.push(bytes.length);
    pushU16(e.tag);
    pushU16(e.type);
    pushU32(e.count);
    pushU32(e.value); // patched below for offsets
  }
  bytes.push(0, 0, 0, 0); // next IFD

  let exifIfdAt = 0;
  if (!opts.ifd0Tag) {
    exifIfdAt = bytes.length;
    pushU16(1);
    entryPos.push(bytes.length);
    pushU16(opts.tag);
    pushU16(2);
    pushU32(opts.value.length + 1);
    pushU32(0); // patched below
    bytes.push(0, 0, 0, 0);
  }

  // String data + patch offsets.
  const strAt = bytes.length;
  for (const c of opts.value) bytes.push(c.charCodeAt(0));
  bytes.push(0);
  const strOffset = strAt - tiffStart;
  const patchU32 = (at: number, v: number) => {
    const b = little
      ? [v & 0xff, (v >> 8) & 0xff, (v >> 16) & 0xff, (v >> 24) & 0xff]
      : [(v >> 24) & 0xff, (v >> 16) & 0xff, (v >> 8) & 0xff, v & 0xff];
    for (let i = 0; i < 4; i++) bytes[at + i] = b[i];
  };
  if (!opts.ifd0Tag) {
    patchU32(entryPos[0] + 8, exifIfdAt - tiffStart); // ExifIFD pointer
    patchU32(entryPos[1] + 8, strOffset); // DateTimeOriginal value offset
  } else {
    patchU32(entryPos[0] + 8, strOffset);
  }

  // APP1 length (includes its own 2 bytes).
  const segLen = bytes.length - segStart - 2;
  bytes[segStart + 2] = (segLen >> 8) & 0xff;
  bytes[segStart + 3] = segLen & 0xff;
  bytes.push(0xff, 0xd9); // EOI
  void ifd0At;
  return new Uint8Array(bytes).buffer as ArrayBuffer;
}

describe('parseExifDateTime', () => {
  it('reads DateTimeOriginal from a little-endian EXIF block', () => {
    const buf = jpegWithExif({ littleEndian: true, tag: 0x9003, value: '2026:10:21 14:30:05' });
    expect(parseExifDateTime(buf)).toBe('2026:10:21 14:30:05');
  });

  it('reads DateTimeOriginal from a big-endian EXIF block', () => {
    const buf = jpegWithExif({ littleEndian: false, tag: 0x9003, value: '2026:10:21 09:05:00' });
    expect(parseExifDateTime(buf)).toBe('2026:10:21 09:05:00');
  });

  it('falls back to IFD0 DateTime when there is no EXIF IFD', () => {
    const buf = jpegWithExif({ littleEndian: true, tag: 0x9003, value: '2026:10:21 14:30:05', ifd0Tag: 0x0132 });
    expect(parseExifDateTime(buf)).toBe('2026:10:21 14:30:05');
  });

  it('returns null for a JPEG with no EXIF', () => {
    const buf = new Uint8Array([0xff, 0xd8, 0xff, 0xd9]).buffer as ArrayBuffer;
    expect(parseExifDateTime(buf)).toBeNull();
  });

  it('returns null for non-JPEG data', () => {
    const buf = new Uint8Array([0x89, 0x50, 0x4e, 0x47]).buffer as ArrayBuffer;
    expect(parseExifDateTime(buf)).toBeNull();
  });

  it('returns null for truncated garbage instead of throwing', () => {
    expect(parseExifDateTime(new ArrayBuffer(0))).toBeNull();
    expect(parseExifDateTime(new Uint8Array([0xff, 0xd8, 0xff]).buffer as ArrayBuffer)).toBeNull();
  });
});

describe('exifRawToDate', () => {
  it('parses raw EXIF into a local-time Date', () => {
    const d = exifRawToDate('2026:10:21 14:30:05');
    expect(d).not.toBeNull();
    expect(d!.getFullYear()).toBe(2026);
    expect(d!.getMonth()).toBe(9);
    expect(d!.getDate()).toBe(21);
    expect(d!.getHours()).toBe(14);
    expect(d!.getMinutes()).toBe(30);
  });
  it('returns null for bad input', () => {
    expect(exifRawToDate(null)).toBeNull();
    expect(exifRawToDate('')).toBeNull();
    expect(exifRawToDate('garbage')).toBeNull();
  });
});

describe('formatDuration', () => {
  it('formats minutes and hours', () => {
    expect(formatDuration(47 * 60000)).toBe('47 min');
    expect(formatDuration(65 * 60000)).toBe('1 hr 5 min');
    expect(formatDuration(2 * 3600000)).toBe('2 hrs');
    expect(formatDuration(90 * 60000)).toBe('1 hr 30 min');
  });
  it('returns empty string for negative or invalid input', () => {
    expect(formatDuration(-1000)).toBe('');
    expect(formatDuration(NaN)).toBe('');
  });
});

describe('formatIsoDateTime', () => {
  it('formats an ISO timestamp in local time without shifting it', () => {
    const d = new Date('2026-10-21T14:30:00Z');
    const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    let hour = d.getHours();
    const ampm = hour >= 12 ? 'PM' : 'AM';
    hour = hour % 12;
    if (hour === 0) hour = 12;
    const expected = `${months[d.getMonth()]} ${d.getDate()}, ${d.getFullYear()}, ${hour}:${String(d.getMinutes()).padStart(2, '0')} ${ampm}`;
    expect(formatIsoDateTime('2026-10-21T14:30:00Z')).toBe(expected);
  });
  it('returns empty string for missing or invalid input', () => {
    expect(formatIsoDateTime(null)).toBe('');
    expect(formatIsoDateTime('')).toBe('');
    expect(formatIsoDateTime('not a date')).toBe('');
  });
});

describe('isoToExifRaw', () => {
  it('converts an ISO timestamp to EXIF-style raw in local time', () => {
    const d = new Date('2026-10-21T19:34:05Z');
    const p = (n: number) => String(n).padStart(2, '0');
    const expected = `${d.getFullYear()}:${p(d.getMonth() + 1)}:${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
    expect(isoToExifRaw('2026-10-21T19:34:05Z')).toBe(expected);
  });
  it('returns null for missing or invalid input', () => {
    expect(isoToExifRaw(null)).toBeNull();
    expect(isoToExifRaw('')).toBeNull();
    expect(isoToExifRaw('not a date')).toBeNull();
  });
});

describe('exifRawToInput / inputToExifRaw', () => {
  it('round-trips between EXIF raw and datetime-local', () => {
    expect(exifRawToInput('2026:10:21 19:34:05')).toBe('2026-10-21T19:34');
    expect(inputToExifRaw('2026-10-21T19:34')).toBe('2026:10:21 19:34:00');
    expect(inputToExifRaw(exifRawToInput('2026:10:21 19:34:05'))).toBe('2026:10:21 19:34:00');
  });
  it('returns empty/null for bad input', () => {
    expect(exifRawToInput(null)).toBe('');
    expect(exifRawToInput('garbage')).toBe('');
    expect(inputToExifRaw('')).toBeNull();
    expect(inputToExifRaw('2026/10/21 19:34')).toBeNull();
  });
});

describe('fileModifiedToExifRaw', () => {
  it('converts a file timestamp to EXIF-style raw in local time', () => {
    const ms = new Date('2026-10-21T19:34:05Z').getTime();
    const d = new Date(ms);
    const p = (n: number) => String(n).padStart(2, '0');
    const expected = `${d.getFullYear()}:${p(d.getMonth() + 1)}:${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
    expect(fileModifiedToExifRaw(ms)).toBe(expected);
  });
  it('returns null for bad input', () => {
    expect(fileModifiedToExifRaw(0)).toBeNull();
    expect(fileModifiedToExifRaw(NaN)).toBeNull();
  });
});

describe('formatPhotoDateTime', () => {
  it('formats an afternoon time', () => {
    expect(formatPhotoDateTime('2026:10:21 14:30:05')).toBe('Oct 21, 2026, 2:30 PM');
  });
  it('formats midnight and noon without shifting the hour', () => {
    expect(formatPhotoDateTime('2026:01:05 00:05:00')).toBe('Jan 5, 2026, 12:05 AM');
    expect(formatPhotoDateTime('2026:12:31 12:00:00')).toBe('Dec 31, 2026, 12:00 PM');
  });
  it('returns empty string for missing or malformed input', () => {
    expect(formatPhotoDateTime(null)).toBe('');
    expect(formatPhotoDateTime('')).toBe('');
    expect(formatPhotoDateTime('not a date')).toBe('');
    expect(formatPhotoDateTime('2026:13:99 99:99:99')).toBe('');
  });
});
