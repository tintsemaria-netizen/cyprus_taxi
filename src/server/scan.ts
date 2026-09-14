import net from 'net';
import { config } from '@/lib/config';

// Malware scan via clamd INSTREAM (Task 015). Returns UNAVAILABLE when no scanner is
// configured/reachable — callers must NOT accept/approve an unscanned document.
export type ScanStatus = 'CLEAN' | 'INFECTED' | 'UNAVAILABLE';

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
    sock.on('end', () => { clearTimeout(t); finish(/FOUND/.test(resp) ? 'INFECTED' : /OK/.test(resp) ? 'CLEAN' : 'UNAVAILABLE'); });
  });
}
