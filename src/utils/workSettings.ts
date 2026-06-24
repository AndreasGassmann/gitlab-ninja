/**
 * Work settings — user-configurable time-tracking defaults.
 * Follows the themeManager pattern (typed interface + defaults + async load /
 * sync save) plus a synchronous in-memory cache, because time.ts is pure & sync.
 */

export interface WorkSettings {
  dayStartTime: string; // "HH:MM" — default timelog time + calendar scroll anchor
  dailyTargetSeconds: number; // board daily work target
  warningThreshold: number; // 0..1 — estimate-spent "warning" status
  weekendDays: number[]; // 0 = Mon … 6 = Sun
  timeIncrementMinutes: number; // calendar snap + time-picker step
  hoursPerDay: number; // estimate unit conversion (1d)
  hoursPerWeek: number; // estimate unit conversion (1w)
}

export const DEFAULT_WORK_SETTINGS: WorkSettings = {
  dayStartTime: '09:00',
  dailyTargetSeconds: 30240,
  warningThreshold: 0.8,
  weekendDays: [5, 6],
  timeIncrementMinutes: 15,
  hoursPerDay: 8,
  hoursPerWeek: 40,
};

const STORAGE_KEY = 'workSettings';

let cache: WorkSettings = { ...DEFAULT_WORK_SETTINGS };
let listenerWired = false;

export function loadWorkSettings(): Promise<WorkSettings> {
  return new Promise((resolve) => {
    chrome.storage.sync.get(STORAGE_KEY, (result) => {
      resolve({ ...DEFAULT_WORK_SETTINGS, ...(result[STORAGE_KEY] || {}) });
    });
  });
}

export function saveWorkSettings(settings: WorkSettings): void {
  cache = { ...settings };
  chrome.storage.sync.set({ [STORAGE_KEY]: settings });
}

export async function initWorkSettings(): Promise<void> {
  cache = await loadWorkSettings();
  if (!listenerWired) {
    chrome.storage.onChanged.addListener((changes, area) => {
      if (area === 'sync' && changes[STORAGE_KEY]) {
        cache = { ...DEFAULT_WORK_SETTINGS, ...(changes[STORAGE_KEY].newValue || {}) };
      }
    });
    listenerWired = true;
  }
}

export function getWorkSettings(): WorkSettings {
  return cache;
}
