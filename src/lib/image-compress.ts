'use client';

// Phone photos of documents are often 4-12 MB, but the public nginx vhost accepts at most 2 MB per
// request (client_max_body_size 2m), so uploads failed with 413 (2026-10-01 audit). Re-encode large
// images in the browser: longest side ≤ 2400 px (documents stay legible), JPEG, stepping quality
// down until under the target. Anything we cannot decode (e.g. HEIC on most browsers) is returned
// unchanged and the server/nginx limits still apply.

export const UPLOAD_TARGET_BYTES = 1_900_000;

export async function compressImageForUpload(file: File, target = UPLOAD_TARGET_BYTES): Promise<Blob> {
  if (!file.type.startsWith('image/') || file.size <= target * 0.8) return file;
  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
  } catch {
    return file;
  }
  try {
    for (const maxSide of [2400, 2000, 1600]) {
      const scale = Math.min(1, maxSide / Math.max(bitmap.width, bitmap.height));
      const w = Math.round(bitmap.width * scale);
      const h = Math.round(bitmap.height * scale);
      const canvas = document.createElement('canvas');
      canvas.width = w; canvas.height = h;
      const g = canvas.getContext('2d');
      if (!g) return file;
      g.drawImage(bitmap, 0, 0, w, h);
      for (const q of [0.85, 0.75, 0.65]) {
        const blob = await new Promise<Blob | null>((res) => canvas.toBlob(res, 'image/jpeg', q));
        if (blob && blob.size <= target) return blob;
      }
    }
    return file;
  } finally {
    bitmap.close();
  }
}
