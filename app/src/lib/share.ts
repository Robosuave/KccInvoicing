/**
 * Web Share API helpers for the board-up job screen ("Text + PDF", "Share photos").
 * On mobile this opens the native share sheet (Messages, Mail, Drive, …) with
 * the files attached. Desktop browsers mostly can't share files — callers
 * should check canShareFiles() first and show a fallback message.
 */

export function canShareFiles(files: File[]): boolean {
  if (typeof navigator === 'undefined' || files.length === 0) return false;
  const nav = navigator as Navigator & {
    canShare?: (data: { files: File[] }) => boolean;
    share?: (data: { files?: File[]; title?: string; text?: string }) => Promise<void>;
  };
  return typeof nav.canShare === 'function' && typeof nav.share === 'function' && nav.canShare({ files });
}

/** Shares files via the native sheet. Returns 'cancelled' if the user dismissed it. */
export async function shareFiles(args: {
  files: File[];
  title?: string;
  text?: string;
}): Promise<'shared' | 'cancelled'> {
  const nav = navigator as Navigator & {
    share: (data: { files?: File[]; title?: string; text?: string }) => Promise<void>;
  };
  try {
    await nav.share({ files: args.files, title: args.title, text: args.text });
    return 'shared';
  } catch (e) {
    if (e instanceof DOMException && e.name === 'AbortError') return 'cancelled';
    throw e;
  }
}

/** Fetches a (signed) URL and wraps it as a File for sharing. */
export async function urlToFile(url: string, filename: string, fallbackType: string): Promise<File> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Could not fetch ${filename} (HTTP ${res.status}).`);
  const blob = await res.blob();
  return new File([blob], filename, { type: blob.type || fallbackType });
}
