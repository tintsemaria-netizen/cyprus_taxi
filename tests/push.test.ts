import { describe, it, expect } from 'vitest';
import { isSafePushEndpoint } from '@/server/push';

describe('push endpoint SSRF validation', () => {
  it('accepts real public HTTPS push hosts', () => {
    expect(isSafePushEndpoint('https://fcm.googleapis.com/fcm/send/abc123')).toBe(true);
    expect(isSafePushEndpoint('https://updates.push.services.mozilla.com/wpush/v2/xyz')).toBe(true);
    expect(isSafePushEndpoint('https://web.push.apple.com/QABC')).toBe(true);
  });

  it('rejects non-https, loopback, private and IP-literal destinations', () => {
    expect(isSafePushEndpoint('http://fcm.googleapis.com/x')).toBe(false); // not https
    expect(isSafePushEndpoint('https://localhost/x')).toBe(false);
    expect(isSafePushEndpoint('https://server.local/x')).toBe(false);
    expect(isSafePushEndpoint('https://127.0.0.1/x')).toBe(false); // loopback IP
    expect(isSafePushEndpoint('https://10.0.0.5/x')).toBe(false); // private IP
    expect(isSafePushEndpoint('https://169.254.169.254/latest/meta-data')).toBe(false); // cloud metadata
    expect(isSafePushEndpoint('https://[::1]/x')).toBe(false); // IPv6 loopback
    expect(isSafePushEndpoint('not-a-url')).toBe(false);
  });
});
