const DEBUG_KEY = 'gitlab-ninja-debug';

function isDebug(): boolean {
  try {
    return localStorage.getItem(DEBUG_KEY) === 'true';
  } catch {
    return false;
  }
}

export function debugLog(...args: unknown[]): void {
  if (isDebug()) console.log(...args);
}

export function debugWarn(...args: unknown[]): void {
  if (isDebug()) console.warn(...args);
}

export function debugError(...args: unknown[]): void {
  if (isDebug()) console.error(...args);
}
