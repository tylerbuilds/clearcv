// Contact links are explicit and never infer links in arbitrary CV text.
export function safeContactHref(kind, value) {
  if (typeof value !== 'string') return null;
  const text = value.trim();
  if (!text || /[\u0000-\u0020\u007f]/.test(text)) return null;
  if (kind === 'email') {
    if (!/^[A-Za-z0-9.!#$%&'*+/=?^_`{|}~-]+@[A-Za-z0-9](?:[A-Za-z0-9.-]*[A-Za-z0-9])?\.[A-Za-z]{2,63}$/.test(text) || text.includes('..')) return null;
    return `mailto:${encodeURIComponent(text).replace('%40', '@')}`;
  }
  if (kind !== 'website' || text.startsWith('//') || text.includes('\\')) return null;
  try {
    const explicit = /^[A-Za-z][A-Za-z0-9+.-]*:/.test(text);
    const url = new URL(explicit ? text : `https://${text}`);
    if (!['https:', 'http:'].includes(url.protocol) || !url.hostname || url.username || url.password) return null;
    if (!url.hostname.includes('.') && url.hostname !== 'localhost' && !url.hostname.startsWith('[')) return null;
    if (url.hostname.includes('..') || url.hostname.startsWith('.') || url.hostname.endsWith('.')) return null;
    return url.href;
  } catch { return null; }
}
