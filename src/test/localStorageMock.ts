/** Minimal in-memory localStorage for node-env vitest runs. */
export function installLocalStorageMock(): { store: Record<string, string> } {
  const store: Record<string, string> = {};
  const mock = {
    getItem: (k: string): string | null => (k in store ? store[k] : null),
    setItem: (k: string, v: string): void => {
      store[k] = String(v);
    },
    removeItem: (k: string): void => {
      delete store[k];
    },
    clear: (): void => {
      for (const k of Object.keys(store)) delete store[k];
    },
  };
  (globalThis as any).localStorage = mock;
  return { store };
}
