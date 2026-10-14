import { describe, expect, it } from 'vitest';
import { pdfPhotoTargetSize } from '../pdf/service';

describe('pdfPhotoTargetSize', () => {
  it('leaves small photos untouched', () => {
    expect(pdfPhotoTargetSize(800, 600)).toEqual({ w: 800, h: 600 });
  });

  it('downscales a 12MP phone photo (4000x3000) to 900 on the long side', () => {
    expect(pdfPhotoTargetSize(4000, 3000)).toEqual({ w: 900, h: 675 });
  });

  it('downscales portrait photos on the long side too', () => {
    expect(pdfPhotoTargetSize(3000, 4000)).toEqual({ w: 675, h: 900 });
  });

  it('keeps the aspect ratio for panoramas', () => {
    const { w, h } = pdfPhotoTargetSize(6000, 1000);
    expect(w).toBe(900);
    expect(h).toBe(150);
  });

  it('never upscales', () => {
    expect(pdfPhotoTargetSize(100, 80)).toEqual({ w: 100, h: 80 });
  });
});
