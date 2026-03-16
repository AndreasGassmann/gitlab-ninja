/**
 * DOM manipulation utilities
 */

/**
 * Debounce function to limit rapid function calls
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function debounce<T extends (...args: any[]) => any>(
  func: T,
  wait: number
): (...args: Parameters<T>) => void {
  let timeout: number | null = null;

  return function executedFunction(...args: Parameters<T>): void {
    const later = () => {
      timeout = null;
      func(...args);
    };

    if (timeout !== null) {
      clearTimeout(timeout);
    }
    timeout = setTimeout(later, wait);
  };
}

/**
 * Wait for a DOM element matching the selector to appear.
 * Uses MutationObserver for efficiency, with a configurable timeout.
 * Resolves with the element, or null if it times out.
 */
export function waitForElement<T extends Element = Element>(
  selector: string,
  timeoutMs = 30000
): Promise<T | null> {
  const existing = document.querySelector<T>(selector);
  if (existing) return Promise.resolve(existing);

  return new Promise((resolve) => {
    let resolved = false;
    const observer = new MutationObserver(() => {
      const el = document.querySelector<T>(selector);
      if (el) {
        resolved = true;
        observer.disconnect();
        resolve(el);
      }
    });
    observer.observe(document.documentElement, { childList: true, subtree: true });

    setTimeout(() => {
      if (!resolved) {
        observer.disconnect();
        resolve(null);
      }
    }, timeoutMs);
  });
}
