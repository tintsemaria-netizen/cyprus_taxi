import { promises as fs } from 'fs';
import path from 'path';
import { createHash } from 'crypto';
import { config } from '@/lib/config';

// Private document storage (Task 015 §6). Paths point at a runtime volume (PRIVATE_UPLOAD_DIR), never at
// build output, hence the turbopackIgnore hints (otherwise Turbopack traces the whole project).
// Files live OUTSIDE public/ and Git; served only
// via authenticated streaming. Validates real magic bytes (never trusts the client mime or
// filename) and rejects disguised executables/HTML/SVG.

const MAX_IMAGE = 10 * 1024 * 1024; // 10 MB
const MAX_PDF = 20 * 1024 * 1024; // 20 MB

export interface StoredDoc { storageKey: string; mime: string; sizeBytes: number; sha256: string }

// Detect a safe document type from the leading bytes. Returns null for anything else.
export function sniffMime(buf: Buffer): 'image/jpeg' | 'image/png' | 'application/pdf' | 'image/heic' | null {
  if (buf.length < 12) return null;
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'image/jpeg';
  if (buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47) return 'image/png';
  if (buf[0] === 0x25 && buf[1] === 0x50 && buf[2] === 0x44 && buf[3] === 0x46) return 'application/pdf'; // %PDF
  // ISO-BMFF (HEIC/HEIF): "ftyp" at offset 4 with a heic/heif/mif1 brand.
  if (buf.toString('ascii', 4, 8) === 'ftyp' && /heic|heif|mif1|msf1/.test(buf.toString('ascii', 8, 12))) return 'image/heic';
  return null;
}

function ext(mime: string): string {
  return { 'image/jpeg': 'jpg', 'image/png': 'png', 'application/pdf': 'pdf', 'image/heic': 'heic' }[mime] || 'bin';
}

export async function saveDocument(applicationId: string, docId: string, buf: Buffer): Promise<StoredDoc | { error: string }> {
  const mime = sniffMime(buf);
  if (!mime) return { error: 'Unsupported or unsafe file. Upload a JPG, PNG, PDF or HEIC photo/scan.' };
  const limit = mime === 'application/pdf' ? MAX_PDF : MAX_IMAGE;
  if (buf.length > limit) return { error: `File too large (max ${Math.round(limit / 1024 / 1024)} MB).` };
  const dir = path.join(/*turbopackIgnore: true*/ config.uploads.dir, applicationId);
  await fs.mkdir(dir, { recursive: true });
  const storageKey = path.join(/*turbopackIgnore: true*/ applicationId, `${docId}.${ext(mime)}`);
  await fs.writeFile(path.join(/*turbopackIgnore: true*/ config.uploads.dir, storageKey), buf, { mode: 0o600 });
  return { storageKey, mime, sizeBytes: buf.length, sha256: createHash('sha256').update(buf).digest('hex') };
}

// Read a stored file. Resolves under the uploads root only (guards against traversal).
export async function readDocument(storageKey: string): Promise<Buffer | null> {
  const root = path.resolve(/*turbopackIgnore: true*/ config.uploads.dir);
  const full = path.resolve(/*turbopackIgnore: true*/ root, storageKey);
  if (full !== root && !full.startsWith(root + path.sep)) return null; // path traversal guard
  try { return await fs.readFile(full); } catch { return null; }
}

// Delete one stored file (traversal-guarded). Used when a document is replaced.
export async function deleteDocumentFile(storageKey: string): Promise<void> {
  const root = path.resolve(/*turbopackIgnore: true*/ config.uploads.dir);
  const full = path.resolve(/*turbopackIgnore: true*/ root, storageKey);
  if (full === root || !full.startsWith(root + path.sep)) return;
  try { await fs.rm(full, { force: true }); } catch { /* ignore */ }
}

// List stored files as { storageKey, mtime } (for the orphan sweep).
export async function listStoredFiles(): Promise<{ storageKey: string; mtime: Date }[]> {
  const root = path.resolve(/*turbopackIgnore: true*/ config.uploads.dir);
  const out: { storageKey: string; mtime: Date }[] = [];
  let dirs: string[] = [];
  try { dirs = await fs.readdir(root); } catch { return out; }
  for (const d of dirs) {
    let files: string[] = [];
    try { files = await fs.readdir(path.join(/*turbopackIgnore: true*/ root, d)); } catch { continue; }
    for (const f of files) {
      try { const st = await fs.stat(path.join(/*turbopackIgnore: true*/ root, d, f)); if (st.isFile()) out.push({ storageKey: path.join(/*turbopackIgnore: true*/ d, f), mtime: st.mtime }); } catch { /* raced */ }
    }
  }
  return out;
}

export async function deleteApplicationFiles(applicationId: string): Promise<void> {
  try { await fs.rm(path.join(/*turbopackIgnore: true*/ config.uploads.dir, applicationId), { recursive: true, force: true }); } catch { /* ignore */ }
}
