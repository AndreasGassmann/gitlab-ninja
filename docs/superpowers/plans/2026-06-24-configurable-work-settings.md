# Configurable Work Settings Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Promote seven hardcoded constants to user-configurable settings exposed in a new "Work" tab on the options page, with defaults equal to current values (zero behavior change until opt-in).

**Architecture:** A new `src/utils/workSettings.ts` module owns a typed settings object stored under one `chrome.storage.sync` key, following the existing `themeManager.ts` pattern (typed interface + `DEFAULT_*` + async load / sync save) plus a synchronous in-memory cache so the pure functions in `time.ts` stay synchronous. Each entry point awaits `initWorkSettings()` at startup; a `storage.onChanged` listener keeps the cache live.

**Tech Stack:** TypeScript, webpack, Chrome extension (MV3) APIs (`chrome.storage.sync`, `chrome.storage.onChanged`), Vitest (added in Task 1).

## Global Constraints

- Defaults MUST equal current hardcoded values exactly: `dayStartTime="09:00"`, `dailyTargetSeconds=30240`, `warningThreshold=0.8`, `weekendDays=[5,6]`, `timeIncrementMinutes=15`, `hoursPerDay=8`, `hoursPerWeek=40`.
- Weekday index convention is **Mon=0 … Sun=6** (matches existing `DAY_NAMES`). Weekend default `[5,6]` = Sat, Sun.
- Storage key: `workSettings` in `chrome.storage.sync`. Do NOT touch `notificationSettings`.
- `time.ts` public signatures (`parseTimeToHours`, `formatHours`) MUST NOT change — 20 call sites depend on them.
- `getWorkSettings()` must never throw; before `initWorkSettings()` resolves it returns `DEFAULT_WORK_SETTINGS`.
- Every task ends green on `npm run check` (type-check + lint + format:check + build).
- No `Co-Authored-By` / AI attribution in commits.

---

## File Structure

- **Create** `src/utils/workSettings.ts` — settings type, defaults, load/save, sync cache, init, onChanged wiring.
- **Create** `vitest.config.ts`, `src/test/chromeMock.ts` — test infra (Task 1).
- **Create** `src/utils/workSettings.test.ts`, `src/utils/time.test.ts` — unit tests.
- **Modify** `src/utils/time.ts` — read `hoursPerDay`/`hoursPerWeek` from cache.
- **Modify** `src/background.ts`, `src/content.ts`, `src/options.ts`, `src/popup.ts` — `await initWorkSettings()` at startup.
- **Modify** `src/features/boardSettings.ts` — daily target from settings.
- **Modify** `src/features/timeTracking.ts` — warning threshold from settings.
- **Modify** `src/features/editMode.ts` — time-picker step from settings.
- **Modify** `src/options.ts` — day start, calendar scroll, weekend days, calendar snap.
- **Modify** `src/options.html` + `src/options.ts` — new "Work" settings tab UI.

---

## Task 1: Test infrastructure (Vitest + chrome mock)

**Files:**
- Modify: `package.json` (add devDeps + `test` script)
- Create: `vitest.config.ts`
- Create: `src/test/chromeMock.ts`

**Interfaces:**
- Produces: `installChromeMock(): { store: Record<string, any> }` — installs a fake `globalThis.chrome.storage.sync`/`onChanged`; returns the backing store for assertions/seed. `resetChromeMock()` clears it.

- [ ] **Step 1: Add Vitest dev dependencies**

Run:
```bash
npm install -D vitest@^2 jsdom@^25
```

- [ ] **Step 2: Add test script to package.json**

In `package.json` `"scripts"`, add:
```json
"test": "vitest run",
"test:watch": "vitest"
```

- [ ] **Step 3: Create `vitest.config.ts`**

```ts
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
  },
});
```

- [ ] **Step 4: Create `src/test/chromeMock.ts`**

```ts
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
```

- [ ] **Step 5: Verify the test runner starts**

Run: `npm test`
Expected: exit 0 with "No test files found" (or a passing run once tests exist). If it errors on config, fix before continuing.

- [ ] **Step 6: Commit**

```bash
git add package.json package-lock.json vitest.config.ts src/test/chromeMock.ts
git commit -m "test: add Vitest with chrome.storage mock"
```

---

## Task 2: `workSettings` module

**Files:**
- Create: `src/utils/workSettings.ts`
- Test: `src/utils/workSettings.test.ts`

**Interfaces:**
- Produces:
  - `interface WorkSettings { dayStartTime: string; dailyTargetSeconds: number; warningThreshold: number; weekendDays: number[]; timeIncrementMinutes: number; hoursPerDay: number; hoursPerWeek: number; }`
  - `const DEFAULT_WORK_SETTINGS: WorkSettings`
  - `loadWorkSettings(): Promise<WorkSettings>`
  - `saveWorkSettings(s: WorkSettings): void`
  - `initWorkSettings(): Promise<void>`
  - `getWorkSettings(): WorkSettings`

- [ ] **Step 1: Write failing tests**

Create `src/utils/workSettings.test.ts`:
```ts
import { describe, it, expect, beforeEach } from 'vitest';
import { installChromeMock } from '../test/chromeMock';
import {
  DEFAULT_WORK_SETTINGS,
  loadWorkSettings,
  saveWorkSettings,
  initWorkSettings,
  getWorkSettings,
} from './workSettings';

describe('workSettings', () => {
  beforeEach(() => installChromeMock());

  it('getWorkSettings returns defaults before init', () => {
    expect(getWorkSettings()).toEqual(DEFAULT_WORK_SETTINGS);
  });

  it('loadWorkSettings returns defaults when nothing stored', async () => {
    expect(await loadWorkSettings()).toEqual(DEFAULT_WORK_SETTINGS);
  });

  it('loadWorkSettings merges a partial stored object over defaults', async () => {
    saveWorkSettings({ ...DEFAULT_WORK_SETTINGS, hoursPerDay: 7 });
    const loaded = await loadWorkSettings();
    expect(loaded.hoursPerDay).toBe(7);
    expect(loaded.hoursPerWeek).toBe(40);
  });

  it('init populates the sync cache', async () => {
    saveWorkSettings({ ...DEFAULT_WORK_SETTINGS, warningThreshold: 0.5 });
    await initWorkSettings();
    expect(getWorkSettings().warningThreshold).toBe(0.5);
  });

  it('cache updates live when storage changes', async () => {
    await initWorkSettings();
    saveWorkSettings({ ...DEFAULT_WORK_SETTINGS, timeIncrementMinutes: 30 });
    expect(getWorkSettings().timeIncrementMinutes).toBe(30);
  });
});
```

- [ ] **Step 2: Run tests, verify they fail**

Run: `npm test -- src/utils/workSettings.test.ts`
Expected: FAIL — cannot find module `./workSettings`.

- [ ] **Step 3: Implement the module**

Create `src/utils/workSettings.ts`:
```ts
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
```

- [ ] **Step 4: Run tests, verify they pass**

Run: `npm test -- src/utils/workSettings.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add src/utils/workSettings.ts src/utils/workSettings.test.ts
git commit -m "feat: add workSettings module with sync cache"
```

---

## Task 3: Wire `time.ts` to `hoursPerDay` / `hoursPerWeek`

**Files:**
- Modify: `src/utils/time.ts`
- Test: `src/utils/time.test.ts`

**Interfaces:**
- Consumes: `getWorkSettings()` from Task 2.
- Produces: unchanged signatures `parseTimeToHours(timeStr): number`, `formatHours(hours): number`.

- [ ] **Step 1: Write failing tests**

Create `src/utils/time.test.ts`:
```ts
import { describe, it, expect, beforeEach } from 'vitest';
import { installChromeMock } from '../test/chromeMock';
import { DEFAULT_WORK_SETTINGS, saveWorkSettings, initWorkSettings } from './workSettings';
import { parseTimeToHours, formatHours } from './time';

describe('time conversions honor workSettings', () => {
  beforeEach(() => installChromeMock());

  it('uses default 8h/day, 40h/week', async () => {
    await initWorkSettings();
    expect(parseTimeToHours('1d')).toBe(8);
    expect(parseTimeToHours('1w')).toBe(40);
    expect(formatHours(8)).toBe('1d');
    expect(formatHours(40)).toBe('1w');
  });

  it('honors custom 6h/day, 30h/week', async () => {
    saveWorkSettings({ ...DEFAULT_WORK_SETTINGS, hoursPerDay: 6, hoursPerWeek: 30 });
    await initWorkSettings();
    expect(parseTimeToHours('1d')).toBe(6);
    expect(parseTimeToHours('1w')).toBe(30);
    expect(formatHours(6)).toBe('1d');
    expect(formatHours(30)).toBe('1w');
  });
});
```

- [ ] **Step 2: Run tests, verify they fail**

Run: `npm test -- src/utils/time.test.ts`
Expected: FAIL — custom-values case returns 8/40 (still hardcoded).

- [ ] **Step 3: Update `time.ts`**

Add the import at the top (after the existing `TimeUnit` import):
```ts
import { getWorkSettings } from './workSettings';
```

Replace `parseTimeToHours` body's switch with cache-driven conversions:
```ts
  const { hoursPerDay, hoursPerWeek } = getWorkSettings();
  switch (unit) {
    case 'w':
      return value * hoursPerWeek;
    case 'd':
      return value * hoursPerDay;
    case 'h':
      return value;
    case 'm':
      return value / 60;
    default:
      return 0;
  }
```

Replace the magic numbers in `formatHours`:
```ts
export function formatHours(hours: number): string {
  if (hours === 0) return '0h';
  const { hoursPerDay, hoursPerWeek } = getWorkSettings();

  if (hours >= hoursPerWeek) {
    const weeks = Math.floor(hours / hoursPerWeek);
    const remainingHours = hours % hoursPerWeek;
    return remainingHours > 0 ? `${weeks}w ${remainingHours}h` : `${weeks}w`;
  }

  if (hours >= hoursPerDay) {
    const days = Math.floor(hours / hoursPerDay);
    const remainingHours = hours % hoursPerDay;
    return remainingHours > 0 ? `${days}d ${remainingHours}h` : `${days}d`;
  }

  return `${hours}h`;
}
```

- [ ] **Step 4: Run tests, verify they pass**

Run: `npm test -- src/utils/time.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add src/utils/time.ts src/utils/time.test.ts
git commit -m "feat: drive time.ts conversions from work settings"
```

---

## Task 4: Initialize the cache at every entry point

**Files:**
- Modify: `src/options.ts:3162` (DOMContentLoaded handler)
- Modify: `src/popup.ts:1341` (DOMContentLoaded handler)
- Modify: `src/content.ts` (top-level init)
- Modify: `src/background.ts` (alarm handler that formats hours)

**Interfaces:**
- Consumes: `initWorkSettings()` from Task 2.

- [ ] **Step 1: options.ts**

Add import near the other util imports:
```ts
import { initWorkSettings } from './utils/workSettings';
```
Inside the `document.addEventListener('DOMContentLoaded', async () => {` body (line ~3162), as the FIRST awaited call:
```ts
  await initWorkSettings();
```

- [ ] **Step 2: popup.ts**

Add import:
```ts
import { initWorkSettings } from './utils/workSettings';
```
Inside the `DOMContentLoaded` async handler (line ~1341), first line of the body:
```ts
  await initWorkSettings();
```

- [ ] **Step 3: content.ts**

Add import alongside the themeManager imports:
```ts
import { initWorkSettings } from './utils/workSettings';
```
Add a top-level init (near the existing `loadCustomColors().then(...)` at line ~52) so the cache warms before features run:
```ts
initWorkSettings();
```
Then, inside the main feature-init `DOMContentLoaded` handler (line ~310), make the callback `async` and await before feature work:
```ts
  document.addEventListener('DOMContentLoaded', async () => {
    await initWorkSettings();
    debugLog('GitLab Ninja: DOMContentLoaded fired');
    // ...existing body...
```
(The top-level call + the awaited call share the wired listener; the second `initWorkSettings()` just re-reads — cheap and guarantees ordering.)

- [ ] **Step 4: background.ts**

Add import:
```ts
import { initWorkSettings } from './utils/workSettings';
```
In the alarm/notification handler that calls `formatHours`/`parseTimeToHours`, `await initWorkSettings();` before computing hours (service workers restart, so warm the cache per handler invocation).

- [ ] **Step 5: Verify build + types**

Run: `npm run type-check && npm run build`
Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add src/options.ts src/popup.ts src/content.ts src/background.ts
git commit -m "feat: initialize work settings cache at entry points"
```

---

## Task 5: Daily target from settings (`boardSettings.ts`)

**Files:**
- Modify: `src/features/boardSettings.ts:15` and its usage

- [ ] **Step 1: Find the usage**

Run: `grep -n "DAILY_TARGET_SECONDS" src/features/boardSettings.ts`
Expected: the `const` at line 15 plus one or more usages.

- [ ] **Step 2: Replace the constant with a settings read**

Add import at top:
```ts
import { getWorkSettings } from '../utils/workSettings';
```
Delete the line:
```ts
const DAILY_TARGET_SECONDS = 30240; // 8h 24m
```
At each usage site, replace `DAILY_TARGET_SECONDS` with `getWorkSettings().dailyTargetSeconds`.

- [ ] **Step 3: Verify build**

Run: `npm run type-check && npm run build`
Expected: no errors (no remaining reference to `DAILY_TARGET_SECONDS`).

- [ ] **Step 4: Commit**

```bash
git add src/features/boardSettings.ts
git commit -m "feat: board daily target from work settings"
```

---

## Task 6: Warning threshold from settings (`timeTracking.ts`)

**Files:**
- Modify: `src/features/timeTracking.ts:125`

- [ ] **Step 1: Add import**

```ts
import { getWorkSettings } from '../utils/workSettings';
```

- [ ] **Step 2: Replace the literal**

At line 125, change:
```ts
    if (t.spent < t.estimate && t.spent / t.estimate > 0.8) return 'warning';
```
to:
```ts
    if (t.spent < t.estimate && t.spent / t.estimate > getWorkSettings().warningThreshold)
      return 'warning';
```

- [ ] **Step 3: Verify build**

Run: `npm run type-check && npm run build`
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add src/features/timeTracking.ts
git commit -m "feat: estimate warning threshold from work settings"
```

---

## Task 7: Day start time + calendar scroll (`options.ts`)

**Files:**
- Modify: `src/options.ts:104-110` (`parseTimeFromISO`), `:414` (`createTimelog`), `:1280-1284` (scroll)

- [ ] **Step 1: Ensure the import exists**

`getWorkSettings` should be imported in options.ts (add if absent):
```ts
import { getWorkSettings, initWorkSettings } from './utils/workSettings';
```

- [ ] **Step 2: Default timelog time (line ~414)**

Replace:
```ts
  const fullSpentAt = spentAt.includes('T') ? spentAt : `${spentAt}T09:00:00`;
```
with:
```ts
  const fullSpentAt = spentAt.includes('T')
    ? spentAt
    : `${spentAt}T${getWorkSettings().dayStartTime}:00`;
```

- [ ] **Step 3: ISO fallback time (lines ~105, ~108)**

Add a helper at the top of `parseTimeFromISO`:
```ts
function parseTimeFromISO(iso: string): { hours: number; minutes: number } {
  const [dh, dm] = getWorkSettings().dayStartTime.split(':').map((n) => parseInt(n, 10));
  if (!iso.includes('T')) return { hours: dh, minutes: dm };
  const timePart = iso.split('T')[1];
  const match = timePart.match(/^(\d{2}):(\d{2})/);
  if (!match) return { hours: dh, minutes: dm };
  return { hours: parseInt(match[1], 10), minutes: parseInt(match[2], 10) };
}
```

- [ ] **Step 4: Calendar scroll = dayStart − 30 min (line ~1280-1284)**

Replace:
```ts
  // Scroll to 8:30 by default on initial render
  const calBody = content.querySelector('.cal-body');
  if (calBody && calBody.scrollTop === 0) {
    calBody.scrollTop = (8.5 - gridStartHour) * CAL_PX_PER_HOUR;
  }
```
with:
```ts
  // Scroll so the day-start (minus 30 min for context) is at the top on first render
  const calBody = content.querySelector('.cal-body');
  if (calBody && calBody.scrollTop === 0) {
    const [sh, sm] = getWorkSettings().dayStartTime.split(':').map((n) => parseInt(n, 10));
    const scrollHour = sh + sm / 60 - 0.5;
    calBody.scrollTop = (scrollHour - gridStartHour) * CAL_PX_PER_HOUR;
  }
```

- [ ] **Step 5: Verify build**

Run: `npm run type-check && npm run build`
Expected: no errors. Default `09:00` → scroll anchor `8.5` (unchanged from before).

- [ ] **Step 6: Commit**

```bash
git add src/options.ts
git commit -m "feat: day start time + calendar scroll from work settings"
```

---

## Task 8: Weekend days from settings (`options.ts`)

**Files:**
- Modify: `src/options.ts:461`, `src/options.ts:1186`

- [ ] **Step 1: Weekly overview weekend class (line ~461)**

Replace:
```ts
    const weekendClass = i >= 5 ? ' weekend' : '';
```
with:
```ts
    const weekendClass = getWorkSettings().weekendDays.includes(i) ? ' weekend' : '';
```

- [ ] **Step 2: Calendar weekend class (line ~1186)**

Replace:
```ts
    const weekendClass = !hideWeekends && i >= 5 ? ' cal-weekend' : '';
```
with:
```ts
    const weekendClass =
      !hideWeekends && getWorkSettings().weekendDays.includes(i) ? ' cal-weekend' : '';
```

- [ ] **Step 3: Check for other weekend assumptions**

Run: `grep -n "hideWeekends\|>= 5\|weekend" src/options.ts`
For any remaining `i >= 5` / `>= 5` that filters out weekend days when `hideWeekends` is on (e.g. a `visibleDays` filter), replace the predicate with `!getWorkSettings().weekendDays.includes(i)`. Show the change for each match before editing.

- [ ] **Step 4: Verify build**

Run: `npm run type-check && npm run build`
Expected: no errors.

- [ ] **Step 5: Commit**

```bash
git add src/options.ts
git commit -m "feat: weekend days from work settings"
```

---

## Task 9: Time increment — snap + picker step

**Files:**
- Modify: `src/options.ts:1444-1447` (`pxToDurationSeconds`)
- Modify: `src/features/editMode.ts:250-251` (picker loop)

- [ ] **Step 1: Calendar drag snap (options.ts ~1444)**

Replace:
```ts
  function pxToDurationSeconds(px: number): number {
    const raw = Math.round((px / CAL_PX_PER_HOUR) * 3600);
    return Math.max(900, Math.round(raw / 900) * 900); // min 15min, snap 15min
  }
```
with:
```ts
  function pxToDurationSeconds(px: number): number {
    const snap = getWorkSettings().timeIncrementMinutes * 60;
    const raw = Math.round((px / CAL_PX_PER_HOUR) * 3600);
    return Math.max(snap, Math.round(raw / snap) * snap); // snap to time increment
  }
```

- [ ] **Step 2: Time-picker step (editMode.ts ~250)**

Add import at top of `editMode.ts`:
```ts
import { getWorkSettings } from '../utils/workSettings';
```
Replace the inner loop step:
```ts
    for (let h = 0; h < 24; h++) {
      for (let m = 0; m < 60; m += getWorkSettings().timeIncrementMinutes) {
```

- [ ] **Step 3: Verify build**

Run: `npm run type-check && npm run build`
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add src/options.ts src/features/editMode.ts
git commit -m "feat: time increment (snap + picker step) from work settings"
```

---

## Task 10: "Work" settings tab UI

**Files:**
- Modify: `src/options.html` (tab button + tab content)
- Modify: `src/options.ts` (populate form, auto-save, reset)

**Interfaces:**
- Consumes: `loadWorkSettings`, `saveWorkSettings`, `DEFAULT_WORK_SETTINGS` from Task 2.

- [ ] **Step 1: Add the tab button (options.html ~2122)**

After the Connection tab button, add:
```html
            <button class="settings-tab" data-settings-tab="work">Work</button>
```

- [ ] **Step 2: Add the tab content panel (options.html, after the connection panel ends ~2188)**

```html
          <div class="settings-tab-content" data-settings-tab-content="work">
            <div class="notif-card">
              <div class="form-group">
                <label class="form-label" for="wsDayStart">Day start time</label>
                <input class="form-input" type="time" id="wsDayStart" value="09:00" />
                <div class="form-hint">Default time for new logs; calendar scrolls here.</div>
              </div>
              <div class="form-group">
                <label class="form-label">Daily work target</label>
                <div style="display: flex; gap: 8px; align-items: center">
                  <input class="form-input" type="number" id="wsTargetH" min="0" max="24" style="width: 70px" /> h
                  <input class="form-input" type="number" id="wsTargetM" min="0" max="59" style="width: 70px" /> m
                </div>
              </div>
              <div class="form-group">
                <label class="form-label" for="wsWarn">Estimate warning at (% of estimate spent)</label>
                <input class="form-input" type="number" id="wsWarn" min="50" max="100" style="width: 80px" />
              </div>
              <div class="form-group">
                <label class="form-label">Weekend days</label>
                <div id="wsWeekend" style="display: flex; gap: 10px; flex-wrap: wrap"></div>
              </div>
              <div class="form-group">
                <label class="form-label" for="wsIncrement">Time increment</label>
                <select class="form-input" id="wsIncrement" style="width: 120px">
                  <option value="5">5 min</option>
                  <option value="10">10 min</option>
                  <option value="15">15 min</option>
                  <option value="30">30 min</option>
                </select>
              </div>
              <div class="form-group">
                <label class="form-label" for="wsHoursDay">Hours per day</label>
                <input class="form-input" type="number" id="wsHoursDay" min="1" max="24" step="0.5" style="width: 80px" />
                <div class="form-hint">Affects how <code>1d</code> estimates display.</div>
              </div>
              <div class="form-group">
                <label class="form-label" for="wsHoursWeek">Hours per week</label>
                <input class="form-input" type="number" id="wsHoursWeek" min="1" max="168" step="0.5" style="width: 80px" />
                <div class="form-hint">Affects how <code>1w</code> estimates display.</div>
              </div>
              <div style="display: flex; gap: 12px; align-items: center; margin-top: 8px">
                <button class="reset-colors-btn" id="wsResetBtn">Reset to Defaults</button>
                <span class="save-status" id="wsSaveStatus"></span>
              </div>
            </div>
          </div>
```
(If `.form-hint` is not an existing class, reuse `.color-section-desc` instead — check with `grep -n "form-hint\|color-section-desc" src/options.html` and use whichever exists.)

- [ ] **Step 3: Add the init function (options.ts)**

Add import:
```ts
import {
  loadWorkSettings,
  saveWorkSettings,
  DEFAULT_WORK_SETTINGS,
  WorkSettings,
} from './utils/workSettings';
```
Add a new function (near `initNotificationSettings`):
```ts
const WS_DAY_LABELS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

function readWorkForm(): WorkSettings {
  const th = parseInt((document.getElementById('wsTargetH') as HTMLInputElement).value || '0', 10);
  const tm = parseInt((document.getElementById('wsTargetM') as HTMLInputElement).value || '0', 10);
  const weekendDays: number[] = [];
  WS_DAY_LABELS.forEach((_, i) => {
    const cb = document.getElementById(`wsWeekend-${i}`) as HTMLInputElement | null;
    if (cb?.checked) weekendDays.push(i);
  });
  return {
    dayStartTime: (document.getElementById('wsDayStart') as HTMLInputElement).value || '09:00',
    dailyTargetSeconds: th * 3600 + tm * 60,
    warningThreshold:
      parseInt((document.getElementById('wsWarn') as HTMLInputElement).value || '80', 10) / 100,
    weekendDays,
    timeIncrementMinutes: parseInt(
      (document.getElementById('wsIncrement') as HTMLSelectElement).value,
      10
    ),
    hoursPerDay: parseFloat((document.getElementById('wsHoursDay') as HTMLInputElement).value || '8'),
    hoursPerWeek: parseFloat(
      (document.getElementById('wsHoursWeek') as HTMLInputElement).value || '40'
    ),
  };
}

function populateWorkForm(s: WorkSettings): void {
  (document.getElementById('wsDayStart') as HTMLInputElement).value = s.dayStartTime;
  (document.getElementById('wsTargetH') as HTMLInputElement).value = String(
    Math.floor(s.dailyTargetSeconds / 3600)
  );
  (document.getElementById('wsTargetM') as HTMLInputElement).value = String(
    Math.round((s.dailyTargetSeconds % 3600) / 60)
  );
  (document.getElementById('wsWarn') as HTMLInputElement).value = String(
    Math.round(s.warningThreshold * 100)
  );
  (document.getElementById('wsIncrement') as HTMLSelectElement).value = String(
    s.timeIncrementMinutes
  );
  (document.getElementById('wsHoursDay') as HTMLInputElement).value = String(s.hoursPerDay);
  (document.getElementById('wsHoursWeek') as HTMLInputElement).value = String(s.hoursPerWeek);

  const wrap = document.getElementById('wsWeekend')!;
  wrap.innerHTML = WS_DAY_LABELS.map(
    (label, i) =>
      `<label style="display:flex;gap:4px;align-items:center"><input type="checkbox" id="wsWeekend-${i}" ${
        s.weekendDays.includes(i) ? 'checked' : ''
      } />${label}</label>`
  ).join('');
}

function initWorkSettingsForm(): void {
  loadWorkSettings().then(populateWorkForm);

  const status = document.getElementById('wsSaveStatus');
  const onChange = () => {
    saveWorkSettings(readWorkForm());
    if (status) {
      status.textContent = 'Saved';
      setTimeout(() => (status.textContent = ''), 1500);
    }
  };

  const panel = document.querySelector('[data-settings-tab-content="work"]');
  panel?.addEventListener('change', onChange);

  document.getElementById('wsResetBtn')?.addEventListener('click', () => {
    populateWorkForm({ ...DEFAULT_WORK_SETTINGS });
    saveWorkSettings({ ...DEFAULT_WORK_SETTINGS });
    if (status) {
      status.textContent = 'Reset';
      setTimeout(() => (status.textContent = ''), 1500);
    }
  });
}
```

- [ ] **Step 4: Call the init in DOMContentLoaded**

In the `DOMContentLoaded` async handler (after `initNotificationSettings()` is called), add:
```ts
  initWorkSettingsForm();
```

- [ ] **Step 5: Verify build + lint**

Run: `npm run check`
Expected: type-check, lint, format:check, build all pass. (Run `npm run format` first if format:check fails.)

- [ ] **Step 6: Commit**

```bash
git add src/options.html src/options.ts
git commit -m "feat: Work settings tab in options UI"
```

---

## Task 11: Full verification

**Files:** none (verification only)

- [ ] **Step 1: Run the whole suite + checks**

Run: `npm test && npm run check`
Expected: all tests pass; type-check, lint, format:check, build all pass.

- [ ] **Step 2: Manual smoke test (load unpacked extension)**

Run: `npm run build`, then load `dist/` as an unpacked extension in Chrome. Verify:
- Fresh profile (no `workSettings` key): every behavior matches today (default log time 09:00, calendar scrolls to 08:30, weekend = Sat/Sun, 15-min snap, `1d`=8h display, warning at 80%, board daily target 8h24m).
- Open options → **Work** tab. Change each field; confirm:
  - Day start → new logs default to it; calendar scrolls to it −30 min.
  - Daily target → board target reflects new value.
  - Warning % → a card crossing the new threshold turns "warning".
  - Weekend days → weekend styling moves to the selected days (and `hideWeekends` hides the new set).
  - Time increment → calendar drag snaps to it; edit-mode picker steps by it.
  - Hours/day & hours/week → `1d`/`1w` estimate displays reflow.
- Reload the options page: all values persist.
- **Reset to Defaults**: all fields return to defaults and persist.

- [ ] **Step 3: Final commit (only if Step 2 surfaced fixes)**

```bash
git add -A
git commit -m "fix: work settings verification follow-ups"
```

---

## Self-Review Notes

- **Spec coverage:** all 7 settings have tasks (3,5,6,7,8,9 wire them; 10 exposes them); module + cache (Task 2), init (Task 4), test infra (Task 1), verification (Task 11). ✓
- **No `notificationSettings` change** — honored (Task 4 only adds init; daily target kept separate). ✓
- **Type consistency:** `WorkSettings` field names identical across Tasks 2/3/10; `getWorkSettings()`/`loadWorkSettings()`/`saveWorkSettings()` used consistently. ✓
- **Weekday convention** Mon=0…Sun=6 consistent in Tasks 2, 8, 10. ✓
- **Open assumption to confirm during execution:** Task 8 Step 3 — there may be a `visibleDays` filter elsewhere in options.ts that also encodes `>= 5`; the grep step catches it.
