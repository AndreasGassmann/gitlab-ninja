/**
 * When the GitLab instance is unreachable (VPN down, host offline, DNS failure)
 * `fetch()` rejects with a TypeError whose message is the cryptic "Failed to
 * fetch" rather than a normal HTTP error. These helpers detect that case and
 * render a human-readable message plus a Retry button, instead of dumping the
 * raw browser error onto the user.
 */

import { escapeHtml } from './html';

/** True when `err` looks like a network/connection failure (not an HTTP error). */
export function isConnectionError(err: unknown): boolean {
  if (err instanceof TypeError) return true;
  const msg = err instanceof Error ? err.message : String(err);
  return /failed to fetch|networkerror|network error|load failed|err_/i.test(msg);
}

/** Best-effort host label ("gitlab.example.com") for display. */
function hostLabel(url: string | null | undefined): string {
  if (!url) return 'your GitLab instance';
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
}

export interface ConnectionErrorOptions {
  /** GitLab base URL — used to show which host could not be reached. */
  url: string | null | undefined;
  /** Called when the user clicks Retry. */
  onRetry: () => void;
  /** Picks the button class so it matches the host page's styling. */
  variant: 'popup' | 'options';
}

/**
 * Replaces `container`'s contents with a connection-error panel and wires up
 * its Retry button to `onRetry`.
 */
export function renderConnectionError(
  container: HTMLElement,
  opts: ConnectionErrorOptions
): void {
  const host = hostLabel(opts.url);
  const btnClass =
    opts.variant === 'options' ? 'btn-primary' : 'onboarding-btn-primary';
  container.innerHTML = `
    <div class="gn-conn-error">
      <div class="gn-conn-error-icon">&#128268;</div>
      <div class="gn-conn-error-title">Could not connect to ${escapeHtml(host)}</div>
      <div class="gn-conn-error-hint">Make sure it's reachable — check that your VPN is connected.</div>
      <button type="button" class="${btnClass} gn-conn-retry">Retry</button>
    </div>`;
  const btn = container.querySelector<HTMLButtonElement>('.gn-conn-retry');
  btn?.addEventListener('click', () => opts.onRetry());
}
