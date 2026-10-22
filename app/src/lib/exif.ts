/**
 * Minimal EXIF reader: extracts a photo's capture date/time from a JPEG.
 *
 * The Aquick job PDFs print each photo's taken-at time under the picture.
 * Only DateTimeOriginal (0x9003) / DateTimeDigitized (0x9004) / DateTime
 * (0x0132) are parsed — everything else returns null instead of throwing,
 * so one odd file can never block a PDF.
 */

/** Raw EXIF "YYYY:MM:DD HH:MM:SS" capture time, or null. Pure function. */
export function parseExifDateTime(buffer: ArrayBuffer): string | null {
  try {
    const bytes = new Uint8Array(buffer);
    if (bytes.length < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8) return null;
    // Walk JPEG segments looking for APP1/Exif.
    let pos = 2;
    while (pos + 4 <= bytes.length) {
      if (bytes[pos] !== 0xff) return null;
      const marker = bytes[pos + 1];
      // Standalone markers carry no length field.
      if (marker === 0xd8 || marker === 0xd9 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
        pos += 2;
        continue;
      }
      const len = (bytes[pos + 2] << 8) | bytes[pos + 3];
      if (len < 2 || pos + 2 + len > bytes.length) return null;
      if (marker === 0xe1 && len > 8) {
        const head = String.fromCharCode(
          bytes[pos + 4],
          bytes[pos + 5],
          bytes[pos + 6],
          bytes[pos + 7],
          bytes[pos + 8],
          bytes[pos + 9],
        );
        if (head === 'Exif\0\0') {
          const dt = parseTiffDateTime(bytes, pos + 10, bytes.length);
          if (dt) return dt;
        }
      }
      // Start-of-scan begins the image data: no metadata past this point.
      if (marker === 0xda) return null;
      pos += 2 + len;
    }
    return null;
  } catch {
    return null;
  }
}

function parseTiffDateTime(bytes: Uint8Array, tiffStart: number, end: number): string | null {
  if (tiffStart + 8 > end) return null;
  const little = bytes[tiffStart] === 0x49 && bytes[tiffStart + 1] === 0x49; // "II"
  const big = bytes[tiffStart] === 0x4d && bytes[tiffStart + 1] === 0x4d; // "MM"
  if (!little && !big) return null;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const u16 = (at: number) => view.getUint16(at, little);
  const u32 = (at: number) => view.getUint32(at, little);
  if (u16(tiffStart + 2) !== 42) return null;
  const ifd0 = tiffStart + u32(tiffStart + 4);

  const readAscii = (ifd: number, tag: number): string | null => {
    if (ifd + 2 > end) return null;
    const count = u16(ifd);
    for (let i = 0; i < count; i++) {
      const e = ifd + 2 + i * 12;
      if (e + 12 > end) return null;
      if (u16(e) !== tag) continue;
      const type = u16(e + 2);
      const n = u32(e + 4);
      if (type !== 2 || n === 0 || n > 64) continue; // ASCII only, sanity cap
      const strStart = n <= 4 ? e + 8 : tiffStart + u32(e + 8);
      if (strStart + n > end) continue;
      let s = '';
      for (let j = 0; j < n; j++) {
        const c = bytes[strStart + j];
        if (c === 0) break;
        s += String.fromCharCode(c);
      }
      return s || null;
    }
    return null;
  };

  const isDateTime = (s: string | null): s is string =>
    !!s && /^\d{4}:\d{2}:\d{2} \d{2}:\d{2}(:\d{2})?$/.test(s);

  // EXIF IFD pointer (0x8769) in IFD0, then DateTimeOriginal there.
  let exifIfd = 0;
  if (ifd0 + 2 <= end) {
    const count = u16(ifd0);
    for (let i = 0; i < count; i++) {
      const e = ifd0 + 2 + i * 12;
      if (e + 12 > end) break;
      if (u16(e) === 0x8769) {
        exifIfd = tiffStart + u32(e + 8);
        break;
      }
    }
  }
  if (exifIfd > 0) {
    const dt = readAscii(exifIfd, 0x9003) ?? readAscii(exifIfd, 0x9004);
    if (isDateTime(dt)) return dt;
  }
  // Fallback: IFD0 DateTime.
  const dt0 = readAscii(ifd0, 0x0132);
  if (isDateTime(dt0)) return dt0;
  return null;
}

/**
 * "2026:10:21 14:30:05" -> "Oct 21, 2026, 2:30 PM".
 * The raw EXIF value is reformatted as-is (EXIF carries no timezone, and the
 * photos are taken in Robert's timezone), so no Date parsing that could
 * shift the time. Returns '' when unparseable.
 */
export function formatPhotoDateTime(raw: string | null | undefined): string {
  if (!raw) return '';
  const m = /^(\d{4}):(\d{2}):(\d{2}) (\d{2}):(\d{2})(?::(\d{2}))?$/.exec(raw.trim());
  if (!m) return '';
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const mon = Number(m[2]);
  const day = Number(m[3]);
  let hour = Number(m[4]);
  if (mon < 1 || mon > 12 || day < 1 || day > 31 || hour > 23 || Number(m[5]) > 59) return '';
  const ampm = hour >= 12 ? 'PM' : 'AM';
  hour = hour % 12;
  if (hour === 0) hour = 12;
  return `${months[mon - 1]} ${day}, ${m[1]}, ${hour}:${m[5]} ${ampm}`;
}

/**
 * Parse raw EXIF "YYYY:MM:DD HH:MM:SS" into a local-time Date (photos are
 * taken in Robert's timezone). Null when unparseable.
 */
export function exifRawToDate(raw: string | null | undefined): Date | null {
  if (!raw) return null;
  const m = /^(\d{4}):(\d{2}):(\d{2}) (\d{2}):(\d{2})(?::(\d{2}))?$/.exec(raw.trim());
  if (!m) return null;
  const d = new Date(
    Number(m[1]),
    Number(m[2]) - 1,
    Number(m[3]),
    Number(m[4]),
    Number(m[5]),
    Number(m[6] ?? '0'),
  );
  return Number.isNaN(d.getTime()) ? null : d;
}

/**
 * Format a millisecond duration as "47 min" / "1 hr 5 min".
 * '' when negative or invalid.
 */
export function formatDuration(ms: number): string {
  if (!Number.isFinite(ms) || ms < 0) return '';
  const mins = Math.round(ms / 60000);
  if (mins < 60) return `${mins} min`;
  const hrs = Math.floor(mins / 60);
  const rem = mins % 60;
  const hrLabel = hrs === 1 ? 'hr' : 'hrs';
  return rem === 0 ? `${hrs} ${hrLabel}` : `${hrs} ${hrLabel} ${rem} min`;
}

/**
 * ISO-8601 timestamp (e.g. the job's created_at) -> "Oct 21, 2026, 2:30 PM"
 * in the viewer's local timezone. Returns '' when unparseable.
 */
export function formatIsoDateTime(iso: string | null | undefined): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  let hour = d.getHours();
  const ampm = hour >= 12 ? 'PM' : 'AM';
  hour = hour % 12;
  if (hour === 0) hour = 12;
  const min = String(d.getMinutes()).padStart(2, '0');
  return `${months[d.getMonth()]} ${d.getDate()}, ${d.getFullYear()}, ${hour}:${min} ${ampm}`;
}

/**
 * Fetch the first 64KB of a photo URL (EXIF lives at the start of the file)
 * and extract its capture time. Null on any failure — a missing date must
 * never block the PDF.
 */
export async function fetchPhotoDateTime(url: string): Promise<string | null> {
  try {
    const res = await fetch(url, { headers: { Range: 'bytes=0-65535' } });
    if (!res.ok && res.status !== 206) return null;
    const buf = await res.arrayBuffer();
    if (!buf || buf.byteLength < 16) return null;
    return parseExifDateTime(buf);
  } catch {
    return null;
  }
}
