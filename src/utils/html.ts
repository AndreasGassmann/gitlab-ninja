/**
 * Shared HTML/URL escaping helpers.
 *
 * These back every string interpolated into `innerHTML` across the extension's
 * privileged pages, so keep them correct and in one place.
 */

/**
 * Escape a string for safe insertion into HTML text nodes AND quoted attribute
 * values. Quotes are escaped too — a value like `" onerror=...` must not be able
 * to break out of `attr="..."`.
 */
export function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * Neutralize dangerous URL schemes (e.g. `javascript:`) before a value is used
 * as an `href`/`src`. Entity-escaping cannot do this — no special characters are
 * required for a scheme-based payload. Allows only http(s); anything else (or an
 * unparseable value) collapses to a harmless `#`. Still pass the result through
 * escapeHtml at the attribute sink for quote-safety.
 */
export function safeUrl(url: string): string {
  try {
    const base = typeof location !== 'undefined' ? location.href : undefined;
    const u = new URL(url, base);
    return u.protocol === 'http:' || u.protocol === 'https:' ? url : '#';
  } catch {
    return '#';
  }
}
