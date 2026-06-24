type Listener = (changes: Record<string, { newValue?: any; oldValue?: any }>, area: string) => void;

let store: Record<string, any> = {};
let listeners: Listener[] = [];

export function installChromeMock(): { store: Record<string, any> } {
  store = {};
  listeners = [];
  const sync = {
    get(keys: any, cb: (items: Record<string, any>) => void) {
      const key = typeof keys === 'string' ? keys : Array.isArray(keys) ? keys[0] : undefined;
      cb(key === undefined ? { ...store } : { [key]: store[key] });
    },
    set(items: Record<string, any>, cb?: () => void) {
      const changes: Record<string, { newValue?: any; oldValue?: any }> = {};
      for (const k of Object.keys(items)) {
        changes[k] = { oldValue: store[k], newValue: items[k] };
        store[k] = items[k];
      }
      listeners.forEach((l) => l(changes, 'sync'));
      cb?.();
    },
  };
  (globalThis as any).chrome = {
    storage: {
      sync,
      onChanged: {
        addListener: (l: Listener) => listeners.push(l),
        removeListener: (l: Listener) => {
          listeners = listeners.filter((x) => x !== l);
        },
      },
    },
  };
  return { store };
}

export function resetChromeMock(): void {
  store = {};
  listeners = [];
}
