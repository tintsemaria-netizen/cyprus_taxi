import net from 'net';
import { config } from '@/lib/config';

// Malware scan via clamd INSTREAM (Task 015). Returns UNAVAILABLE when no scanner is
// configured/reachable — callers must NOT accept/approve an unscanned document.
// Launch fixes §3: UNAVAILABLE = scanner not reachable yet (pending — rescanned by maintenance),
// ERROR = scanner answered with an error (e.g. size limit). Only CLEAN can be accepted/approved.
export type ScanStatus = 'CLEAN' | 'INFECTED' | 'UNAVAILABLE' | 'ERROR';

export function scannerConfigured(): boolean {
  return !!config.clamav.host;
}

export async function scanFile(buf: Buffer): Promise<ScanStatus> {
  if (!config.clamav.host) return 'UNAVAILABLE';
  return new Promise<ScanStatus>((resolve) => {
    let resp = '';
    let done = false;
    const sock = net.connect(config.clamav.port, config.clamav.host);
    const finish = (v: ScanStatus) => { if (!done) { done = true; try { sock.destroy(); } catch { /* */ } resolve(v); } };
    const t = setTimeout(() => finish('UNAVAILABLE'), 10000);
    sock.on('error', () => { clearTimeout(t); finish('UNAVAILABLE'); });
    sock.on('connect', () => {
      sock.write('zINSTREAM\0');
      const size = Buffer.alloc(4); size.writeUInt32BE(buf.length, 0);
      sock.write(size); sock.write(buf);
      sock.write(Buffer.alloc(4)); // zero-length chunk terminates the stream
    });
    sock.on('data', (d) => { resp += d.toString(); });
    sock.on('end', () => { clearTimeout(t); finish(/FOUND/.test(resp) ? 'INFECTED' : /\bOK\b/.test(resp) ? 'CLEAN' : /ERROR/.test(resp) ? 'ERROR' : 'UNAVAILABLE'); });
  });
}

/**
 * Launch fixes §3: documents stored while the scanner was down (UNAVAILABLE) are scanned again by
 * the maintenance cycle once a scanner is configured. An infected file is deleted and flagged for
 * the applicant to re-upload; nothing is ever auto-accepted.
 */
export async function rescanPendingDocuments(limit = 20): Promise<{ scanned: number; infected: number }> {
  if (!scannerConfigured()) return { scanned: 0, infected: 0 };
  const { prisma } = await import('@/lib/db');
  const { readDocument, deleteDocumentFile } = await import('@/server/storage');
  const docs = await prisma.applicationDocument.findMany({ where: { scanStatus: { in: ['UNAVAILABLE', 'UNScanned'] } }, orderBy: { createdAt: 'asc' }, take: limit });
  let scanned = 0, infected = 0;
  for (const d of docs) {
    const buf = await readDocument(d.storageKey);
    if (!buf) continue;
    const st = await scanFile(buf);
    if (st === 'UNAVAILABLE') break; // scanner still down — try next cycle
    scanned++;
    if (st === 'INFECTED') {
      infected++;
      await deleteDocumentFile(d.storageKey).catch(() => {});
      await prisma.applicationDocument.update({ where: { id: d.id }, data: { scanStatus: 'INFECTED', decision: 'CHANGES', decisionNote: 'File failed the malware check — please upload it again.' } });
    } else {
      await prisma.applicationDocument.update({ where: { id: d.id }, data: { scanStatus: st } });
    }
  }
  return { scanned, infected };
}
