/**
 * Supplementary browser fingerprint hash used solely as an anti-abuse signal
 * alongside mandatory Supabase Auth, provider identity linking, and DB constraints.
 */
export async function getDeviceFingerprintHash(): Promise<string> {
  try {
    const components = [
      navigator.userAgent || '',
      navigator.language || '',
      `${screen.width}x${screen.height}x${screen.colorDepth}`,
      Intl.DateTimeFormat().resolvedOptions().timeZone || '',
      String(navigator.hardwareConcurrency || 0),
      String(navigator.maxTouchPoints || 0),
    ].join('|');

    const encoded = new TextEncoder().encode(components);
    const digest = await crypto.subtle.digest('SHA-256', encoded);
    return Array.from(new Uint8Array(digest))
      .map((b) => b.toString(16).padStart(2, '0'))
      .join('');
  } catch {
    return 'unavailable';
  }
}
