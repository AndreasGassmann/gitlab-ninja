type Listener = (changes: Record<string, { newValue?: any; oldValue?: any }>, area: string) => void;

let syncStore: Record<string, any> = {};
let localStore: Record<string, any> = {};
let listeners: Listener[] = [];

function makeArea(store: Record<string, any>, area: string) {
  return {
    get(keys: any, cb: (items: Record<string, any>) => void) {
      if (keys === undefined || keys === null) {
        cb({ ...store });
        return;
      }
      const list = typeof keys === 'string' ? [keys] : Array.isArray(keys) ? keys : Object.keys(keys);
      const out: Record<string, any> = {};
      for (const k of list) if (k in store) out[k] = store[k];
      cb(out);
    },
    set(items: Record<string, any>, cb?: () => void) {
      const changes: Record<string, { newValue?: any; oldValue?: any }> = {};
      for (const k of Object.keys(items)) {
        changes[k] = { oldValue: store[k], newValue: items[k] };
        store[k] = items[k];
      }
      listeners.forEach((l) => l(changes, area));
      cb?.();
    },
  };
}

export function installChromeMock(): {
  store: Record<string, any>;
  localStore: Record<string, any>;
} {
  syncStore = {};
  localStore = {};
  listeners = [];
  (globalThis as any).chrome = {
    storage: {
      sync: makeArea(syncStore, 'sync'),
      local: makeArea(localStore, 'local'),
      onChanged: {
        addListener: (l: Listener) => listeners.push(l),
        removeListener: (l: Listener) => {
          listeners = listeners.filter((x) => x !== l);
        },
      },
    },
  };
  return { store: syncStore, localStore };
}

export function resetChromeMock(): void {
  syncStore = {};
  localStore = {};
  listeners = [];
}
