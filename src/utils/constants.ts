/**
 * Shared constants used across features
 */

/** Selectors for GitLab's inline new-issue UI on boards */
export const NEW_ISSUE_SELECTORS = [
  '[data-testid="board-new-issue-form"]',
  '[data-testid="issue-boards-new-issue-form"]',
  '.board-new-issue-form',
  'form[class*="new-issue"]',
  '.board-list-component form',
  '.board-card-create',
  '[class*="BoardNewIssue"]',
].join(', ');

/** Common estimate preset buttons */
export const ESTIMATE_PRESETS = [
  { label: '15m', value: '15m' },
  { label: '30m', value: '30m' },
  { label: '45m', value: '45m' },
  { label: '1h', value: '1h' },
  { label: '2h', value: '2h' },
  { label: '4h', value: '4h' },
  { label: '1d', value: '1d' },
];

/** Common time-spent preset buttons */
export const SPENT_PRESETS = [
  { label: '15m', value: '15m' },
  { label: '30m', value: '30m' },
  { label: '45m', value: '45m' },
  { label: '1h', value: '1h' },
  { label: '2h', value: '2h' },
  { label: '4h', value: '4h' },
  { label: '1d', value: '1d' },
];
