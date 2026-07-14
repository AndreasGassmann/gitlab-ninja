# Changelog

All notable changes to GitLab Ninja are documented here.

## [1.4.1] - 2026-07-14

### Security

- Hardening improvements to how the extension renders data and handles links.

## [1.4.0] - 2026-07-14

### Added

- **Inline due-date editing** in the board card edit panel — set, change or clear an issue's due date without leaving the board.
  - Quick presets for tomorrow, in 2 days and next Monday (e.g. `+1 We`, `+2 Th`, `+6 Mo`).
  - Due chip on the card updates immediately, no reload needed.
- **Board sorting** — new "Sort" dropdown in the toolbar sorts cards within each column.
  - Modes: original order, due date, time estimated, time spent.
  - Ascending/descending toggle; due date defaults to soonest first (overdue → today → future), estimate/spent to largest first. Cards without a value always sort last.
  - Display-only: GitLab's real card order is untouched, and drag positions still save.
  - Selection persists per board.
- **Weekend log hint** — shows a hint when a logged weekend entry is hidden by the work settings.
- **Draft support in all views** — drafts now work across the board, calendar and list views.

### Fixed

- Time totals no longer show raw floats like `0.16666666666666h` — durations render as minute-precise segments (`10m`, `1h 30m`, `1d 2h 15m`).

## [1.3.0] - 2026-06-24

### Added

- **Work Settings tab** in the options UI — configure how the extension models your workday.
  - Board daily target hours.
  - Estimate warning threshold.
  - Day start time, with the calendar auto-scrolling to it.
  - Weekend days.
  - Time increment that drives both time snapping and the picker step.
- **Draft mode** for time logs — create and edit a draft ticket before committing, with a "draft reset" to start over.
- **Connection check** to verify GitLab connectivity.
- **Nagging notifications** to remind you to log time.
- Default log time set to 09:30.

### Changed

- Time conversions now driven by your configured work settings.
- Picker rounding coupled to the configured time increment.

### Fixed

- Resolved pre-existing type errors that blocked the build.

## [1.2.0]

Previous release.
