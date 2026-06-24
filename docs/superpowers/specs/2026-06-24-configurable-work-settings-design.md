# Configurable Work Settings — Design

**Date:** 2026-06-24
**Status:** Approved (design), pending implementation plan

## Goal

Promote seven currently-hardcoded constants to user-configurable settings, exposed in
a new "Work" tab on the options page. Defaults equal the current hardcoded values, so
existing users see **no behavior change** until they opt in.

## Settings

| # | Setting | Default | Drives |
|---|---------|---------|--------|
| 1 | `dayStartTime` | `"09:00"` | Default timelog time **and** calendar scroll position |
| 2 | `dailyTargetSeconds` | `30240` (8h 24m) | Board daily work target |
| 3 | `warningThreshold` | `0.8` | Estimate-spent "warning" status threshold |
| 4 | `weekendDays` | `[5, 6]` (Sat, Sun) | Which weekdays count as weekend |
| 5 | `timeIncrementMinutes` | `15` | Calendar drag snap **and** time-picker step |
| 6 | `hoursPerDay` | `8` | GitLab estimate unit conversion (`1d` = N hours) |
| 7 | `hoursPerWeek` | `40` | GitLab estimate unit conversion (`1w` = N hours) |

### Resolved design decisions

- **Day start merged.** Default timelog time (was `09:00`) and calendar scroll (was
  `08:30`) collapse into one `dayStartTime`. The calendar scrolls to
  `dayStartTime − 30 min` (preserves the prior 09:00 → 08:30 relationship).
- **Daily target stays separate** from notification `minHours`. `notificationSettings`
  is left untouched.
- **Hours/day and hours/week are both exposed.** They affect how all estimate / spent
  times render via `time.ts`. Matches GitLab's own configurable convention.
- **Weekend = set, hide = toggle.** The existing `hideWeekends` toggle is unchanged; it
  now hides whatever days `weekendDays` defines.

Out of scope (explicitly left hardcoded): debounce delays, DOM/alarm timeouts, render
math (min block height, grid range, header widths), 75% color thresholds, accuracy
ratios, effort tiers, due-date ranges, search limits.

## Architecture

### New module: `src/utils/workSettings.ts`

Follows the existing `themeManager.ts` pattern (typed interface + `DEFAULT_*` +
async load / sync save) **plus** a synchronous in-memory cache, required because
`time.ts` functions are pure and synchronous.

```ts
export interface WorkSettings {
  dayStartTime: string;          // "HH:MM"
  dailyTargetSeconds: number;
  warningThreshold: number;      // 0..1
  weekendDays: number[];         // 0 = Mon … 6 = Sun
  timeIncrementMinutes: number;
  hoursPerDay: number;
  hoursPerWeek: number;
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

// async, merges stored partial over defaults (like loadCustomColors)
export async function loadWorkSettings(): Promise<WorkSettings>;
export function saveWorkSettings(s: WorkSettings): void;

// sync cache for pure functions
export async function initWorkSettings(): Promise<void>; // await once at startup; wires storage.onChanged
export function getWorkSettings(): WorkSettings;          // returns cache, or DEFAULT_WORK_SETTINGS if not yet init
```

- Single storage key `workSettings` in `chrome.storage.sync`.
- `loadWorkSettings` merges `{ ...DEFAULT_WORK_SETTINGS, ...stored }` so partial /
  future-versioned objects degrade safely. No migration needed (absent key → defaults
  → current behavior).
- `initWorkSettings` populates the module cache and registers a
  `chrome.storage.onChanged` listener that refreshes the cache on any `workSettings`
  write. This makes options-page edits apply live (same UX as `themeManager`).
- `getWorkSettings` is the synchronous accessor. Contract: callers in pure/sync paths
  rely on `initWorkSettings` having been awaited at startup; if not, they get
  `DEFAULT_WORK_SETTINGS` (safe fallback, never throws).

### Startup init

`await initWorkSettings()` is added at the top of each entry point before feature code
runs: `background.ts`, the content-script entry (`content.ts`), `options.ts`, and
`popup.ts`.

### Call-site changes

| Setting | File:line (approx) | Change |
|---------|--------------------|--------|
| Day start (log) | `options.ts:414`, `options.ts:105/108` | use `getWorkSettings().dayStartTime` in place of literal `09:00` |
| Calendar scroll | `options.ts:1283` | scroll to `dayStartTime − 30 min` |
| Daily target | `boardSettings.ts:15` | `DAILY_TARGET_SECONDS` → `getWorkSettings().dailyTargetSeconds` |
| Warning % | `timeTracking.ts:125` | `0.8` → `getWorkSettings().warningThreshold` |
| Weekend days | `options.ts:461`, `options.ts:1186` | `=== 5 / >= 5` checks → `weekendDays.includes(d)` |
| Time increment | `options.ts:1446` (snap `900`s), `editMode.ts:251` (step `15`) | derive from `timeIncrementMinutes` (`× 60` for seconds) |
| Hours/day | `time.ts:22-23, 45-47` | `8` → `getWorkSettings().hoursPerDay` |
| Hours/week | `time.ts:20-21, 39-42` | `40` → `getWorkSettings().hoursPerWeek` |

`time.ts` reads the cache synchronously via `getWorkSettings()` — no signature changes
to `parseTimeToHours` / `formatHours`, so the 20 call sites across `background.ts`,
`timeTracking.ts`, `columnSummary.ts`, `editMode.ts` are untouched.

## UI — "Work" settings tab

New tab in the options Settings card (`src/options.html`, `src/options.ts`), placed
after **Connection**: `data-settings-tab="work"`, label "Work". Reuses existing
`.notif-card` / `.form-input` / `.settings-tab` markup and styles.

Controls:

| Setting | Control | Notes |
|---------|---------|-------|
| Day start time | `<input type="time">` | |
| Daily work target | hours + minutes inputs → stored as seconds | |
| Estimate warning % | number input 50–100 → stored `/100` | |
| Weekend days | 7 day checkboxes (Mon–Sun) → `weekendDays` array | |
| Time increment | `<select>` of 5 / 10 / 15 / 30 min | |
| Hours per day | number input | hint: "affects how `1d` estimates display" |
| Hours per week | number input | hint: "affects how `1w` estimates display" |

- **Auto-save** on change (matches the Appearance tab), each write via
  `saveWorkSettings()`. A small saved-status indicator like the notifications tab.
- **Reset to defaults** button (matches Appearance `resetColorsBtn`).
- Live apply via the `storage.onChanged` cache refresh — no reload required.

## Testing

No test framework is currently configured in this repo (no Vitest/Jest, no existing
specs). Plan:

- **Recommended:** add a lightweight Vitest setup and unit-test `time.ts`
  (`parseTimeToHours` / `formatHours`) with non-default `hoursPerDay` / `hoursPerWeek`,
  since those are pure and the highest-risk change. The cache can be seeded by calling
  `saveWorkSettings` against a mocked `chrome.storage`, or by exposing a test-only cache
  setter.
- **Manual verification (required regardless):** load the unpacked extension; for each
  of the 7 settings, change it, confirm the dependent behavior updates live and persists
  across an options-page reload; confirm a fresh profile (no `workSettings` key) behaves
  identically to today.
- `npm run check` (type-check + lint + format + build) must pass.

## Risks / notes

- `getWorkSettings()` before `initWorkSettings()` returns defaults — acceptable, but
  every entry point MUST await init early to avoid a brief default-then-correct flash in
  long-lived contexts.
- Changing `hoursPerDay` / `hoursPerWeek` reflows every estimate display; intended, but
  the UI hint should make the consequence obvious.
- `weekendDays` uses Mon=0…Sun=6 to match existing `DAY_NAMES` indexing — keep this
  convention consistent in the day-checkbox UI.
